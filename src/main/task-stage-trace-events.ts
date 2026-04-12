import { EventEmitter } from 'node:events'
import type { TaskStatus } from '../shared/types'

export interface TaskStageTraceChangedEventPayload {
  taskId: number
  stageRunId: number
  stageKey: TaskStatus
}

const emitter = new EventEmitter()
const EVENT_NAME = 'task-stage-trace-changed'

export function emitTaskStageTraceChanged(payload: TaskStageTraceChangedEventPayload): void {
  emitter.emit(EVENT_NAME, payload)
}

export function onTaskStageTraceChanged(
  listener: (payload: TaskStageTraceChangedEventPayload) => void
): () => void {
  emitter.on(EVENT_NAME, listener)
  return () => {
    emitter.off(EVENT_NAME, listener)
  }
}

