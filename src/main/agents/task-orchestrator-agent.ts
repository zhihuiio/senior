import { AgentRunnerError, runAgentQuery } from './agent-runner'
import type { Task, TaskStatus } from '../../shared/types'
import { getDb } from '../db'
import { getProject, ProjectServiceError } from '../project-service'
import {
  applyTaskAction,
  finalizeTaskStageWaitingHumanIfNeeded,
  getTaskDetail,
  isTaskWaitingHumanStatus,
  resolveCurrentStageArtifactFileName,
  resolveLatestStageArtifactFileName
} from '../task-service'
import { updateTaskStageRunAgentSessionId, updateTaskStageRunAgentTrace } from '../task-stage-run-repo'
import { stringifyAgentConversations } from '../agent-message-utils'
import { readArtifactIfExists, resolveTaskArtifactDir, writeArtifact } from '../task-artifact-service'
import {
  buildArchDesignUserPrompt,
  buildCodingUserPrompt,
  buildDeployingUserPrompt,
  buildQaReviewUserPrompt,
  buildTechReviewUserPrompt,
  TASK_ARCH_DESIGN_AGENT_SYSTEM_PROMPT,
  TASK_CODING_AGENT_SYSTEM_PROMPT,
  TASK_DEPLOYING_AGENT_SYSTEM_PROMPT,
  TASK_QA_REVIEW_AGENT_SYSTEM_PROMPT,
  TASK_TECH_REVIEW_AGENT_SYSTEM_PROMPT
} from './prompts'
import { isOrchestratableTaskStatus, STAGE_FALLBACK_ARTIFACT_FILE_NAME, type OrchestratableTaskStatus } from './task-stage-config'
import { finishTaskStageRun } from '../task-stage-run-repo'
import { emitTaskStageTraceChanged } from '../task-stage-trace-events'

interface TaskAgentResult {
  pass: boolean
  summary: string
  raw: string
  conversations: unknown[]
  sessionId: string | null
}

interface TaskAgentProgress {
  conversations: unknown[]
  sessionId: string | null
}

interface TaskAgentRunOptions {
  cwd: string
  onProgress?: (progress: TaskAgentProgress) => void
}

function parseTaskAgentResult(raw: string, defaultPass: boolean): Omit<TaskAgentResult, 'conversations' | 'sessionId'> {
  const text = raw.trim()
  if (!text) {
    return {
      pass: defaultPass,
      summary: '',
      raw: ''
    }
  }

  const lower = text.toLowerCase()
  if (lower.startsWith('pass') || text.startsWith('通过')) {
    return {
      pass: true,
      summary: text.replace(/^pass\s*[:：-]?\s*/i, '').replace(/^通过\s*[:：-]?\s*/i, '').trim(),
      raw: text
    }
  }

  if (lower.startsWith('fail') || text.startsWith('不通过') || text.startsWith('未通过')) {
    return {
      pass: false,
      summary: text.replace(/^fail\s*[:：-]?\s*/i, '').replace(/^不通过\s*[:：-]?\s*/i, '').replace(/^未通过\s*[:：-]?\s*/i, '').trim(),
      raw: text
    }
  }

  return {
    pass: defaultPass,
    summary: text,
    raw: text
  }
}

async function runTaskAgent(systemPrompt: string, prompt: string, defaultPass: boolean, options?: TaskAgentRunOptions): Promise<TaskAgentResult> {
  if (!options?.cwd?.trim()) {
    throw new Error('任务 Agent 缺少项目目录上下文')
  }

  try {
    const runnerResult = await runAgentQuery({
      systemPrompt,
      prompt,
      cwd: options.cwd,
      errorMessage: 'Agent 执行失败',
      noResultMessage: '未收到 Agent 返回结果',
      onProgress: (progress) => {
        options?.onProgress?.({
          conversations: progress.conversations,
          sessionId: progress.sessionId
        })
      }
    })

    return {
      ...parseTaskAgentResult(runnerResult.resultText, defaultPass),
      conversations: runnerResult.conversations,
      sessionId: runnerResult.sessionId
    }
  } catch (error) {
    if (error instanceof AgentRunnerError) {
      throw new Error(error.message)
    }

    throw error
  }
}

