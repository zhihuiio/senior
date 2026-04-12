import { contextBridge, ipcRenderer } from 'electron'
import type {
  AgentAskReq,
  AgentAskResult,
  ProjectCreateReq,
  ProjectCreateResult,
  ProjectListResult,
  ProjectRevealInFinderReq,
  ProjectRevealInFinderResult,
  RequirementCreateReq,
  RequirementCreateResult,
  RequirementListByProjectReq,
  RequirementListByProjectResult,
  RequirementUpdateReq,
  RequirementUpdateResult,
  RequirementApplyActionReq,
  RequirementApplyActionResult,
  RequirementProcessReq,
  RequirementProcessResult,
  RequirementGetConversationReq,
  RequirementGetConversationResult,
  RequirementReplyConversationReq,
  RequirementReplyConversationResult,
  RequirementAutoProcessorStartReq,
  RequirementAutoProcessorStartResult,
  RequirementAutoProcessorStopResult,
  RequirementAutoProcessorStatusResult,
  RequirementStageRunListReq,
  RequirementStageRunListResult,
  TaskAutoProcessorStartReq,
  TaskAutoProcessorStartResult,
  TaskAutoProcessorStopResult,
  TaskAutoProcessorStatusResult,
  TaskCreateReq,
  TaskCreateResult,
  TaskListByProjectReq,
  TaskListByProjectResult,
  TaskListByRequirementReq,
  TaskListByRequirementResult,
  TaskUpdateReq,
  TaskUpdateResult,
  TaskApplyActionReq,
  TaskApplyActionResult,
  TaskHumanCommandReq,
  TaskHumanCommandResult,
  TaskHumanConversationGetReq,
  TaskHumanConversationGetResult,
  TaskHumanConversationReplyReq,
  TaskHumanConversationReplyResult,
  TaskOrchestrateReq,
  TaskOrchestrateResult,
  TaskArtifactListReq,
  TaskArtifactListResult,
  TaskArtifactReadReq,
  TaskArtifactReadResult,
  TaskStageRunListReq,
  TaskStageRunListResult,
  TaskStageRunTraceGetReq,
  TaskStageRunTraceGetResult,
  RequirementStatusChangedEvent,
  TaskStatusChangedEvent,
  TaskStageTraceChangedEvent
} from '../shared/ipc'
import { IPC_CHANNELS } from '../shared/ipc'

