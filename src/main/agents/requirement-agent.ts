import { AgentRunnerError, runAgentQuery } from './agent-runner'
import {
  buildRequirementEvaluationUserPrompt,
  buildRequirementReviewUserPrompt,
  buildRequirementUserPrompt,
  REQUIREMENT_EVALUATION_AGENT_SYSTEM_PROMPT,
  REQUIREMENT_PRD_DESIGN_AGENT_SYSTEM_PROMPT,
  REQUIREMENT_REVIEW_AGENT_SYSTEM_PROMPT
} from './prompts'

export const REQUIREMENT_PRD_DESIGN_SYSTEM_PROMPT = REQUIREMENT_PRD_DESIGN_AGENT_SYSTEM_PROMPT
export const REQUIREMENT_EVALUATION_SYSTEM_PROMPT = REQUIREMENT_EVALUATION_AGENT_SYSTEM_PROMPT
export const REQUIREMENT_REVIEW_SYSTEM_PROMPT = REQUIREMENT_REVIEW_AGENT_SYSTEM_PROMPT

export type RequirementAgentDecision = {
  type: 'prd'
  prd: string
  subTasks: Array<{ title: string; content: string }>
}

export type RequirementReviewDecision = {
  type: 'review'
  result: 'pass' | 'fail'
  summary: string
}

export type RequirementEvaluationDecision = {
  type: 'evaluation'
  result: 'reasonable' | 'unreasonable'
  summary: string
}

export interface RequirementAgentInput {
  requirement: string
  source: string
  promptMode?: 'full_context' | 'followup'
  projectPath?: string
}

export interface RequirementReviewAgentInput {
  requirement: string
  source: string
  prd: string
  subTasks: Array<{ title: string; content: string }>
  projectPath?: string
}

export interface RequirementEvaluationAgentInput {
  requirement: string
  source: string
  projectPath?: string
}

export interface RequirementAgentRunResult {
  decision: RequirementAgentDecision
  conversations: unknown[]
  sessionId: string | null
}

export interface RequirementReviewAgentRunResult {
  decision: RequirementReviewDecision
  conversations: unknown[]
  sessionId: string | null
}

export interface RequirementEvaluationAgentRunResult {
  decision: RequirementEvaluationDecision
  conversations: unknown[]
  sessionId: string | null
}

export interface RequirementAgentProgress {
  sessionId: string | null
}

export interface RequirementAgentRunOptions {
  onProgress?: (progress: RequirementAgentProgress) => void
}

export class RequirementAgentRunError extends Error {
  constructor(
    message: string,
    public readonly conversations: unknown[],
    public readonly sessionId: string | null = null
  ) {
    super(message)
  }
}

function extractJson(raw: string): string {
  const text = raw.trim()
  if (text.startsWith('{') && text.endsWith('}')) {
    return text
  }

  const block = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (block?.[1]) {
    return block[1].trim()
  }

  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) {
    return text.slice(start, end + 1)
  }

  throw new Error('RequirementAgent 返回内容不是 JSON 对象')
}

function parseSubTasks(value: unknown): Array<{ title: string; content: string }> {
  if (!Array.isArray(value)) {
    return []
  }

  const normalized: Array<{ title: string; content: string }> = []
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      continue
    }

    const record = item as Record<string, unknown>
    const title = typeof record.title === 'string' ? record.title.trim() : ''
    if (!title) {
      continue
    }
    const content = typeof record.content === 'string' ? record.content.trim() : ''
    normalized.push({ title, content })
  }

  if (normalized.length === 0) {
    throw new Error('RequirementAgent subTasks 不能为空')
  }

  return normalized
}

function parseDecision(raw: string): RequirementAgentDecision {
  const payload = JSON.parse(extractJson(raw)) as Record<string, unknown>
  const type = payload.type
  if (type !== 'prd') {
    throw new Error('RequirementAgent 返回了不支持的 type')
  }

  const prd = typeof payload.prd === 'string' ? payload.prd.trim() : ''
  if (!prd) {
    throw new Error('RequirementAgent prd 为空')
  }

  const subTasks = parseSubTasks(payload.subTasks)
  return {
    type: 'prd',
    prd,
    subTasks
  }
}

function parseReviewDecision(raw: string): RequirementReviewDecision {
  const payload = JSON.parse(extractJson(raw)) as Record<string, unknown>
  const type = payload.type
  if (type !== 'review') {
    throw new Error('RequirementReviewAgent 返回了不支持的 type')
  }

  const result = payload.result
  if (result !== 'pass' && result !== 'fail') {
    throw new Error('RequirementReviewAgent result 非法')
  }

  const summary = typeof payload.summary === 'string' ? payload.summary.trim() : ''
  if (!summary) {
    throw new Error('RequirementReviewAgent summary 不能为空')
  }

  return {
    type: 'review',
    result,
    summary
  }
}

