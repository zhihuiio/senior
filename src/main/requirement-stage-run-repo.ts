import type { RequirementStageRun, RequirementStatus, StageRun } from '../shared/types'
import {
  finishStageRun,
  failRunningStageRuns,
  getStageRunById,
  hasOpenStageRun,
  hasWaitingHumanStageRun,
  listStageRunsByEntity,
  startStageRun,
  updateStageRunAgentSessionId,
  updateStageRunAgentTrace
} from './stage-run-repo'

function toRequirementStageRun(row: StageRun): RequirementStageRun {
  return {
    id: row.id,
    requirementId: row.entityId,
    stageKey: row.stageKey as Extract<RequirementStatus, 'evaluating' | 'prd_designing' | 'prd_reviewing'>,
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

export function getRequirementStageRunById(id: number): RequirementStageRun | null {
  const row = getStageRunById(id)
  if (!row || row.entityType !== 'requirement') {
    return null
  }
  return toRequirementStageRun(row)
}

export function listRequirementStageRuns(requirementId: number): RequirementStageRun[] {
  return listStageRunsByEntity('requirement', requirementId).map(toRequirementStageRun)
}

export function startRequirementStageRun(input: {
  requirementId: number
  stageKey: Extract<RequirementStatus, 'evaluating' | 'prd_designing' | 'prd_reviewing'>
}): RequirementStageRun {
  const row = startStageRun({
    entityType: 'requirement',
    entityId: input.requirementId,
    stageKey: input.stageKey
  })
  return toRequirementStageRun(row)
}

export function finishRequirementStageRun(input: {
  requirementId: number
  stageKey: Extract<RequirementStatus, 'evaluating' | 'prd_designing' | 'prd_reviewing'>
  resultStatus: Exclude<StageRun['resultStatus'], 'pending' | 'running'>
  failureReason?: string | null
  artifactFileName?: string | null
}): RequirementStageRun | null {
  const row = finishStageRun({
    entityType: 'requirement',
    entityId: input.requirementId,
    stageKey: input.stageKey,
    resultStatus: input.resultStatus,
    failureReason: input.failureReason,
    artifactFileName: input.artifactFileName
  })
  if (!row) {
    return null
  }
  return toRequirementStageRun(row)
}

export function hasOpenRequirementStageRun(input: {
  requirementId: number
  stageKey: Extract<RequirementStatus, 'evaluating' | 'prd_designing' | 'prd_reviewing'>
}): boolean {
  return hasOpenStageRun({
    entityType: 'requirement',
    entityId: input.requirementId,
    stageKey: input.stageKey
  })
}

export function hasWaitingHumanRequirementStageRun(input: {
  requirementId: number
  stageKey?: Extract<RequirementStatus, 'evaluating' | 'prd_designing' | 'prd_reviewing'>
}): boolean {
  return hasWaitingHumanStageRun({
    entityType: 'requirement',
    entityId: input.requirementId,
    stageKey: input.stageKey
  })
}

export function updateRequirementStageRunAgentTrace(input: {
  stageRunId: number
  agentProcess: string
  agentSessionId?: string | null
}): RequirementStageRun | null {
  const row = updateStageRunAgentTrace(input)
  if (!row || row.entityType !== 'requirement') {
    return null
  }
  return toRequirementStageRun(row)
}

export function updateRequirementStageRunAgentSessionId(input: {
  stageRunId: number
  agentSessionId: string
}): RequirementStageRun | null {
  const row = updateStageRunAgentSessionId(input)
  if (!row || row.entityType !== 'requirement') {
    return null
  }
  return toRequirementStageRun(row)
}

export function failAllRunningRequirementStageRuns(failureReason: string): number {
  return failRunningStageRuns('requirement', failureReason)
}
