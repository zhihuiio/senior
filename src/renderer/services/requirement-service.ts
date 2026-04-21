import type { Requirement, RequirementConversationMessage, RequirementStageRun, RequirementStatus, RequirementTransitionAction, TaskAgentTraceMessage } from '../../shared/types'
import type { RequirementArtifactFile } from '../../shared/ipc'
import { pickText } from '../i18n'

export interface AutoProcessorStatusData {
  running: boolean
  startedAt: number | null
}

export interface CreateRequirementRequest {
  projectId: number
  title: string
  content?: string
  source?: string
}

export interface UpdateRequirementRequest {
  id: number
  title: string
  content?: string
  status: RequirementStatus
  source: string
}

export async function createRequirement(req: CreateRequirementRequest): Promise<Requirement> {
  const api = getRendererApi()
  const res = await api.createRequirement(req)

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return res.data.requirement
}

export async function listRequirementsByProject(projectId: number): Promise<Requirement[]> {
  const api = getRendererApi()
  const res = await api.listRequirementsByProject({ projectId })

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return res.data.requirements
}

export interface ApplyRequirementActionRequest {
  id: number
  action: RequirementTransitionAction
}

export interface ProcessRequirementRequest {
  requirementId: number
  type: string
  source: string
}

export interface ListRequirementStageRunsRequest {
  requirementId: number
}

export interface GetRequirementStageRunTraceRequest {
  stageRunId: number
}

export interface ListRequirementArtifactsRequest {
  requirementId: number
}

export interface ReadRequirementArtifactRequest {
  requirementId: number
  fileName: string
}


export interface RequirementConversationData {
  requirement: Requirement
  messages: RequirementConversationMessage[]
}

function getRendererApi() {
  if (!window.api) {
    throw new Error(pickText('客户端接口不可用，请重启应用', 'Renderer API is unavailable. Please restart the app.'))
  }

  return window.api
}

export async function updateRequirementDetail(req: UpdateRequirementRequest): Promise<Requirement> {
  const api = getRendererApi()
  const res = await api.updateRequirement(req)

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return res.data.requirement
}

export async function applyRequirementAction(req: ApplyRequirementActionRequest): Promise<Requirement> {
  const api = getRendererApi()
  const res = await api.applyRequirementAction(req)

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return res.data.requirement
}

export async function processRequirement(req: ProcessRequirementRequest): Promise<{ requirement: Requirement; resultType: 'accept' | 'clarify' | 'skip' }> {
  const api = getRendererApi()
  const res = await api.processRequirement(req)

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return {
    requirement: res.data.requirement,
    resultType: res.data.resultType === 'pass' ? 'accept' : res.data.resultType === 'pending' ? 'clarify' : 'skip'
  }
}

export interface GetRequirementConversationOptions {
  sessionId?: string
}

export async function getRequirementConversation(
  requirementId: number,
  options?: GetRequirementConversationOptions
): Promise<RequirementConversationData> {
  const sessionId = options?.sessionId?.trim()
  const api = getRendererApi()
  const res = await api.getRequirementConversation({
    requirementId,
    ...(sessionId ? { sessionId } : {})
  })

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return res.data
}

export async function replyRequirementConversation(requirementId: number, message: string): Promise<RequirementConversationData> {
  const api = getRendererApi()
  const res = await api.replyRequirementConversation({ requirementId, message })

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return res.data
}

export async function startRequirementAutoProcessor(): Promise<AutoProcessorStatusData> {
  const api = getRendererApi()
  if (typeof api.startRequirementAutoProcessor !== 'function') {
    throw new Error(
      pickText(
        '当前客户端版本不支持需求自动处理启动，请重启应用后重试',
        'This app version does not support starting requirement auto processor. Please restart and try again.'
      )
    )
  }

  const res = await api.startRequirementAutoProcessor()

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return res.data
}

export async function stopRequirementAutoProcessor(): Promise<AutoProcessorStatusData> {
  const api = getRendererApi()
  if (typeof api.stopRequirementAutoProcessor !== 'function') {
    throw new Error(
      pickText(
        '当前客户端版本不支持需求自动处理停止，请重启应用后重试',
        'This app version does not support stopping requirement auto processor. Please restart and try again.'
      )
    )
  }

  const res = await api.stopRequirementAutoProcessor()

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return res.data
}

export async function getRequirementAutoProcessorStatus(): Promise<AutoProcessorStatusData> {
  const api = getRendererApi()
  if (typeof api.getRequirementAutoProcessorStatus !== 'function') {
    throw new Error(
      pickText(
        '当前客户端版本不支持需求自动处理状态读取，请重启应用后重试',
        'This app version does not support requirement auto processor status read. Please restart and try again.'
      )
    )
  }

  const res = await api.getRequirementAutoProcessorStatus()

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return res.data
}

export async function listRequirementStageRuns(req: ListRequirementStageRunsRequest): Promise<RequirementStageRun[]> {
  const api = getRendererApi()
  const res = await api.listRequirementStageRuns(req)

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return res.data.stageRuns
}

export async function getRequirementStageRunTrace(
  req: GetRequirementStageRunTraceRequest
): Promise<{ stageRun: RequirementStageRun; messages: TaskAgentTraceMessage[] }> {
  const api = getRendererApi()
  const res = await api.getRequirementStageRunTrace(req)

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return {
    stageRun: res.data.stageRun,
    messages: res.data.messages
  }
}

export async function listRequirementArtifacts(req: ListRequirementArtifactsRequest): Promise<RequirementArtifactFile[]> {
  const api = getRendererApi()
  const res = await api.listRequirementArtifacts(req)

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return res.data.files
}

export async function readRequirementArtifact(req: ReadRequirementArtifactRequest): Promise<string> {
  const api = getRendererApi()
  const res = await api.readRequirementArtifact(req)

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return res.data.content
}

export const REQUIREMENT_STATUS_LABEL: Record<RequirementStatus, string> = {
  pending: pickText('待处理', 'Pending'),
  evaluating: pickText('需求评估', 'Requirement Evaluation'),
  prd_designing: pickText('PRD设计', 'PRD Design'),
  prd_reviewing: pickText('PRD评审', 'PRD Review'),
  queued: pickText('已入队', 'Queued'),
  canceled: pickText('已取消', 'Canceled')
}