function parseEvaluationDecision(raw: string): RequirementEvaluationDecision {
  const payload = JSON.parse(extractJson(raw)) as Record<string, unknown>
  const type = payload.type
  if (type !== 'evaluation') {
    throw new Error('RequirementEvaluationAgent 返回了不支持的 type')
  }

  const result = payload.result
  if (result !== 'reasonable' && result !== 'unreasonable') {
    throw new Error('RequirementEvaluationAgent result 非法')
  }

  const summary = typeof payload.summary === 'string' ? payload.summary.trim() : ''
  if (!summary) {
    throw new Error('RequirementEvaluationAgent summary 不能为空')
  }

  return {
    type: 'evaluation',
    result,
    summary
  }
}

function buildUserPrompt(input: RequirementAgentInput): string {
  return buildRequirementUserPrompt(input)
}

function buildEvaluationUserPrompt(input: RequirementEvaluationAgentInput): string {
  return buildRequirementEvaluationUserPrompt(input)
}

function buildReviewUserPrompt(input: RequirementReviewAgentInput): string {
  return buildRequirementReviewUserPrompt(input)
}

async function runRequirementAgentInternal(
  prompt: string,
  systemPrompt: string,
  resumeSessionId: string | undefined,
  cwd: string | undefined,
  options?: RequirementAgentRunOptions
): Promise<{ resultText: string; conversations: unknown[]; sessionId: string | null }> {
  try {
    const runnerResult = await runAgentQuery({
      prompt,
      systemPrompt,
      resumeSessionId,
      cwd,
      errorMessage: 'RequirementAgent 执行失败',
      noResultMessage: 'RequirementAgent 未收到结果',
      onProgress: (progress) => {
        options?.onProgress?.({
          sessionId: progress.sessionId
        })
      }
    })

    return runnerResult
  } catch (error) {
    if (error instanceof AgentRunnerError) {
      throw new RequirementAgentRunError(error.message, error.conversations, error.sessionId)
    }

    throw new RequirementAgentRunError(
      error instanceof Error ? error.message : 'RequirementAgent 执行失败',
      [],
      resumeSessionId ?? null
    )
  }
}

export class RequirementAgent {
  static async run(input: RequirementAgentInput): Promise<RequirementAgentDecision> {
    const agent = new RequirementAgent()
    return agent.decide(input)
  }

  static async runWithConversations(
    input: RequirementAgentInput,
    resumeSessionId?: string,
    options?: RequirementAgentRunOptions
  ): Promise<RequirementAgentRunResult> {
    const agent = new RequirementAgent()
    return agent.decideWithConversations(input, resumeSessionId, options)
  }

  async run(input: RequirementAgentInput): Promise<RequirementAgentDecision> {
    return this.decide(input)
  }

  async runWithConversations(
    input: RequirementAgentInput,
    resumeSessionId?: string,
    options?: RequirementAgentRunOptions
  ): Promise<RequirementAgentRunResult> {
    return this.decideWithConversations(input, resumeSessionId, options)
  }

  async decide(input: RequirementAgentInput, resumeSessionId?: string, options?: RequirementAgentRunOptions): Promise<RequirementAgentDecision> {
    const result = await this.decideWithConversations(input, resumeSessionId, options)
    return result.decision
  }

  async decideWithConversations(
    input: RequirementAgentInput,
    resumeSessionId?: string,
    options?: RequirementAgentRunOptions
  ): Promise<RequirementAgentRunResult> {
    const requirement = input.requirement.trim()
    const source = input.source.trim()
    const projectPath = input.projectPath?.trim()

    if (!requirement) {
      throw new Error('原始需求不能为空')
    }

    if (!source) {
      throw new Error('需求来源不能为空')
    }

    const runnerResult = await runRequirementAgentInternal(
      buildUserPrompt({ requirement, source, promptMode: input.promptMode }),
      REQUIREMENT_PRD_DESIGN_SYSTEM_PROMPT,
      resumeSessionId,
      projectPath,
      options
    )

    try {
      const decision = parseDecision(runnerResult.resultText)
      return {
        decision,
        conversations: runnerResult.conversations,
        sessionId: runnerResult.sessionId
      }
    } catch (error) {
      throw new RequirementAgentRunError(
        error instanceof Error ? error.message : 'RequirementAgent 返回结果解析失败',
        runnerResult.conversations,
        runnerResult.sessionId
      )
    }
  }
}

