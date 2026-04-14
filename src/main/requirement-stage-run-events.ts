import { EventEmitter } from 'node:events'
import type { RequirementStatus } from '../shared/types'

export interface RequirementStageRunChangedEventPayload {
  requirementId: number
  stageRunId: number
  stageKey: Extract<RequirementStatus, 'evaluating' | 'prd_designing' | 'prd_reviewing'>
}

const emitter = new EventEmitter()
const EVENT_NAME = 'requirement-stage-run-changed'

export function emitRequirementStageRunChanged(payload: RequirementStageRunChangedEventPayload): void {
  emitter.emit(EVENT_NAME, payload)
}

export function onRequirementStageRunChanged(
  listener: (payload: RequirementStageRunChangedEventPayload) => void
): () => void {
  emitter.on(EVENT_NAME, listener)
  return () => {
    emitter.off(EVENT_NAME, listener)
  }
}
