import type { Task, TaskStatus, TaskTransitionAction, TaskHumanCommand, TaskWaitingContext } from '../../shared/types'
import type { TaskArtifactFile } from '../../shared/ipc'
import type { TaskAgentTraceMessage, TaskStageRun } from '../../shared/types'
import { pickText } from '../i18n'

export interface AutoProcessorStatusData {
  running: boolean
  startedAt: number | null
}

export interface CreateTaskRequest {
  projectId: number
  requirementId?: number | null
  title: string
  content?: string
}

export interface UpdateTaskRequest {
  id: number
  title: string
  content?: string
  status: TaskStatus
}

export interface ApplyTaskActionRequest {
  id: number
  action: TaskTransitionAction
}

export interface ApplyTaskHumanCommandRequest {
  id: number
  command: TaskHumanCommand
  note?: string
}

export interface ReadTaskArtifactRequest {
  taskId: number
  fileName: string
}

export interface ListTaskStageRunsRequest {
  taskId: number
}

export interface GetTaskStageRunTraceRequest {
  stageRunId: number
}


export interface GetTaskHumanConversationRequest {
  taskId: number
}

export interface ReplyTaskHumanConversationRequest {
  taskId: number
  message: string
}

function getRendererApi() {
  if (!window.api) {
    throw new Error(pickText('客户端接口不可用，请重启应用', 'Renderer API is unavailable. Please restart the app.'))
  }

  return window.api
}

export async function createTask(req: CreateTaskRequest): Promise<Task> {
  const api = getRendererApi()
  const res = await api.createTask(req)

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return res.data.task
}

export async function listTasksByRequirement(requirementId: number): Promise<Task[]> {
  const api = getRendererApi()
  const res = await api.listTasksByRequirement({ requirementId })

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return res.data.tasks
}

export async function listTasksByProject(projectId: number): Promise<Task[]> {
  const api = getRendererApi()
  const res = await api.listTasksByProject({ projectId })

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return res.data.tasks
}

export async function updateTaskDetail(req: UpdateTaskRequest): Promise<Task> {
  const api = getRendererApi()
  const res = await api.updateTask(req)

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return res.data.task
}

export async function applyTaskAction(req: ApplyTaskActionRequest): Promise<Task> {
  const api = getRendererApi()
  const res = await api.applyTaskAction(req)

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return res.data.task
}

export async function applyTaskHumanCommand(req: ApplyTaskHumanCommandRequest): Promise<Task> {
  const api = getRendererApi()
  const res = await api.applyTaskHumanCommand(req)

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return res.data.task
}

export async function getTaskHumanConversation(
  req: GetTaskHumanConversationRequest
): Promise<{ task: Task; waitingContext: TaskWaitingContext; messages: TaskAgentTraceMessage[] }> {
  const api = getRendererApi()
  const res = await api.getTaskHumanConversation(req)

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return res.data
}

export async function replyTaskHumanConversation(
  req: ReplyTaskHumanConversationRequest
): Promise<{ task: Task; waitingContext: TaskWaitingContext; messages: TaskAgentTraceMessage[] }> {
  const api = getRendererApi()
  const res = await api.replyTaskHumanConversation(req)

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return res.data
}

export async function orchestrateTask(taskId: number): Promise<Task> {
  const api = getRendererApi()
  const res = await api.orchestrateTask({ taskId })

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return res.data.task
}

export async function listTaskArtifacts(taskId: number): Promise<TaskArtifactFile[]> {
  const api = getRendererApi()
  const res = await api.listTaskArtifacts({ taskId })

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return res.data.files
}

export async function readTaskArtifact(req: ReadTaskArtifactRequest): Promise<string> {
  const api = getRendererApi()
  const res = await api.readTaskArtifact(req)

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return res.data.content
}

export async function listTaskStageRuns(req: ListTaskStageRunsRequest): Promise<TaskStageRun[]> {
  const api = getRendererApi()
  const res = await api.listTaskStageRuns(req)

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return res.data.stageRuns
}

export async function getTaskStageRunTrace(req: GetTaskStageRunTraceRequest): Promise<{ stageRun: TaskStageRun; messages: TaskAgentTraceMessage[] }> {
  const api = getRendererApi()
  const res = await api.getTaskStageRunTrace(req)

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return {
    stageRun: res.data.stageRun,
    messages: res.data.messages
  }
}

export async function startTaskAutoProcessor(): Promise<AutoProcessorStatusData> {
  const api = getRendererApi()
  if (typeof api.startTaskAutoProcessor !== 'function') {
    throw new Error(
      pickText(
        '当前客户端版本不支持任务自动处理启动，请重启应用后重试',
        'This app version does not support starting task auto processor. Please restart and try again.'
      )
    )
  }

  const res = await api.startTaskAutoProcessor()

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return res.data
}

export async function stopTaskAutoProcessor(): Promise<AutoProcessorStatusData> {
  const api = getRendererApi()
  if (typeof api.stopTaskAutoProcessor !== 'function') {
    throw new Error(
      pickText(
        '当前客户端版本不支持任务自动处理停止，请重启应用后重试',
        'This app version does not support stopping task auto processor. Please restart and try again.'
      )
    )
  }

  const res = await api.stopTaskAutoProcessor()

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return res.data
}

export async function getTaskAutoProcessorStatus(): Promise<AutoProcessorStatusData> {
  const api = getRendererApi()
  if (typeof api.getTaskAutoProcessorStatus !== 'function') {
    throw new Error(
      pickText(
        '当前客户端版本不支持任务自动处理状态读取，请重启应用后重试',
        'This app version does not support task auto processor status read. Please restart and try again.'
      )
    )
  }

  const res = await api.getTaskAutoProcessorStatus()

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return res.data
}

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  idle: pickText('空闲', 'Idle'),
  arch_designing: pickText('架构设计', 'Architecture Design'),
  tech_reviewing: pickText('技术评审', 'Technical Review'),
  waiting_human: pickText('等待人工', 'Waiting for Human'),
  coding: pickText('编码中', 'Coding'),
  qa_reviewing: pickText('QA/CR评审', 'QA/CR Review'),
  deploying: pickText('部署中', 'Deploying'),
  done: pickText('已完成', 'Done')
}
