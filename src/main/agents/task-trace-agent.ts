import type { Task, TaskAgentTraceMessage } from '../../shared/types'
import type { AgentSdkType } from '../../shared/types'
import { getTaskStageRunById } from '../task-stage-run-repo'
import { parseAgentConversations, parseTaskTraceMessages, parseTaskTraceMessagesFromSessionList } from '../agent-message-utils'
import { detectAgentSdkTypeFromConversations, getAgentSessionMessages } from './agent-runner'

export interface TaskStageRunTraceResult {
  stageRun: {
    id: number
    taskId: number
    stageKey: Task['status']
    round: number
  }
  messages: TaskAgentTraceMessage[]
}

async function toTaskTraceMessagesFromSession(sessionId: string, sdkType?: AgentSdkType): Promise<TaskAgentTraceMessage[]> {
  const list = await getAgentSessionMessages({ sessionId, sdkType: sdkType ?? undefined })
  return parseTaskTraceMessagesFromSessionList(list)
}

function toTaskTraceMessagesFromSnapshot(agentProcess: string): TaskAgentTraceMessage[] {
  return parseTaskTraceMessages(parseAgentConversations(agentProcess))
}

export async function getTaskStageRunTrace(stageRunId: number): Promise<TaskStageRunTraceResult> {
  if (!Number.isInteger(stageRunId) || stageRunId <= 0) {
    throw new Error('stageRunId 非法')
  }

  const stageRun = getTaskStageRunById(stageRunId)
  if (!stageRun) {
    throw new Error('任务阶段记录不存在')
  }

  const snapshotMessages = toTaskTraceMessagesFromSnapshot(stageRun.agentProcess)
  const sessionSdkType = detectAgentSdkTypeFromConversations(parseAgentConversations(stageRun.agentProcess)) ?? undefined
  const sessionId = stageRun.agentSessionId?.trim()
  let messages = snapshotMessages

  if (sessionId) {
    try {
      const sessionMessages = await toTaskTraceMessagesFromSession(sessionId, sessionSdkType)
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
      taskId: stageRun.taskId,
      stageKey: stageRun.stageKey,
      round: stageRun.round
    },
    messages
  }
}
