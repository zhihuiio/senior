import type {
  Project,
  Requirement,
  RequirementConversationMessage,
  RequirementStatus,
  RequirementTransitionAction,
  Task,
  TaskAgentTraceMessage,
  RequirementStageRun,
  TaskStatus,
  TaskStageRun,
  TaskTransitionAction,
  TaskHumanCommand,
  TaskWaitingContext
} from './types'

export const IPC_CHANNELS = {
  AGENT_ASK: 'agent:ask',
  PROJECT_CREATE: 'project:create',
  PROJECT_LIST: 'project:list',
  PROJECT_REVEAL_IN_FINDER: 'project:revealInFinder',
  DIALOG_SELECT_DIRECTORY: 'dialog:selectDirectory',
  REQUIREMENT_CREATE: 'requirement:create',
  REQUIREMENT_LIST_BY_PROJECT: 'requirement:listByProject',
  REQUIREMENT_UPDATE: 'requirement:update',
  REQUIREMENT_APPLY_ACTION: 'requirement:applyAction',
  REQUIREMENT_PROCESS: 'requirement:process',
  REQUIREMENT_GET_CONVERSATION: 'requirement:getConversation',
  REQUIREMENT_REPLY_CONVERSATION: 'requirement:replyConversation',
  REQUIREMENT_AUTO_PROCESSOR_START: 'requirement:autoProcessor:start',
  REQUIREMENT_AUTO_PROCESSOR_STOP: 'requirement:autoProcessor:stop',
  REQUIREMENT_AUTO_PROCESSOR_STATUS: 'requirement:autoProcessor:status',
  REQUIREMENT_STATUS_CHANGED: 'requirement:statusChanged',
  REQUIREMENT_STAGE_RUN_CHANGED: 'requirement:stageRunChanged',
  TASK_STATUS_CHANGED: 'task:statusChanged',
  TASK_STAGE_TRACE_CHANGED: 'task:stageTraceChanged',
  TASK_AUTO_PROCESSOR_START: 'task:autoProcessor:start',
  TASK_AUTO_PROCESSOR_STOP: 'task:autoProcessor:stop',
  TASK_AUTO_PROCESSOR_STATUS: 'task:autoProcessor:status',
  TASK_CREATE: 'task:create',
  TASK_LIST_BY_REQUIREMENT: 'task:listByRequirement',
  TASK_LIST_BY_PROJECT: 'task:listByProject',
  TASK_UPDATE: 'task:update',
  TASK_APPLY_ACTION: 'task:applyAction',
  TASK_HUMAN_COMMAND: 'task:humanCommand',
  TASK_HUMAN_CONVERSATION_GET: 'task:humanConversation:get',
  TASK_HUMAN_CONVERSATION_REPLY: 'task:humanConversation:reply',
  TASK_ORCHESTRATE: 'task:orchestrate',
  TASK_ARTIFACT_LIST: 'task:artifact:list',
  TASK_ARTIFACT_READ: 'task:artifact:read',
  REQUIREMENT_STAGE_RUN_TRACE_GET: 'requirement:stageRun:traceGet',
  TASK_STAGE_RUN_LIST: 'task:stageRun:list',
  TASK_STAGE_RUN_TRACE_GET: 'task:stageRun:traceGet',
  REQUIREMENT_STAGE_RUN_LIST: 'requirement:stageRun:list'
} as const

export interface AgentAskReq {
  prompt: string
  projectId?: number
}

export interface AgentAskOk {
  ok: true
  data: {
    text: string
  }
}

export interface AgentAskErr {
  ok: false
  error: {
    code: string
    message: string
  }
}

export type AgentAskResult = AgentAskOk | AgentAskErr

export interface ProjectCreateReq {
  path: string
}

export interface ProjectCreateOk {
  ok: true
  data: {
    project: Project
  }
}

export interface ProjectCreateErr {
  ok: false
  error: {
    code: string
    message: string
  }
}

export type ProjectCreateResult = ProjectCreateOk | ProjectCreateErr

export interface ProjectListOk {
  ok: true
  data: {
    projects: Project[]
  }
}

export interface ProjectListErr {
  ok: false
  error: {
    code: string
    message: string
  }
}

