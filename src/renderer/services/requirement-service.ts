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
  const res = await window.api.createRequirement(req)

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return res.data.requirement
}

export async function listRequirementsByProject(projectId: number): Promise<Requirement[]> {
  const res = await window.api.listRequirementsByProject({ projectId })

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

export async function updateRequirementDetail(req: UpdateRequirementRequest): Promise<Requirement> {
  const res = await window.api.updateRequirement(req)

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return res.data.requirement
}

export async function applyRequirementAction(req: ApplyRequirementActionRequest): Promise<Requirement> {
  const res = await window.api.applyRequirementAction(req)

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return res.data.requirement
}

export async function processRequirement(req: ProcessRequirementRequest): Promise<{ requirement: Requirement; resultType: 'accept' | 'clarify' | 'skip' }> {
  const res = await window.api.processRequirement(req)

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
  const res = await window.api.getRequirementConversation({
    requirementId,
    ...(sessionId ? { sessionId } : {})
  })

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return res.data
}

export async function replyRequirementConversation(requirementId: number, message: string): Promise<RequirementConversationData> {
  const res = await window.api.replyRequirementConversation({ requirementId, message })

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return res.data
}

export async function startRequirementAutoProcessor(): Promise<AutoProcessorStatusData> {
  const res = await window.api.startRequirementAutoProcessor()

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return res.data
}

export async function stopRequirementAutoProcessor(): Promise<AutoProcessorStatusData> {
  const res = await window.api.stopRequirementAutoProcessor()

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return res.data
}

export async function getRequirementAutoProcessorStatus(): Promise<AutoProcessorStatusData> {
  const res = await window.api.getRequirementAutoProcessorStatus()

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return res.data
}

export async function listRequirementStageRuns(req: ListRequirementStageRunsRequest): Promise<RequirementStageRun[]> {
  const res = await window.api.listRequirementStageRuns(req)

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return res.data.stageRuns
}

export async function getRequirementStageRunTrace(
  req: GetRequirementStageRunTraceRequest
): Promise<{ stageRun: RequirementStageRun; messages: TaskAgentTraceMessage[] }> {
  const res = await window.api.getRequirementStageRunTrace(req)

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return {
    stageRun: res.data.stageRun,
    messages: res.data.messages
  }
}

export async function listRequirementArtifacts(req: ListRequirementArtifactsRequest): Promise<RequirementArtifactFile[]> {
  const res = await window.api.listRequirementArtifacts(req)

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return res.data.files
}

export async function readRequirementArtifact(req: ReadRequirementArtifactRequest): Promise<string> {
  const res = await window.api.readRequirementArtifact(req)

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
