import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk'
import type { Requirement, RequirementConversationMessage } from '../../shared/types'
import { getRequirementById, updateRequirementSessionIdIfEmpty } from '../requirement-repo'
import { applyRequirementAction, updateRequirementDetail } from '../requirement-service'
import { createTask, getTasksByRequirement } from '../task-service'
import { getProject, ProjectServiceError } from '../project-service'
import {
  RequirementAgent,
  RequirementEvaluationAgent,
  RequirementReviewAgent,
  type RequirementAgentInput,
  type RequirementEvaluationAgentRunResult,
  type RequirementAgentProgress,
  type RequirementAgentRunResult,
  type RequirementReviewAgentRunResult
} from './requirement-agent'
import {
  parseAgentConversations,
  parseConversationMessages,
  parseRequirementMessagesFromSessionList,
  stringifyAgentConversations
} from '../agent-message-utils'
import { readRequirementArtifactIfExists, resolveRequirementArtifactDir, writeRequirementArtifact } from '../requirement-artifact-service'
import {
  finishRequirementStageRun,
  hasOpenRequirementStageRun,
  listRequirementStageRuns,
  startRequirementStageRun,
  updateRequirementStageRunAgentSessionId,
  updateRequirementStageRunAgentTrace
} from '../requirement-stage-run-repo'

export interface ProcessRequirementInput {
  requirementId: number
  type: string
  source: string
  onRequirementTransition?: (before: Requirement, after: Requirement) => void
}

export interface ProcessRequirementResult {
  requirement: Requirement
  result: { type: 'evaluation' | 'prd' | 'review'; resultType: 'pass' | 'fail' | 'pending' }
}

export interface RequirementConversationResult {
  requirement: Requirement
  messages: RequirementConversationMessage[]
}

function emitRequirementTransition(input: ProcessRequirementInput, before: Requirement, after: Requirement): void {
  if (!input.onRequirementTransition) {
    return
  }

  if (before.status === after.status && before.waitingContext === after.waitingContext) {
    return
  }

  input.onRequirementTransition(before, after)
}

interface RequirementConversationReadOptions {
  sessionId?: string
}

function deriveRequirementArtifactBaseName(stageKey: 'evaluating' | 'prd_designing' | 'prd_reviewing'): string {
  if (stageKey === 'evaluating') {
    return 'evaluation.json'
  }
  if (stageKey === 'prd_designing') {
    return 'prd.md'
  }

  return 'prd_review.json'
}

function buildRequirementStageArtifactFileName(stageKey: 'evaluating' | 'prd_designing' | 'prd_reviewing', round: number): string {
  const baseName = deriveRequirementArtifactBaseName(stageKey)
  if (round <= 1) {
    return baseName
  }

  const dotIndex = baseName.lastIndexOf('.')
  if (dotIndex <= 0) {
    return `${baseName}_v${round}`
  }

  const name = baseName.slice(0, dotIndex)
  const ext = baseName.slice(dotIndex)
  return `${name}_v${round}${ext}`
}

function resolveCurrentRequirementStageArtifactFileName(
  requirementId: number,
  stageKey: 'evaluating' | 'prd_designing' | 'prd_reviewing'
): string {
  const stageRuns = listRequirementStageRuns(requirementId)
  const current = [...stageRuns]
    .reverse()
    .find((item) => item.stageKey === stageKey && item.endAt === null)

  if (!current) {
    return deriveRequirementArtifactBaseName(stageKey)
  }

  return buildRequirementStageArtifactFileName(stageKey, current.round)
}

function resolveLatestRequirementStageArtifactFileName(
  requirementId: number,
  stageKey: 'evaluating' | 'prd_designing' | 'prd_reviewing'
): string {
  const stageRuns = listRequirementStageRuns(requirementId)
  const latest = [...stageRuns]
    .reverse()
    .find((item) => item.stageKey === stageKey && item.artifactFileNames.length > 0)

  if (!latest) {
    return deriveRequirementArtifactBaseName(stageKey)
  }

  return latest.artifactFileNames[latest.artifactFileNames.length - 1] ?? deriveRequirementArtifactBaseName(stageKey)
}

async function writeRequirementStageArtifact(
  requirement: Requirement,
  stageKey: 'evaluating' | 'prd_designing' | 'prd_reviewing',
  content: string
): Promise<void> {
  const fileName = resolveCurrentRequirementStageArtifactFileName(requirement.id, stageKey)
  const dir = await resolveRequirementArtifactDir(requirement.id)
  await writeRequirementArtifact(dir, fileName, content)
}