export type ProjectListResult = ProjectListOk | ProjectListErr

export interface ProjectRevealInFinderReq {
  path: string
}

export interface ProjectRevealInFinderOk {
  ok: true
  data: {
    opened: boolean
  }
}

export interface ProjectRevealInFinderErr {
  ok: false
  error: {
    code: string
    message: string
  }
}

export type ProjectRevealInFinderResult = ProjectRevealInFinderOk | ProjectRevealInFinderErr

export interface RequirementCreateReq {
  projectId: number
  title: string
  content?: string
  source?: string
}

export interface RequirementCreateOk {
  ok: true
  data: {
    requirement: Requirement
  }
}

export interface RequirementCreateErr {
  ok: false
  error: {
    code: string
    message: string
  }
}

export type RequirementCreateResult = RequirementCreateOk | RequirementCreateErr

export interface RequirementListByProjectReq {
  projectId: number
}

export interface RequirementListByProjectOk {
  ok: true
  data: {
    requirements: Requirement[]
  }
}

export interface RequirementListByProjectErr {
  ok: false
  error: {
    code: string
    message: string
  }
}

export type RequirementListByProjectResult = RequirementListByProjectOk | RequirementListByProjectErr

export interface RequirementUpdateReq {
  id: number
  title: string
  content?: string
  status: RequirementStatus
  source: string
}

export interface RequirementUpdateOk {
  ok: true
  data: {
    requirement: Requirement
  }
}

export interface RequirementUpdateErr {
  ok: false
  error: {
    code: string
    message: string
  }
}

export type RequirementUpdateResult = RequirementUpdateOk | RequirementUpdateErr

export interface RequirementApplyActionReq {
  id: number
  action: RequirementTransitionAction
}

export interface RequirementApplyActionOk {
  ok: true
  data: {
    requirement: Requirement
  }
}

export interface RequirementApplyActionErr {
  ok: false
  error: {
    code: string
    message: string
  }
}

export type RequirementApplyActionResult = RequirementApplyActionOk | RequirementApplyActionErr

export interface RequirementProcessReq {
  requirementId: number
  type: string
  source: string
}

export interface RequirementProcessOk {
  ok: true
  data: {
    requirement: Requirement
    resultType: 'pass' | 'fail' | 'pending'
  }
}

export interface RequirementProcessErr {
  ok: false
  error: {
    code: string
    message: string
  }
}

export type RequirementProcessResult = RequirementProcessOk | RequirementProcessErr

export interface RequirementGetConversationReq {
  requirementId: number
  sessionId?: string
}

export interface RequirementGetConversationOk {
  ok: true
  data: {
    requirement: Requirement
    messages: RequirementConversationMessage[]
  }
}

export interface RequirementGetConversationErr {
  ok: false
  error: {
    code: string
    message: string
  }
}

export type RequirementGetConversationResult = RequirementGetConversationOk | RequirementGetConversationErr

export interface RequirementReplyConversationReq {
  requirementId: number
  message: string
}

export interface RequirementReplyConversationOk {
  ok: true
  data: {
    requirement: Requirement
    messages: RequirementConversationMessage[]
  }
}

export interface RequirementReplyConversationErr {
  ok: false
  error: {
    code: string
    message: string
  }
}

export type RequirementReplyConversationResult = RequirementReplyConversationOk | RequirementReplyConversationErr

export interface RequirementAutoProcessorStartReq {}

export interface AutoProcessorStatusData {
  running: boolean
  startedAt: number | null
}

export interface RequirementAutoProcessorStartOk {
  ok: true
  data: AutoProcessorStatusData
}

export interface RequirementAutoProcessorStartErr {
  ok: false
  error: {
    code: string
    message: string
  }
}

export type RequirementAutoProcessorStartResult = RequirementAutoProcessorStartOk | RequirementAutoProcessorStartErr

export interface RequirementAutoProcessorStopOk {
  ok: true
  data: AutoProcessorStatusData
}

export interface RequirementAutoProcessorStopErr {
  ok: false
  error: {
    code: string
    message: string
  }
}