export interface RendererApi {
  sendPrompt(req: AgentAskReq): Promise<AgentAskResult>
  createProject(req: ProjectCreateReq): Promise<ProjectCreateResult>
  listProjects(): Promise<ProjectListResult>
  revealProjectInFinder(req: ProjectRevealInFinderReq): Promise<ProjectRevealInFinderResult>
  selectDirectory(): Promise<string | null>
  createRequirement(req: RequirementCreateReq): Promise<RequirementCreateResult>
  listRequirementsByProject(req: RequirementListByProjectReq): Promise<RequirementListByProjectResult>
  updateRequirement(req: RequirementUpdateReq): Promise<RequirementUpdateResult>
  applyRequirementAction(req: RequirementApplyActionReq): Promise<RequirementApplyActionResult>
  processRequirement(req: RequirementProcessReq): Promise<RequirementProcessResult>
  getRequirementConversation(req: RequirementGetConversationReq): Promise<RequirementGetConversationResult>
  replyRequirementConversation(req: RequirementReplyConversationReq): Promise<RequirementReplyConversationResult>
  startRequirementAutoProcessor(req?: RequirementAutoProcessorStartReq): Promise<RequirementAutoProcessorStartResult>
  stopRequirementAutoProcessor(): Promise<RequirementAutoProcessorStopResult>
  getRequirementAutoProcessorStatus(): Promise<RequirementAutoProcessorStatusResult>
  listRequirementStageRuns(req: RequirementStageRunListReq): Promise<RequirementStageRunListResult>
  startTaskAutoProcessor(req?: TaskAutoProcessorStartReq): Promise<TaskAutoProcessorStartResult>
  stopTaskAutoProcessor(): Promise<TaskAutoProcessorStopResult>
  getTaskAutoProcessorStatus(): Promise<TaskAutoProcessorStatusResult>
  createTask(req: TaskCreateReq): Promise<TaskCreateResult>
  listTasksByRequirement(req: TaskListByRequirementReq): Promise<TaskListByRequirementResult>
  listTasksByProject(req: TaskListByProjectReq): Promise<TaskListByProjectResult>
  updateTask(req: TaskUpdateReq): Promise<TaskUpdateResult>
  applyTaskAction(req: TaskApplyActionReq): Promise<TaskApplyActionResult>
  applyTaskHumanCommand(req: TaskHumanCommandReq): Promise<TaskHumanCommandResult>
  getTaskHumanConversation(req: TaskHumanConversationGetReq): Promise<TaskHumanConversationGetResult>
  replyTaskHumanConversation(req: TaskHumanConversationReplyReq): Promise<TaskHumanConversationReplyResult>
  orchestrateTask(req: TaskOrchestrateReq): Promise<TaskOrchestrateResult>
  listTaskArtifacts(req: TaskArtifactListReq): Promise<TaskArtifactListResult>
  readTaskArtifact(req: TaskArtifactReadReq): Promise<TaskArtifactReadResult>
  listTaskStageRuns(req: TaskStageRunListReq): Promise<TaskStageRunListResult>
  getTaskStageRunTrace(req: TaskStageRunTraceGetReq): Promise<TaskStageRunTraceGetResult>
  onRequirementStatusChanged(
    listener: (event: RequirementStatusChangedEvent) => void
  ): () => void
  onTaskStatusChanged(
    listener: (event: TaskStatusChangedEvent) => void
  ): () => void
  onTaskStageTraceChanged(
    listener: (event: TaskStageTraceChangedEvent) => void
  ): () => void
}