async function readLatestRequirementStageArtifact(
  requirement: Requirement,
  stageKey: 'evaluating' | 'prd_designing' | 'prd_reviewing'
): Promise<string | null> {
  const fileName = resolveLatestRequirementStageArtifactFileName(requirement.id, stageKey)
  const dir = await resolveRequirementArtifactDir(requirement.id)
  return readRequirementArtifactIfExists(dir, fileName)
}

function buildEvaluationArtifactContent(run: RequirementEvaluationAgentRunResult): string {
  return JSON.stringify(
    {
      type: 'evaluation',
      result: run.decision.result,
      summary: run.decision.summary,
      generatedAt: new Date().toISOString()
    },
    null,
    2
  )
}

function buildPrdReviewArtifactContent(run: RequirementReviewAgentRunResult): string {
  return JSON.stringify(
    {
      type: 'review',
      result: run.decision.result,
      summary: run.decision.summary,
      generatedAt: new Date().toISOString()
    },
    null,
    2
  )
}

function normalizeComparableText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function hasRequirementUserMessage(messages: RequirementConversationMessage[], content: string): boolean {
  const target = normalizeComparableText(content)
  if (!target) {
    return true
  }

  return messages.some((item) => item.role === 'user' && normalizeComparableText(item.content) === target)
}

function buildRequirementUserMessage(content: string): RequirementConversationMessage {
  return {
    id: `human-${Date.now()}`,
    role: 'user',
    content
  }
}

function ensureRequirementUserMessage(messages: RequirementConversationMessage[], content: string): RequirementConversationMessage[] {
  if (hasRequirementUserMessage(messages, content)) {
    return messages
  }

  return [...messages, buildRequirementUserMessage(content)]
}

function appendMissingRequirementUserMessages(
  base: RequirementConversationMessage[],
  fallback: RequirementConversationMessage[]
): RequirementConversationMessage[] {
  let result = [...base]
  for (const item of fallback) {
    if (item.role !== 'user') {
      continue
    }

    if (hasRequirementUserMessage(result, item.content)) {
      continue
    }

    result = [...result, item]
  }

  return result
}

function createRequirementUserConversationRecord(content: string): Record<string, unknown> {
  return {
    type: 'user',
    message: {
      content: [{ type: 'text', text: content }]
    }
  }
}

function ensureRequirementUserConversationRecord(conversations: unknown[], content: string): unknown[] {
  const normalized = normalizeComparableText(content)
  if (!normalized) {
    return conversations
  }

  const parsed = parseConversationMessages(conversations)
  if (hasRequirementUserMessage(parsed, normalized)) {
    return conversations
  }

  return [...conversations, createRequirementUserConversationRecord(normalized)]
}

function buildRequirementAgentInput(requirement: Requirement, input: Pick<ProcessRequirementInput, 'type' | 'source'>): RequirementAgentInput {
  return {
    requirement: `需求类型: ${input.type}\n需求标题: ${requirement.title}\n需求描述: ${requirement.content}`,
    source: input.source,
    evaluationJson: null,
    prdReviewJson: null,
    promptMode: 'full_context'
  }
}

function buildRequirementEvaluationInput(requirement: Requirement): { requirement: string; source: string } {
  return {
    requirement: `需求标题: ${requirement.title}\n需求描述: ${requirement.content}`,
    source: requirement.source || '未填写'
  }
}

async function toRequirementMessagesFromSession(sessionId: string): Promise<RequirementConversationMessage[]> {
  const list = await getSessionMessages(sessionId)
  return parseRequirementMessagesFromSessionList(list)
}

async function getRequirementConversationMessages(requirement: Requirement): Promise<RequirementConversationMessage[]> {
  const hideSystemMessages = (messages: RequirementConversationMessage[]): RequirementConversationMessage[] => {
    return messages.filter((item) => item.role === 'user' || item.role === 'assistant')
  }
  const fallbackMessages = hideSystemMessages(parseConversationMessages(parseAgentConversations(requirement.agentProcess)))

  if (requirement.agentSessionId) {
    try {
      const messages = await toRequirementMessagesFromSession(requirement.agentSessionId)
      if (messages.length > 0) {
        return appendMissingRequirementUserMessages(hideSystemMessages(messages), fallbackMessages)
      }
    } catch {
      // fallback to persisted snapshots
    }
  }

  return fallbackMessages
}