export type RequirementAutoProcessorStopResult = RequirementAutoProcessorStopOk | RequirementAutoProcessorStopErr

export interface RequirementAutoProcessorStatusOk {
  ok: true
  data: AutoProcessorStatusData
}

export interface RequirementAutoProcessorStatusErr {
  ok: false
  error: {
    code: string
    message: string
  }
}

export type RequirementAutoProcessorStatusResult = RequirementAutoProcessorStatusOk | RequirementAutoProcessorStatusErr

export interface RequirementStageRunListReq {
  requirementId: number
}

export interface RequirementStageRunTraceGetReq {
  stageRunId: number
}

export interface RequirementStageRunListOk {
  ok: true
  data: {
    stageRuns: RequirementStageRun[]
  }
}

export interface RequirementStageRunListErr {
  ok: false
  error: {
    code: string
    message: string
  }
}

export type RequirementStageRunListResult = RequirementStageRunListOk | RequirementStageRunListErr

export interface RequirementStageRunTraceGetOk {
  ok: true
  data: {
    stageRun: RequirementStageRun
    messages: TaskAgentTraceMessage[]
  }
}

export interface RequirementStageRunTraceGetErr {
  ok: false
  error: {
    code: string
    message: string
  }
}

export type RequirementStageRunTraceGetResult = RequirementStageRunTraceGetOk | RequirementStageRunTraceGetErr

export interface RequirementStatusChangedEvent {
  requirementId: number
  projectId: number
  status: RequirementStatus
}

export interface RequirementStageRunChangedEvent {
  requirementId: number
  stageRunId: number
  stageKey: Extract<RequirementStatus, 'evaluating' | 'prd_designing' | 'prd_reviewing'>
}

export interface TaskStatusChangedEvent {
  taskId: number
  projectId: number
  status: TaskStatus
  waitingContext: TaskWaitingContext | null
}

export interface TaskStageTraceChangedEvent {
  taskId: number
  stageRunId: number
  stageKey: TaskStatus
}

export interface TaskAutoProcessorStartReq {}

export interface TaskAutoProcessorStartOk {
  ok: true
  data: AutoProcessorStatusData
}

export interface TaskAutoProcessorStartErr {
  ok: false
  error: {
    code: string
    message: string
  }
}

export type TaskAutoProcessorStartResult = TaskAutoProcessorStartOk | TaskAutoProcessorStartErr

export interface TaskAutoProcessorStopOk {
  ok: true
  data: AutoProcessorStatusData
}

export interface TaskAutoProcessorStopErr {
  ok: false
  error: {
    code: string
    message: string
  }
}

export type TaskAutoProcessorStopResult = TaskAutoProcessorStopOk | TaskAutoProcessorStopErr

export interface TaskAutoProcessorStatusOk {
  ok: true
  data: AutoProcessorStatusData
}

export interface TaskAutoProcessorStatusErr {
  ok: false
  error: {
    code: string
    message: string
  }
}

export type TaskAutoProcessorStatusResult = TaskAutoProcessorStatusOk | TaskAutoProcessorStatusErr

export interface TaskCreateReq {
  projectId: number
  requirementId?: number | null
  title: string
  content?: string
}

export interface TaskCreateOk {
  ok: true
  data: {
    task: Task
  }
}

export interface TaskCreateErr {
  ok: false
  error: {
    code: string
    message: string
  }
}

export type TaskCreateResult = TaskCreateOk | TaskCreateErr

export interface TaskListByRequirementReq {
  requirementId: number
}

export interface TaskListByRequirementOk {
  ok: true
  data: {
    tasks: Task[]
  }
}

export interface TaskListByRequirementErr {
  ok: false
  error: {
    code: string
    message: string
  }
}

export type TaskListByRequirementResult = TaskListByRequirementOk | TaskListByRequirementErr

export interface TaskListByProjectReq {
  projectId: number
}

export interface TaskListByProjectOk {
  ok: true
  data: {
    tasks: Task[]
  }
}

export interface TaskListByProjectErr {
  ok: false
  error: {
    code: string
    message: string
  }
}

export type TaskListByProjectResult = TaskListByProjectOk | TaskListByProjectErr