function normalizeAgentMarkdown(result: TaskAgentResult, fallbackTitle: string): string {
  if (result.summary) {
    return result.summary
  }

  if (result.raw) {
    return result.raw
  }

  return `# ${fallbackTitle}\n\n暂无输出。`
}

function buildReviewArtifact(result: TaskAgentResult): string {
  return JSON.stringify(
    {
      result: result.pass ? 'pass' : 'fail',
      summary: result.summary,
      raw: result.raw,
      generatedAt: new Date().toISOString()
    },
    null,
    2
  )
}

async function runArchDesignAgent(
  task: Task,
  techReviewJson: string | null,
  options?: TaskAgentRunOptions
): Promise<TaskAgentResult> {
  return runTaskAgent(TASK_ARCH_DESIGN_AGENT_SYSTEM_PROMPT, buildArchDesignUserPrompt(task, techReviewJson), true, options)
}

async function runCodingAgent(
  task: Task,
  archDesign: string | null,
  techReviewJson: string | null,
  qaJson: string | null,
  options?: TaskAgentRunOptions
): Promise<TaskAgentResult> {
  return runTaskAgent(
    TASK_CODING_AGENT_SYSTEM_PROMPT,
    buildCodingUserPrompt(task, archDesign, techReviewJson, qaJson),
    true,
    options
  )
}

async function runDeployingAgent(
  task: Task,
  qaJson: string | null,
  codeMarkdown: string | null,
  options?: TaskAgentRunOptions
): Promise<TaskAgentResult> {
  return runTaskAgent(TASK_DEPLOYING_AGENT_SYSTEM_PROMPT, buildDeployingUserPrompt(task, qaJson, codeMarkdown), true, options)
}

async function runTechReviewAgent(task: Task, archDesign: string | null, options?: TaskAgentRunOptions): Promise<TaskAgentResult> {
  return runTaskAgent(TASK_TECH_REVIEW_AGENT_SYSTEM_PROMPT, buildTechReviewUserPrompt(task, archDesign), false, options)
}

async function runQaReviewAgent(task: Task, codeMarkdown: string | null, options?: TaskAgentRunOptions): Promise<TaskAgentResult> {
  return runTaskAgent(TASK_QA_REVIEW_AGENT_SYSTEM_PROMPT, buildQaReviewUserPrompt(task, codeMarkdown), false, options)
}

async function writeStageArtifact(task: Task, stageKey: OrchestratableTaskStatus, content: string): Promise<void> {
  const artifactDir = await resolveTaskArtifactDir(task.id)
  const fallbackFileName = STAGE_FALLBACK_ARTIFACT_FILE_NAME[stageKey]
  const fileName = resolveCurrentStageArtifactFileName(task.id, stageKey) ?? fallbackFileName
  try {
    await writeArtifact(artifactDir, fileName, content)
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : `写入产物 ${fileName} 失败`)
  }
}

async function readLatestStageArtifact(taskId: number, artifactDir: string, stageKey: TaskStatus): Promise<string | null> {
  const fileName = resolveLatestStageArtifactFileName(taskId, stageKey)
  if (!fileName) {
    return null
  }

  return readArtifactIfExists(artifactDir, fileName)
}