async function getRequirementConversationMessagesBySessionId(
  requirement: Requirement,
  sessionId: string
): Promise<RequirementConversationMessage[]> {
  const fallbackMessages = await getRequirementConversationMessages(requirement)
  const normalizedSessionId = sessionId.trim()
  if (!normalizedSessionId) {
    return fallbackMessages
  }

  try {
    const messages = await toRequirementMessagesFromSession(normalizedSessionId)
    if (messages.length > 0) {
      return appendMissingRequirementUserMessages(messages.filter((item) => item.role === 'user' || item.role === 'assistant'), fallbackMessages)
    }
  } catch {
    // fallback to requirement session / snapshots
  }

  return fallbackMessages
}

function buildConversationLine(prefix: string, content: string): string {
  return `${prefix}: ${content}`
}

function appendUserSupplement(requirement: Requirement, message: string): string {
  const normalized = message.trim()
  if (!normalized) {
    return requirement.content
  }

  const extraLine = buildConversationLine('人工补充', normalized)
  return requirement.content ? `${requirement.content}\n\n${extraLine}` : extraLine
}

function findWaitingRequirementStageRun(requirementId: number): {
  id: number
  agentProcess: string
  agentSessionId: string | null
} | null {
  const waitingRun = [...listRequirementStageRuns(requirementId)]
    .reverse()
    .find((item) => item.resultStatus === 'waiting_human' && item.endAt === null)
  if (!waitingRun) {
    return null
  }

  return {
    id: waitingRun.id,
    agentProcess: waitingRun.agentProcess,
    agentSessionId: waitingRun.agentSessionId
  }
}

function upsertTasksForQueuedRequirement(requirement: Requirement): void {
  if (requirement.status !== 'queued') {
    return
  }

  const standardizedData = requirement.standardizedData
  if (!standardizedData || standardizedData.type !== 'prd') {
    return
  }

  const existingTasks = getTasksByRequirement(requirement.id)
  if (existingTasks.length > 0) {
    return
  }

  const drafts = standardizedData.subTasks.length > 0 ? standardizedData.subTasks : [{ title: requirement.title, content: standardizedData.prd }]
  for (const draft of drafts) {
    if (!draft.title.trim()) {
      continue
    }

    createTask({
      projectId: requirement.projectId,
      requirementId: requirement.id,
      title: draft.title,
      content: draft.content
    })
  }
}

function ensureRequirementStageRun(requirementId: number, stageKey: 'evaluating' | 'prd_designing' | 'prd_reviewing'): void {
  if (hasOpenRequirementStageRun({ requirementId, stageKey })) {
    return
  }
  startRequirementStageRun({ requirementId, stageKey })
}

function closeRequirementStageRun(
  requirementId: number,
  stageKey: 'evaluating' | 'prd_designing' | 'prd_reviewing',
  resultStatus: 'succeeded' | 'failed' | 'waiting_human',
  reason?: string,
  artifactFileName?: string
): void {
  finishRequirementStageRun({
    requirementId,
    stageKey,
    resultStatus,
    failureReason: reason,
    artifactFileName: artifactFileName ?? deriveRequirementArtifactBaseName(stageKey)
  })
}

async function runEvaluationStage(requirement: Requirement): Promise<{ requirement: Requirement; run: RequirementEvaluationAgentRunResult }> {
  ensureRequirementStageRun(requirement.id, 'evaluating')

  try {
    const project = getProject(requirement.projectId)
    if (!project) {
      throw new Error('关联项目不存在，无法执行需求评估')
    }
    const run = await RequirementEvaluationAgent.runWithConversations(
      {
        ...buildRequirementEvaluationInput(requirement),
        projectPath: project.path
      },
      requirement.agentSessionId ?? undefined
    )
    const artifactFileName = resolveCurrentRequirementStageArtifactFileName(requirement.id, 'evaluating')
    await writeRequirementStageArtifact(requirement, 'evaluating', buildEvaluationArtifactContent(run))
    const mergedHistory = stringifyAgentConversations(run.conversations)
    const isReasonable = run.decision.result === 'reasonable'

    const updated = updateRequirementDetail({
      id: requirement.id,
      title: requirement.title,
      content: requirement.content,
      status: 'evaluating',
      source: requirement.source,
      standardizedData: {
        type: 'evaluation',
        result: run.decision.result,
        summary: run.decision.summary
      },
      agentProcess: mergedHistory,
      agentSessionId: run.sessionId ?? requirement.agentSessionId
    })

    const stageRuns = listRequirementStageRuns(requirement.id)
    const stageRun = [...stageRuns].reverse().find((item) => item.stageKey === 'evaluating' && item.endAt === null)
    if (stageRun) {
      updateRequirementStageRunAgentTrace({
        stageRunId: stageRun.id,
        agentProcess: mergedHistory,
        agentSessionId: run.sessionId
      })
    }

    closeRequirementStageRun(requirement.id, 'evaluating', isReasonable ? 'succeeded' : 'failed', run.decision.summary, artifactFileName)
    const moved = applyRequirementAction({ id: updated.id, action: isReasonable ? 'evaluate_pass' : 'evaluate_fail' })
    return { requirement: moved, run }
  } catch (error) {
    closeRequirementStageRun(requirement.id, 'evaluating', 'failed', error instanceof Error ? error.message : '需求评估失败')
    throw error
  }
}