const api: RendererApi = {
  sendPrompt(req) {
    return ipcRenderer.invoke(IPC_CHANNELS.AGENT_ASK, req)
  },
  createProject(req) {
    return ipcRenderer.invoke(IPC_CHANNELS.PROJECT_CREATE, req)
  },
  listProjects() {
    return ipcRenderer.invoke(IPC_CHANNELS.PROJECT_LIST)
  },
  revealProjectInFinder(req) {
    return ipcRenderer.invoke(IPC_CHANNELS.PROJECT_REVEAL_IN_FINDER, req)
  },
  selectDirectory() {
    return ipcRenderer.invoke(IPC_CHANNELS.DIALOG_SELECT_DIRECTORY)
  },
  createRequirement(req) {
    return ipcRenderer.invoke(IPC_CHANNELS.REQUIREMENT_CREATE, req)
  },
  listRequirementsByProject(req) {
    return ipcRenderer.invoke(IPC_CHANNELS.REQUIREMENT_LIST_BY_PROJECT, req)
  },
  updateRequirement(req) {
    return ipcRenderer.invoke(IPC_CHANNELS.REQUIREMENT_UPDATE, req)
  },
  applyRequirementAction(req) {
    return ipcRenderer.invoke(IPC_CHANNELS.REQUIREMENT_APPLY_ACTION, req)
  },
  processRequirement(req) {
    return ipcRenderer.invoke(IPC_CHANNELS.REQUIREMENT_PROCESS, req)
  },
  getRequirementConversation(req) {
    return ipcRenderer.invoke(IPC_CHANNELS.REQUIREMENT_GET_CONVERSATION, req)
  },
  replyRequirementConversation(req) {
    return ipcRenderer.invoke(IPC_CHANNELS.REQUIREMENT_REPLY_CONVERSATION, req)
  },
  startRequirementAutoProcessor(req = {}) {
    return ipcRenderer.invoke(IPC_CHANNELS.REQUIREMENT_AUTO_PROCESSOR_START, req)
  },
  stopRequirementAutoProcessor() {
    return ipcRenderer.invoke(IPC_CHANNELS.REQUIREMENT_AUTO_PROCESSOR_STOP)
  },
  getRequirementAutoProcessorStatus() {
    return ipcRenderer.invoke(IPC_CHANNELS.REQUIREMENT_AUTO_PROCESSOR_STATUS)
  },
  listRequirementStageRuns(req) {
    return ipcRenderer.invoke(IPC_CHANNELS.REQUIREMENT_STAGE_RUN_LIST, req)
  },
  startTaskAutoProcessor(req = {}) {
    return ipcRenderer.invoke(IPC_CHANNELS.TASK_AUTO_PROCESSOR_START, req)
  },
  stopTaskAutoProcessor() {
    return ipcRenderer.invoke(IPC_CHANNELS.TASK_AUTO_PROCESSOR_STOP)
  },
  getTaskAutoProcessorStatus() {
    return ipcRenderer.invoke(IPC_CHANNELS.TASK_AUTO_PROCESSOR_STATUS)
  },
  createTask(req) {
    return ipcRenderer.invoke(IPC_CHANNELS.TASK_CREATE, req)
  },
  listTasksByRequirement(req) {
    return ipcRenderer.invoke(IPC_CHANNELS.TASK_LIST_BY_REQUIREMENT, req)
  },
  listTasksByProject(req) {
    return ipcRenderer.invoke(IPC_CHANNELS.TASK_LIST_BY_PROJECT, req)
  },
  updateTask(req) {
    return ipcRenderer.invoke(IPC_CHANNELS.TASK_UPDATE, req)
  },
  applyTaskAction(req) {
    return ipcRenderer.invoke(IPC_CHANNELS.TASK_APPLY_ACTION, req)
  },
  applyTaskHumanCommand(req) {
    return ipcRenderer.invoke(IPC_CHANNELS.TASK_HUMAN_COMMAND, req)
  },
  getTaskHumanConversation(req) {
    return ipcRenderer.invoke(IPC_CHANNELS.TASK_HUMAN_CONVERSATION_GET, req)
  },
  replyTaskHumanConversation(req) {
    return ipcRenderer.invoke(IPC_CHANNELS.TASK_HUMAN_CONVERSATION_REPLY, req)
  },
  orchestrateTask(req) {
    return ipcRenderer.invoke(IPC_CHANNELS.TASK_ORCHESTRATE, req)
  },
  listTaskArtifacts(req) {
    return ipcRenderer.invoke(IPC_CHANNELS.TASK_ARTIFACT_LIST, req)
  },
  readTaskArtifact(req) {
    return ipcRenderer.invoke(IPC_CHANNELS.TASK_ARTIFACT_READ, req)
  },
  listTaskStageRuns(req) {
    return ipcRenderer.invoke(IPC_CHANNELS.TASK_STAGE_RUN_LIST, req)
  },
  getTaskStageRunTrace(req) {
    return ipcRenderer.invoke(IPC_CHANNELS.TASK_STAGE_RUN_TRACE_GET, req)
  },
  onRequirementStatusChanged(listener) {
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      payload: RequirementStatusChangedEvent
    ) => {
      listener(payload)
    }
    ipcRenderer.on(IPC_CHANNELS.REQUIREMENT_STATUS_CHANGED, wrapped)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.REQUIREMENT_STATUS_CHANGED, wrapped)
    }
  },
  onTaskStatusChanged(listener) {
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      payload: TaskStatusChangedEvent
    ) => {
      listener(payload)
    }
    ipcRenderer.on(IPC_CHANNELS.TASK_STATUS_CHANGED, wrapped)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TASK_STATUS_CHANGED, wrapped)
    }
  },
  onTaskStageTraceChanged(listener) {
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      payload: TaskStageTraceChangedEvent
    ) => {
      listener(payload)
    }
    ipcRenderer.on(IPC_CHANNELS.TASK_STAGE_TRACE_CHANGED, wrapped)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TASK_STAGE_TRACE_CHANGED, wrapped)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
console.info('[preload] window.api exposed')

declare global {
  interface Window {
    api: RendererApi
  }
}
