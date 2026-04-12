import { query } from '@anthropic-ai/claude-agent-sdk'

export interface AgentRunnerProgress {
  conversations: unknown[]
  sessionId: string | null
  message: unknown
}

export interface AgentRunnerResult {
  resultText: string
  conversations: unknown[]
  sessionId: string | null
}

interface RunAgentQueryInput {
  prompt: string
  systemPrompt?: string
  resumeSessionId?: string
  cwd?: string
  onProgress?: (progress: AgentRunnerProgress) => void
  errorMessage: string
  noResultMessage: string
}

export class AgentRunnerError extends Error {
  constructor(
    message: string,
    public readonly conversations: unknown[],
    public readonly sessionId: string | null
  ) {
    super(message)
  }
}

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

export async function runAgentQuery(input: RunAgentQueryInput): Promise<AgentRunnerResult> {
  const stream = query({
    prompt: input.prompt,
    options: {
      cwd: input.cwd ?? process.cwd(),
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
      ...(input.resumeSessionId ? { resume: input.resumeSessionId } : {})
    }
  })

  const conversations: unknown[] = []
  let sessionId: string | null = input.resumeSessionId ?? null

  try {
    for await (const message of stream) {
      conversations.push(message)

      const latestSessionId = readSessionId(message)
      if (latestSessionId) {
        sessionId = latestSessionId
      }

      input.onProgress?.({
        conversations,
        sessionId,
        message
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
      throw new AgentRunnerError(errors.join('\n') || input.errorMessage, conversations, sessionId)
    }

    throw new AgentRunnerError(input.noResultMessage, conversations, sessionId)
  } catch (error) {
    if (error instanceof AgentRunnerError) {
      throw error
    }

    throw new AgentRunnerError(error instanceof Error ? error.message : input.errorMessage, conversations, sessionId)
  } finally {
    stream.close()
  }
}