async function runPrdDesignStage(requirement: Requirement, source: string, type: string): Promise<{ requirement: Requirement; run: RequirementAgentRunResult }> {
  ensureRequirementStageRun(requirement.id, 'prd_designing')

  const project = getProject(requirement.projectId)
  if (!project) {
    throw new Error('关联项目不存在，无法执行 PRD 设计')
  }

  const onProgress = (() => {
    let persisted = false
    return (progress: RequirementAgentProgress) => {
      if (persisted) {
        return
      }
      const sessionId = progress.sessionId?.trim()
      if (!sessionId) {
        return
      }
      try {
        const stageRuns = listRequirementStageRuns(requirement.id)
        const stageRun = [...stageRuns].reverse().find((item) => item.stageKey === 'prd_designing' && item.endAt === null)
        if (!stageRun) {
          return
        }
        updateRequirementStageRunAgentSessionId({ stageRunId: stageRun.id, agentSessionId: sessionId })
        updateRequirementSessionIdIfEmpty({
          id: requirement.id,
          agentSessionId: sessionId
        })
        persisted = true
      } catch {
        // ignore
      }
    }
  })()

  try {
    const [evaluationJson, prdReviewJson] = await Promise.all([
      readLatestRequirementStageArtifact(requirement, 'evaluating'),
      readLatestRequirementStageArtifact(requirement, 'prd_reviewing')
    ])
    const run = await RequirementAgent.runWithConversations(
      {
        ...buildRequirementAgentInput(requirement, { source, type }),
        evaluationJson,
        prdReviewJson,
        projectPath: project.path
      },
      requirement.agentSessionId ?? undefined,
      {
        onProgress
      }
    )

    const artifactFileName = resolveCurrentRequirementStageArtifactFileName(requirement.id, 'prd_designing')
    await writeRequirementStageArtifact(requirement, 'prd_designing', run.decision.prd)
    const mergedHistory = stringifyAgentConversations(run.conversations)
    const updated = updateRequirementDetail({
      id: requirement.id,
      title: requirement.title,
      content: requirement.content,
      status: 'prd_designing',
      source,
      standardizedData: {
        type: 'prd',
        prd: run.decision.prd,
        subTasks: run.decision.subTasks
      },
      agentProcess: mergedHistory,
      agentSessionId: run.sessionId ?? requirement.agentSessionId
    })

    const stageRuns = listRequirementStageRuns(requirement.id)
    const stageRun = [...stageRuns].reverse().find((item) => item.stageKey === 'prd_designing' && item.endAt === null)
    if (stageRun) {
      updateRequirementStageRunAgentTrace({
        stageRunId: stageRun.id,
        agentProcess: mergedHistory,
        agentSessionId: run.sessionId
      })
    }

    closeRequirementStageRun(requirement.id, 'prd_designing', 'succeeded', undefined, artifactFileName)
    const moved = applyRequirementAction({ id: updated.id, action: 'design_done' })
    return { requirement: moved, run }
  } catch (error) {
    if (error instanceof ProjectServiceError) {
      closeRequirementStageRun(requirement.id, 'prd_designing', 'failed', error.message)
      throw error
    }
    closeRequirementStageRun(requirement.id, 'prd_designing', 'failed', error instanceof Error ? error.message : 'PRD 设计失败')
    throw error
  }
}

