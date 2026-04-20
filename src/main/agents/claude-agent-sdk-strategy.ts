import { getSessionMessages, query } from '@anthropic-ai/claude-agent-sdk'
import type { AgentSdkRunInput, AgentSdkRunResult, AgentSdkStrategy, AgentMessageEvent } from './agent-sdk-types'

function readSessionId(message: unknown): string | null {
  if (!message || typeof message !== 'object') {
    return null
  }

  const record = message as Record<string, unknown>
  const snake = typeof record.session_id === 'string' ? record.session_id.trim() : ''
  if (snake) {
    return snake
  }

  const camel = typeof record.sessionId === 'string' ? record.sessionId.trim() : ''
  if (camel) {
    return camel
  }

  return null
}

function readResultErrors(message: Record<string, unknown>): string[] {
  if (!Array.isArray(message.errors)) {
    return []
  }

  return message.errors.filter((item): item is string => typeof item === 'string')
}

export class ClaudeAgentSdkStrategy implements AgentSdkStrategy {
  readonly sdkType = 'claude' as const

  async runQuery(input: AgentSdkRunInput): Promise<AgentSdkRunResult> {
    const stream = query({
      prompt: input.prompt,
      options: {
        cwd: input.cwd ?? process.cwd(),
        settingSources: ['user', 'project'],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
        ...(input.resumeSessionId ? { resume: input.resumeSessionId } : {})
      }
    })

    const conversations: AgentMessageEvent[] = []
    let sessionId: string | null = input.resumeSessionId ?? null

    try {
      for await (const message of stream) {
        const normalizedMessage: AgentMessageEvent = {
          sourceSdk: 'claude',
          payload: message
        }
        conversations.push(normalizedMessage)

        const latestSessionId = readSessionId(message)
        if (latestSessionId) {
          sessionId = latestSessionId
        }

        input.onProgress?.({
          conversations,
          sessionId,
          message: normalizedMessage
        })

        if (!message || typeof message !== 'object') {
          continue
        }

        const record = message as Record<string, unknown>
        if (record.type !== 'result') {
          continue
        }

        const subtype = typeof record.subtype === 'string' ? record.subtype : ''
        if (subtype === 'success') {
          return {
            resultText: typeof record.result === 'string' ? record.result : '',
            conversations,
            sessionId
          }
        }

        const errors = readResultErrors(record)
        throw new Error(errors.join('\n') || input.errorMessage)
      }

      throw new Error(input.noResultMessage)
    } finally {
      stream.close()
    }
  }

  async getSessionMessages(sessionId: string): Promise<AgentMessageEvent[]> {
    const normalizedSessionId = sessionId.trim()
    if (!normalizedSessionId) {
      throw new Error('no available session id')
    }

    const list = await getSessionMessages(normalizedSessionId)
    return list.map((item) => ({
      sourceSdk: 'claude',
      payload: item
    }))
  }
}
