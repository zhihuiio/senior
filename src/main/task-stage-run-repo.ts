import type { TaskStageRun, TaskStatus } from '../shared/types'
import {
  finishStageRun,
  getStageRunById,
  hasOpenStageRun,
  hasWaitingHumanStageRun,
  listStageRunsByEntity,
  startStageRun,
  updateStageRunAgentSessionId,
  updateStageRunAgentTrace,
  failRunningStageRuns
} from './stage-run-repo'

export function getTaskStageRunById(id: number): TaskStageRun | null {
  const row = getStageRunById(id)
  if (!row || row.entityType !== 'task') {
    return null
  }

  return {
    id: row.id,
    taskId: row.entityId,
    stageKey: row.stageKey as TaskStatus,
    round: row.round,
    startAt: row.startAt,
    endAt: row.endAt,
    resultStatus: row.resultStatus,
    failureReason: row.failureReason,
    artifactFileNames: row.artifactFileNames,
    agentProcess: row.agentProcess,
    agentSessionId: row.agentSessionId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

export function listTaskStageRuns(taskId: number): TaskStageRun[] {
  const rows = listStageRunsByEntity('task', taskId)
  return rows.map((row) => ({
    id: row.id,
    taskId: row.entityId,
    stageKey: row.stageKey as TaskStatus,
    round: row.round,
    startAt: row.startAt,
    endAt: row.endAt,
    resultStatus: row.resultStatus,
    failureReason: row.failureReason,
    artifactFileNames: row.artifactFileNames,
    agentProcess: row.agentProcess,
    agentSessionId: row.agentSessionId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }))
}

export function startTaskStageRun(input: { taskId: number; stageKey: TaskStatus }): TaskStageRun {
  const row = startStageRun({
    entityType: 'task',
    entityId: input.taskId,
    stageKey: input.stageKey
  })
  return {
    id: row.id,
    taskId: row.entityId,
    stageKey: row.stageKey as TaskStatus,
    round: row.round,
    startAt: row.startAt,
    endAt: row.endAt,
    resultStatus: row.resultStatus,
    failureReason: row.failureReason,
    artifactFileNames: row.artifactFileNames,
    agentProcess: row.agentProcess,
    agentSessionId: row.agentSessionId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

export function finishTaskStageRun(input: {
  taskId: number
  stageKey: TaskStatus
  resultStatus: 'succeeded' | 'failed' | 'waiting_human'
  failureReason?: string | null
  artifactFileName?: string | null
}): TaskStageRun | null {
  const row = finishStageRun({
    entityType: 'task',
    entityId: input.taskId,
    stageKey: input.stageKey,
    resultStatus: input.resultStatus,
    failureReason: input.failureReason,
    artifactFileName: input.artifactFileName
  })
  if (!row) {
    return null
  }
  return {
    id: row.id,
    taskId: row.entityId,
    stageKey: row.stageKey as TaskStatus,
    round: row.round,
    startAt: row.startAt,
    endAt: row.endAt,
    resultStatus: row.resultStatus,
    failureReason: row.failureReason,
    artifactFileNames: row.artifactFileNames,
    agentProcess: row.agentProcess,
    agentSessionId: row.agentSessionId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

export function hasOpenTaskStageRun(input: { taskId: number; stageKey: TaskStatus }): boolean {
  return hasOpenStageRun({
    entityType: 'task',
    entityId: input.taskId,
    stageKey: input.stageKey
  })
}

export function hasWaitingHumanTaskStageRun(input: { taskId: number; stageKey?: TaskStatus }): boolean {
  return hasWaitingHumanStageRun({
    entityType: 'task',
    entityId: input.taskId,
    stageKey: input.stageKey
  })
}

export function updateTaskStageRunAgentTrace(input: {
  stageRunId: number
  agentProcess: string
  agentSessionId?: string | null
}): TaskStageRun | null {
  const row = updateStageRunAgentTrace(input)
  if (!row || row.entityType !== 'task') {
    return null
  }
  return {
    id: row.id,
    taskId: row.entityId,
    stageKey: row.stageKey as TaskStatus,
    round: row.round,
    startAt: row.startAt,
    endAt: row.endAt,
    resultStatus: row.resultStatus,
    failureReason: row.failureReason,
    artifactFileNames: row.artifactFileNames,
    agentProcess: row.agentProcess,
    agentSessionId: row.agentSessionId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

export function updateTaskStageRunAgentSessionId(input: { stageRunId: number; agentSessionId: string }): TaskStageRun | null {
  const row = updateStageRunAgentSessionId(input)
  if (!row || row.entityType !== 'task') {
    return null
  }
  return {
    id: row.id,
    taskId: row.entityId,
    stageKey: row.stageKey as TaskStatus,
    round: row.round,
    startAt: row.startAt,
    endAt: row.endAt,
    resultStatus: row.resultStatus,
    failureReason: row.failureReason,
    artifactFileNames: row.artifactFileNames,
    agentProcess: row.agentProcess,
    agentSessionId: row.agentSessionId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

export function failAllRunningTaskStageRuns(failureReason: string): number {
  return failRunningStageRuns('task', failureReason)
}