async function runPrdReviewStage(requirement: Requirement, source: string): Promise<{ requirement: Requirement; run: RequirementReviewAgentRunResult }> {
  ensureRequirementStageRun(requirement.id, 'prd_reviewing')
  try {
    const project = getProject(requirement.projectId)
    if (!project) {
      throw new Error('关联项目不存在，无法执行需求评审')
    }

    const prdContent = await readLatestRequirementStageArtifact(requirement, 'prd_designing')
    if (!prdContent?.trim()) {
      throw new Error('缺少 PRD 设计产物（prd.md），无法评审')
    }
    const subTasks =
      requirement.standardizedData && requirement.standardizedData.type === 'prd'
        ? requirement.standardizedData.subTasks
        : [{ title: requirement.title, content: requirement.content }]

    const run = await RequirementReviewAgent.runWithConversations({
      requirement: `需求标题: ${requirement.title}\n需求描述: ${requirement.content}`,
      source,
      prd: prdContent,
      subTasks,
      projectPath: project.path
    })
    const artifactFileName = resolveCurrentRequirementStageArtifactFileName(requirement.id, 'prd_reviewing')
    await writeRequirementStageArtifact(requirement, 'prd_reviewing', buildPrdReviewArtifactContent(run))

    const stageRuns = listRequirementStageRuns(requirement.id)
    const stageRun = [...stageRuns].reverse().find((item) => item.stageKey === 'prd_reviewing' && item.endAt === null)
    if (stageRun) {
      updateRequirementStageRunAgentTrace({
        stageRunId: stageRun.id,
        agentProcess: stringifyAgentConversations(run.conversations),
        agentSessionId: run.sessionId
      })
    }

    const updated = updateRequirementDetail({
      id: requirement.id,
      title: requirement.title,
      content: requirement.content,
      status: 'prd_reviewing',
      source: requirement.source,
      standardizedData: {
        type: 'review',
        result: run.decision.result,
        summary: run.decision.summary
      },
      agentProcess: stringifyAgentConversations(run.conversations),
      agentSessionId: run.sessionId ?? requirement.agentSessionId
    })

    if (run.decision.result === 'pass') {
      closeRequirementStageRun(requirement.id, 'prd_reviewing', 'succeeded', undefined, artifactFileName)
      const queued = applyRequirementAction({ id: updated.id, action: 'review_pass' })
      return { requirement: queued, run }
    }

    closeRequirementStageRun(requirement.id, 'prd_reviewing', 'failed', run.decision.summary, artifactFileName)
    const rolledBack = applyRequirementAction({ id: updated.id, action: 'review_fail' })

    if (rolledBack.waitingContext === 'prd_review_gate') {
      startRequirementStageRun({ requirementId: rolledBack.id, stageKey: 'prd_designing' })
      closeRequirementStageRun(rolledBack.id, 'prd_designing', 'waiting_human', 'PRD评审多次未通过，等待人工处理')
    }

    return { requirement: rolledBack, run }
  } catch (error) {
    if (error instanceof ProjectServiceError) {
      closeRequirementStageRun(requirement.id, 'prd_reviewing', 'failed', error.message)
      throw error
    }
    closeRequirementStageRun(requirement.id, 'prd_reviewing', 'failed', error instanceof Error ? error.message : 'PRD 评审失败')
    throw error
  }
}

export async function processRequirement(input: ProcessRequirementInput): Promise<ProcessRequirementResult> {
  if (!Number.isInteger(input.requirementId) || input.requirementId <= 0) {
    throw new Error('requirementId 非法')
  }

  const type = input.type.trim()
  if (!type) {
    throw new Error('需求 type 不能为空')
  }

  const source = input.source.trim()
  if (!source) {
    throw new Error('需求来源不能为空')
  }

  let requirement = getRequirementById(input.requirementId)
  if (!requirement) {
    throw new Error('需求不存在')
  }

  if (requirement.status === 'pending') {
    const before = requirement
    requirement = applyRequirementAction({ id: requirement.id, action: 'grab' })
    emitRequirementTransition(input, before, requirement)
  }

  if (requirement.status === 'evaluating') {
    const before = requirement
    const evaluation = await runEvaluationStage(requirement)
    requirement = evaluation.requirement
    emitRequirementTransition(input, before, requirement)
  }

  if (requirement.status === 'queued') {
    upsertTasksForQueuedRequirement(requirement)
    return {
      requirement,
      result: { type: 'review', resultType: 'pass' }
    }
  }

  if (requirement.status === 'prd_designing') {
    const before = requirement
    const design = await runPrdDesignStage(requirement, source, type)
    requirement = design.requirement
    emitRequirementTransition(input, before, requirement)
  }

  if (requirement.status === 'prd_reviewing') {
    const before = requirement
    const review = await runPrdReviewStage(requirement, source)
    requirement = review.requirement
    emitRequirementTransition(input, before, requirement)
  }

  if (requirement.status === 'queued') {
    upsertTasksForQueuedRequirement(requirement)
    return {
      requirement,
      result: { type: 'review', resultType: 'pass' }
    }
  }

  if (requirement.status === 'canceled') {
    return {
      requirement,
      result: { type: 'evaluation', resultType: 'fail' }
    }
  }

  if (requirement.status === 'evaluating') {
    return {
      requirement,
      result: { type: 'evaluation', resultType: 'pending' }
    }
  }

  return {
    requirement,
    result: { type: 'review', resultType: requirement.waitingContext ? 'pending' : 'fail' }
  }
}