export class RequirementReviewAgent {
  static async run(input: RequirementReviewAgentInput): Promise<RequirementReviewDecision> {
    const agent = new RequirementReviewAgent()
    return agent.decide(input)
  }

  static async runWithConversations(
    input: RequirementReviewAgentInput,
    resumeSessionId?: string,
    options?: RequirementAgentRunOptions
  ): Promise<RequirementReviewAgentRunResult> {
    const agent = new RequirementReviewAgent()
    return agent.decideWithConversations(input, resumeSessionId, options)
  }

  async decide(input: RequirementReviewAgentInput, resumeSessionId?: string, options?: RequirementAgentRunOptions): Promise<RequirementReviewDecision> {
    const result = await this.decideWithConversations(input, resumeSessionId, options)
    return result.decision
  }

  async decideWithConversations(
    input: RequirementReviewAgentInput,
    resumeSessionId?: string,
    options?: RequirementAgentRunOptions
  ): Promise<RequirementReviewAgentRunResult> {
    const requirement = input.requirement.trim()
    const source = input.source.trim()
    const prd = input.prd.trim()
    const projectPath = input.projectPath?.trim()
    if (!requirement) {
      throw new Error('原始需求不能为空')
    }
    if (!source) {
      throw new Error('需求来源不能为空')
    }
    if (!prd) {
      throw new Error('PRD 不能为空')
    }
    if (!Array.isArray(input.subTasks) || input.subTasks.length === 0) {
      throw new Error('subTasks 不能为空')
    }
    const runnerResult = await runRequirementAgentInternal(
      buildReviewUserPrompt({
        requirement,
        source,
        prd,
        subTasks: input.subTasks
      }),
      REQUIREMENT_REVIEW_SYSTEM_PROMPT,
      resumeSessionId,
      projectPath,
      options
    )

    try {
      const decision = parseReviewDecision(runnerResult.resultText)
      return {
        decision,
        conversations: runnerResult.conversations,
        sessionId: runnerResult.sessionId
      }
    } catch (error) {
      throw new RequirementAgentRunError(
        error instanceof Error ? error.message : 'RequirementReviewAgent 返回结果解析失败',
        runnerResult.conversations,
        runnerResult.sessionId
      )
    }
  }
}

export class RequirementEvaluationAgent {
  static async run(input: RequirementEvaluationAgentInput): Promise<RequirementEvaluationDecision> {
    const agent = new RequirementEvaluationAgent()
    return agent.decide(input)
  }

  static async runWithConversations(
    input: RequirementEvaluationAgentInput,
    resumeSessionId?: string,
    options?: RequirementAgentRunOptions
  ): Promise<RequirementEvaluationAgentRunResult> {
    const agent = new RequirementEvaluationAgent()
    return agent.decideWithConversations(input, resumeSessionId, options)
  }

  async decide(input: RequirementEvaluationAgentInput, resumeSessionId?: string, options?: RequirementAgentRunOptions): Promise<RequirementEvaluationDecision> {
    const result = await this.decideWithConversations(input, resumeSessionId, options)
    return result.decision
  }

  async decideWithConversations(
    input: RequirementEvaluationAgentInput,
    resumeSessionId?: string,
    options?: RequirementAgentRunOptions
  ): Promise<RequirementEvaluationAgentRunResult> {
    const requirement = input.requirement.trim()
    const source = input.source.trim()
    const projectPath = input.projectPath?.trim()
    if (!requirement) {
      throw new Error('原始需求不能为空')
    }
    if (!source) {
      throw new Error('需求来源不能为空')
    }

    const runnerResult = await runRequirementAgentInternal(
      buildEvaluationUserPrompt({
        requirement,
        source
      }),
      REQUIREMENT_EVALUATION_SYSTEM_PROMPT,
      resumeSessionId,
      projectPath,
      options
    )

    try {
      const decision = parseEvaluationDecision(runnerResult.resultText)
      return {
        decision,
        conversations: runnerResult.conversations,
        sessionId: runnerResult.sessionId
      }
    } catch (error) {
      throw new RequirementAgentRunError(
        error instanceof Error ? error.message : 'RequirementEvaluationAgent 返回结果解析失败',
        runnerResult.conversations,
        runnerResult.sessionId
      )
    }
  }
}

export async function runRequirementAgent(input: RequirementAgentInput): Promise<RequirementAgentDecision> {
  return RequirementAgent.run(input)
}

export async function runRequirementReviewAgent(input: RequirementReviewAgentInput): Promise<RequirementReviewDecision> {
  return RequirementReviewAgent.run(input)
}
