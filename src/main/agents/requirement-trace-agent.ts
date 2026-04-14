import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk'
import type { RequirementStatus, TaskAgentTraceMessage } from '../../shared/types'
import { getRequirementStageRunById } from '../requirement-stage-run-repo'
import { parseAgentConversations, parseTaskTraceMessages, parseTaskTraceMessagesFromSessionList } from '../agent-message-utils'

export interface RequirementStageRunTraceResult {
  stageRun: {
    id: number
    requirementId: number
    stageKey: Extract<RequirementStatus, 'evaluating' | 'prd_designing' | 'prd_reviewing'>
    round: number
  }
  messages: TaskAgentTraceMessage[]
}

async function toRequirementTraceMessagesFromSession(sessionId: string): Promise<TaskAgentTraceMessage[]> {
  const list = await getSessionMessages(sessionId)
  return parseTaskTraceMessagesFromSessionList(list)
}

function toRequirementTraceMessagesFromSnapshot(agentProcess: string): TaskAgentTraceMessage[] {
  return parseTaskTraceMessages(parseAgentConversations(agentProcess))
}

export async function getRequirementStageRunTrace(stageRunId: number): Promise<RequirementStageRunTraceResult> {
  if (!Number.isInteger(stageRunId) || stageRunId <= 0) {
    throw new Error('stageRunId 非法')
  }

  const stageRun = getRequirementStageRunById(stageRunId)
  if (!stageRun) {
    throw new Error('需求阶段记录不存在')
  }

  const snapshotMessages = toRequirementTraceMessagesFromSnapshot(stageRun.agentProcess)
  const sessionId = stageRun.agentSessionId?.trim()
  let messages = snapshotMessages

  if (sessionId) {
    try {
      const sessionMessages = await toRequirementTraceMessagesFromSession(sessionId)
      if (sessionMessages.length > 0) {
        messages = sessionMessages
      }
    } catch {
      // fallback to persisted snapshot
    }
  }

  if (messages.length === 0) {
    throw new Error('当前阶段暂无可展示的会话消息')
  }

  return {
    stageRun: {
      id: stageRun.id,
      requirementId: stageRun.requirementId,
      stageKey: stageRun.stageKey,
      round: stageRun.round
    },
    messages
  }
}