export async function askRequirementAgent(input: RequirementAgentInput) {
  const agent = new RequirementAgent()
  return agent.run(input)
}

export async function getRequirementConversation(
  requirementId: number,
  options?: RequirementConversationReadOptions
): Promise<RequirementConversationResult> {
  if (!Number.isInteger(requirementId) || requirementId <= 0) {
    throw new Error('requirementId 非法')
  }

  const requirement = getRequirementById(requirementId)
  if (!requirement) {
    throw new Error('需求不存在')
  }

  const messages = options?.sessionId
    ? await getRequirementConversationMessagesBySessionId(requirement, options.sessionId)
    : await getRequirementConversationMessages(requirement)
  return {
    requirement,
    messages
  }
}

export async function replyRequirementConversation(input: {
  requirementId: number
  message: string
}): Promise<RequirementConversationResult> {
  if (!Number.isInteger(input.requirementId) || input.requirementId <= 0) {
    throw new Error('requirementId 非法')
  }

  const message = input.message.trim()
  if (!message) {
    throw new Error('澄清消息不能为空')
  }

  const current = getRequirementById(input.requirementId)
  if (!current) {
    throw new Error('需求不存在')
  }

  if (current.waitingContext !== 'prd_review_gate') {
    throw new Error('当前需求不在待人工处理状态')
  }

  const waitingRun = findWaitingRequirementStageRun(current.id)
  if (!waitingRun) {
    throw new Error('未找到等待人工的节点运行记录')
  }

  const project = getProject(current.projectId)
  if (!project) {
    throw new Error('关联项目不存在，无法执行人工会话')
  }

  const stageHistory = parseAgentConversations(waitingRun.agentProcess)
  const resumeSessionId = waitingRun.agentSessionId ?? current.agentSessionId ?? undefined
  const run = await RequirementAgent.runWithConversations(
    {
      requirement: message,
      source: current.source || '未填写',
      promptMode: 'followup',
      projectPath: project.path
    },
    resumeSessionId,
    {
      onProgress: (progress) => {
        const sessionId = progress.sessionId?.trim()
        if (!sessionId) {
          return
        }
        try {
          updateRequirementStageRunAgentSessionId({
            stageRunId: waitingRun.id,
            agentSessionId: sessionId
          })
          updateRequirementSessionIdIfEmpty({
            id: current.id,
            agentSessionId: sessionId
          })
        } catch {
          // ignore
        }
      }
    }
  )

  const mergedConversations = ensureRequirementUserConversationRecord([...stageHistory, ...run.conversations], message)
  const mergedHistory = stringifyAgentConversations(mergedConversations)
  const updated = updateRequirementDetail({
    id: current.id,
    title: current.title,
    content: appendUserSupplement(current, message),
    status: 'prd_designing',
    source: current.source,
    standardizedData: {
      type: 'prd',
      prd: run.decision.prd,
      subTasks: run.decision.subTasks
    },
    agentProcess: mergedHistory,
    agentSessionId: run.sessionId ?? waitingRun.agentSessionId ?? current.agentSessionId
  })
  updateRequirementStageRunAgentTrace({
    stageRunId: waitingRun.id,
    agentProcess: mergedHistory,
    agentSessionId: run.sessionId ?? waitingRun.agentSessionId ?? null
  })
  let messages = run.sessionId
    ? await getRequirementConversationMessagesBySessionId(updated, run.sessionId)
    : await getRequirementConversationMessages(updated)
  messages = ensureRequirementUserMessage(messages, message)

  return {
    requirement: updated,
    messages
  }
}
