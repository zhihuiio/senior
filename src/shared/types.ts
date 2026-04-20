export type Role = 'user' | 'assistant'

export interface Message {
  id: string
  role: Role
  content: string
  createdAt: number
}

export interface Session {
  id: string
  messages: Message[]
}

export interface Project {
  id: number
  path: string
}

export type AgentSdkType = 'claude' | 'codex'

export interface AppSettings {
  agentSdkType: AgentSdkType
}

export type RequirementStatus = 'pending' | 'evaluating' | 'prd_designing' | 'prd_reviewing' | 'queued' | 'canceled'

export type RequirementTransitionAction =
  | 'grab'
  | 'evaluate_pass'
  | 'evaluate_fail'
  | 'design_done'
  | 'review_pass'
  | 'review_fail'
  | 'error'
  | 'timeout'
  | 'accept'
  | 'clarify'
  | 'human_reply'
  | 'skip'
  | 'retry'

export interface RequirementSubTaskDraft {
  title: string
  content: string
}

export type RequirementStandardizedData =
  | {
      type: 'evaluation'
      result: 'reasonable' | 'unreasonable'
      summary: string
    }
  | {
      type: 'prd'
      prd: string
      subTasks: RequirementSubTaskDraft[]
    }
  | {
      type: 'review'
      result: 'pass' | 'fail'
      summary: string
    }
  | { type: 'accept'; standardized: string }
  | { type: 'clarify'; question: string }
  | { type: 'skip'; reason: string }

export type RequirementWaitingContext = 'prd_review_gate'

export interface RequirementConversationMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface Requirement {
  id: number
  projectId: number
  title: string
  content: string
  status: RequirementStatus
  source: string
  standardizedData: RequirementStandardizedData | null
  prdReviewRejectCount: number
  waitingContext: RequirementWaitingContext | null
  humanRevisionNote: string
  agentProcess: string
  agentSessionId: string | null
  createdAt: number
  updatedAt: number
}

export type TaskStatus =
  | 'idle'
  | 'arch_designing'
  | 'tech_reviewing'
  | 'waiting_human'
  | 'coding'
  | 'qa_reviewing'
  | 'deploying'
  | 'done'

export type TaskWaitingContext = 'tech_review_gate' | 'qa_gate' | 'arch_design_gate' | 'coding_gate'

export type TaskTransitionAction =
  | 'pick_next'
  | 'arch_done'
  | 'review_pass'
  | 'review_fail'
  | 'coding_done'
  | 'qa_pass'
  | 'qa_fail'
  | 'deploy_done'

export type TaskHumanCommand = 'force_pass' | 'cancel' | 'revise'

export interface Task {
  id: number
  projectId: number
  requirementId: number | null
  title: string
  content: string
  status: TaskStatus
  techReviewRejectCount: number
  qaRejectCount: number
  waitingContext: TaskWaitingContext | null
  humanRevisionNote: string
  createdAt: number
  updatedAt: number
}

export type StageRunResultStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'waiting_human'

export interface StageRun {
  id: number
  entityType: 'task' | 'requirement'
  entityId: number
  stageKey: string
  round: number
  startAt: number
  endAt: number | null
  resultStatus: StageRunResultStatus
  failureReason: string
  artifactFileNames: string[]
  agentProcess: string
  agentSessionId: string | null
  createdAt: number
  updatedAt: number
}

export interface TaskStageRun {
  id: number
  taskId: number
  stageKey: TaskStatus
  round: number
  startAt: number
  endAt: number | null
  resultStatus: StageRunResultStatus
  failureReason: string
  artifactFileNames: string[]
  agentProcess: string
  agentSessionId: string | null
  createdAt: number
  updatedAt: number
}

export interface RequirementStageRun {
  id: number
  requirementId: number
  stageKey: Extract<RequirementStatus, 'evaluating' | 'prd_designing' | 'prd_reviewing'>
  round: number
  startAt: number
  endAt: number | null
  resultStatus: StageRunResultStatus
  failureReason: string
  artifactFileNames: string[]
  agentProcess: string
  agentSessionId: string | null
  createdAt: number
  updatedAt: number
}

export interface TaskAgentTraceMessage {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  messageType?: string
  toolCallId?: string
  toolName?: string
  isError?: boolean
}