export interface TaskUpdateReq {
  id: number
  title: string
  content?: string
  status: TaskStatus
}

export interface TaskUpdateOk {
  ok: true
  data: {
    task: Task
  }
}

export interface TaskUpdateErr {
  ok: false
  error: {
    code: string
    message: string
  }
}

export type TaskUpdateResult = TaskUpdateOk | TaskUpdateErr

export interface TaskApplyActionReq {
  id: number
  action: TaskTransitionAction
}

export interface TaskApplyActionOk {
  ok: true
  data: {
    task: Task
  }
}

export interface TaskApplyActionErr {
  ok: false
  error: {
    code: string
    message: string
  }
}

export type TaskApplyActionResult = TaskApplyActionOk | TaskApplyActionErr

export interface TaskHumanCommandReq {
  id: number
  command: TaskHumanCommand
  note?: string
}

export interface TaskHumanCommandOk {
  ok: true
  data: {
    task: Task
  }
}

export interface TaskHumanCommandErr {
  ok: false
  error: {
    code: string
    message: string
  }
}

export type TaskHumanCommandResult = TaskHumanCommandOk | TaskHumanCommandErr

export interface TaskHumanConversationGetReq {
  taskId: number
}

export interface TaskHumanConversationGetOk {
  ok: true
  data: {
    task: Task
    waitingContext: TaskWaitingContext
    messages: TaskAgentTraceMessage[]
  }
}

export interface TaskHumanConversationGetErr {
  ok: false
  error: {
    code: string
    message: string
  }
}

export type TaskHumanConversationGetResult = TaskHumanConversationGetOk | TaskHumanConversationGetErr

export interface TaskHumanConversationReplyReq {
  taskId: number
  message: string
}

export interface TaskHumanConversationReplyOk {
  ok: true
  data: {
    task: Task
    waitingContext: TaskWaitingContext
    messages: TaskAgentTraceMessage[]
  }
}

export interface TaskHumanConversationReplyErr {
  ok: false
  error: {
    code: string
    message: string
  }
}

export type TaskHumanConversationReplyResult = TaskHumanConversationReplyOk | TaskHumanConversationReplyErr

export interface TaskOrchestrateReq {
  taskId: number
}

export interface TaskOrchestrateOk {
  ok: true
  data: {
    task: Task
  }
}

export interface TaskOrchestrateErr {
  ok: false
  error: {
    code: string
    message: string
  }
}

export type TaskOrchestrateResult = TaskOrchestrateOk | TaskOrchestrateErr

export interface TaskArtifactListReq {
  taskId: number
}

export interface TaskArtifactFile {
  fileName: string
  size: number
  updatedAt: number
}

export interface TaskArtifactListOk {
  ok: true
  data: {
    files: TaskArtifactFile[]
  }
}

export interface TaskArtifactListErr {
  ok: false
  error: {
    code: string
    message: string
  }
}

export type TaskArtifactListResult = TaskArtifactListOk | TaskArtifactListErr

export interface TaskArtifactReadReq {
  taskId: number
  fileName: string
}

export interface TaskArtifactReadOk {
  ok: true
  data: {
    content: string
  }
}

export interface TaskArtifactReadErr {
  ok: false
  error: {
    code: string
    message: string
  }
}

export type TaskArtifactReadResult = TaskArtifactReadOk | TaskArtifactReadErr

export interface TaskStageRunListReq {
  taskId: number
}

export interface TaskStageRunListOk {
  ok: true
  data: {
    stageRuns: TaskStageRun[]
  }
}

export interface TaskStageRunListErr {
  ok: false
  error: {
    code: string
    message: string
  }
}

export type TaskStageRunListResult = TaskStageRunListOk | TaskStageRunListErr

export interface TaskStageRunTraceGetReq {
  stageRunId: number
}

export interface TaskStageRunTraceGetOk {
  ok: true
  data: {
    stageRun: TaskStageRun
    messages: TaskAgentTraceMessage[]
  }
}

export interface TaskStageRunTraceGetErr {
  ok: false
  error: {
    code: string
    message: string
  }
}

export type TaskStageRunTraceGetResult = TaskStageRunTraceGetOk | TaskStageRunTraceGetErr