function findLatestRunningTaskStageRunId(taskId: number, stageKey: TaskStatus): number | null {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT id
       FROM stage_runs
       WHERE entity_type = 'task' AND entity_id = ? AND stage_key = ? AND result_status = 'running' AND end_at IS NULL
       ORDER BY start_at DESC, id DESC
       LIMIT 1`
    )
    .get(taskId, stageKey) as { id: number } | undefined

  if (!row?.id) {
    return null
  }

  return row.id
}

function persistStageRunTraceSnapshot(
  taskId: number,
  stageKey: TaskStatus,
  conversations: unknown[],
  sessionId: string | null
): void {
  try {
    const stageRunId = findLatestRunningTaskStageRunId(taskId, stageKey)
    if (!stageRunId) {
      return
    }

    updateTaskStageRunAgentTrace({
      stageRunId,
      agentProcess: stringifyAgentConversations(conversations),
      agentSessionId: sessionId
    })
    emitTaskStageTraceChanged({
      taskId,
      stageRunId,
      stageKey
    })
  } catch {
    // trace persistence failure should not block task orchestration
  }
}

function createStageRunTraceProgressHandler(taskId: number, stageKey: TaskStatus): (progress: TaskAgentProgress) => void {
  const stageRunId = findLatestRunningTaskStageRunId(taskId, stageKey)
  if (!stageRunId) {
    return () => {}
  }

  let sessionPersisted = false
  let lastBroadcastConversationCount = 0
  let lastPersistedConversationCount = 0

  return (progress: TaskAgentProgress) => {
    const sessionId = progress.sessionId?.trim() || null
    const conversationCount = progress.conversations.length

    try {
      if (sessionId && !sessionPersisted) {
        updateTaskStageRunAgentSessionId({
          stageRunId,
          agentSessionId: sessionId
        })
        sessionPersisted = true
      }

      if (conversationCount > lastPersistedConversationCount) {
        updateTaskStageRunAgentTrace({
          stageRunId,
          agentProcess: stringifyAgentConversations(progress.conversations),
          ...(sessionId ? { agentSessionId: sessionId } : {})
        })
        lastPersistedConversationCount = conversationCount
      }

      if (conversationCount <= lastBroadcastConversationCount) {
        return
      }

      lastBroadcastConversationCount = conversationCount
      emitTaskStageTraceChanged({
        taskId,
        stageRunId,
        stageKey
      })
    } catch {
      // trace persistence failure should not block task orchestration
    }
  }
}

async function persistLatestStageRunTrace(taskId: number, stageKey: TaskStatus, result: TaskAgentResult): Promise<void> {
  persistStageRunTraceSnapshot(taskId, stageKey, result.conversations, result.sessionId)
}

interface StageExecutionContext {
  task: Task
  artifactDir: string
  stageKey: OrchestratableTaskStatus
  cwd: string
}

interface StageExecutionOutput {
  result: TaskAgentResult
  artifactContent: string
  nextAction: 'arch_done' | 'review_pass' | 'review_fail' | 'coding_done' | 'qa_pass' | 'qa_fail' | 'deploy_done'
}

export interface OrchestrateTaskOptions {
  onTaskTransition?: (before: Task, after: Task) => void
}

function notifyTaskTransition(options: OrchestrateTaskOptions | undefined, before: Task, after: Task): void {
  if (!options?.onTaskTransition) {
    return
  }

  try {
    options.onTaskTransition(before, after)
  } catch {
    // transition listeners should not break task orchestration
  }
}

const STAGE_RUNNERS: Record<OrchestratableTaskStatus, (context: StageExecutionContext) => Promise<StageExecutionOutput>> = {
  arch_designing: async ({ task, artifactDir, stageKey, cwd }) => {
    const techReviewJson = await readLatestStageArtifact(task.id, artifactDir, 'tech_reviewing')
    const result = await runArchDesignAgent(task, techReviewJson, {
      cwd,
      onProgress: createStageRunTraceProgressHandler(task.id, stageKey)
    })

    return {
      result,
      artifactContent: normalizeAgentMarkdown(result, task.title),
      nextAction: 'arch_done'
    }
  },
  tech_reviewing: async ({ task, artifactDir, stageKey, cwd }) => {
    const archDesign = await readLatestStageArtifact(task.id, artifactDir, 'arch_designing')
    const result = await runTechReviewAgent(task, archDesign, {
      cwd,
      onProgress: createStageRunTraceProgressHandler(task.id, stageKey)
    })

    return {
      result,
      artifactContent: buildReviewArtifact(result),
      nextAction: result.pass ? 'review_pass' : 'review_fail'
    }
  },
  coding: async ({ task, artifactDir, stageKey, cwd }) => {
    const archDesign = await readLatestStageArtifact(task.id, artifactDir, 'arch_designing')
    const techReviewJson = await readLatestStageArtifact(task.id, artifactDir, 'tech_reviewing')
    const qaJson = await readLatestStageArtifact(task.id, artifactDir, 'qa_reviewing')
    const result = await runCodingAgent(task, archDesign, techReviewJson, qaJson, {
      cwd,
      onProgress: createStageRunTraceProgressHandler(task.id, stageKey)
    })

    return {
      result,
      artifactContent: normalizeAgentMarkdown(result, task.title),
      nextAction: 'coding_done'
    }
  },
  qa_reviewing: async ({ task, artifactDir, stageKey, cwd }) => {
    const codeMarkdown = await readLatestStageArtifact(task.id, artifactDir, 'coding')
    const result = await runQaReviewAgent(task, codeMarkdown, {
      cwd,
      onProgress: createStageRunTraceProgressHandler(task.id, stageKey)
    })

    return {
      result,
      artifactContent: buildReviewArtifact(result),
      nextAction: result.pass ? 'qa_pass' : 'qa_fail'
    }
  },
  deploying: async ({ task, artifactDir, stageKey, cwd }) => {
    const qaJson = await readLatestStageArtifact(task.id, artifactDir, 'qa_reviewing')
    const codeMarkdown = await readLatestStageArtifact(task.id, artifactDir, 'coding')
    const result = await runDeployingAgent(task, qaJson, codeMarkdown, {
      cwd,
      onProgress: createStageRunTraceProgressHandler(task.id, stageKey)
    })

    return {
      result,
      artifactContent: normalizeAgentMarkdown(result, task.title),
      nextAction: 'deploy_done'
    }
  }
}

async function runStage(
  task: Task,
  artifactDir: string,
  stageKey: OrchestratableTaskStatus,
  cwd: string,
  options?: OrchestrateTaskOptions
): Promise<void> {
  try {
    const runner = STAGE_RUNNERS[stageKey]
    const output = await runner({
      task,
      artifactDir,
      stageKey,
      cwd
    })

    await persistLatestStageRunTrace(task.id, stageKey, output.result)
    await writeStageArtifact(task, stageKey, output.artifactContent)
    const waitingTask = finalizeTaskStageWaitingHumanIfNeeded(task.id, stageKey)
    if (waitingTask) {
      notifyTaskTransition(options, task, waitingTask)
      return
    }

    const nextTask = applyTaskAction({ id: task.id, action: output.nextAction })
    notifyTaskTransition(options, task, nextTask)
  } catch (error) {
    finishTaskStageRun({
      taskId: task.id,
      stageKey,
      resultStatus: 'failed',
      failureReason: error instanceof Error ? error.message : '节点执行失败',
      artifactFileName: resolveCurrentStageArtifactFileName(task.id, stageKey)
    })
    throw error
  }
}

export async function orchestrateTask(taskId: number, options?: OrchestrateTaskOptions): Promise<Task> {
  if (!Number.isInteger(taskId) || taskId <= 0) {
    throw new Error('taskId 非法')
  }

  while (true) {
    const task = getTaskDetail(taskId)

    if (task.status === 'done' || isTaskWaitingHumanStatus(task)) {
      return task
    }

    if (task.status === 'waiting_human') {
      return task
    }

    if (task.status === 'idle') {
      const nextTask = applyTaskAction({ id: task.id, action: 'pick_next' })
      notifyTaskTransition(options, task, nextTask)
      continue
    }

    const artifactDir = await resolveTaskArtifactDir(task.id)
    const project = getProject(task.projectId)
    if (!project) {
      throw new ProjectServiceError('NOT_DIRECTORY', '任务关联项目不存在')
    }

    if (!isOrchestratableTaskStatus(task.status)) {
      throw new Error(`未知任务状态: ${task.status}`)
    }

    await runStage(task, artifactDir, task.status, project.path, options)
    continue
  }
}
