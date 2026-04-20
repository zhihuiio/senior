import type { AgentSdkType } from '../../shared/types'
import { getAgentSdkStrategy } from './agent-sdk-registry'

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

export function detectAgentSdkTypeFromConversations(conversations: unknown[]): AgentSdkType | null {
  for (const item of conversations) {
    if (!item || typeof item !== 'object') {
      continue
    }

    const record = item as Record<string, unknown>
    const sourceSdk = typeof record.sourceSdk === 'string' ? record.sourceSdk.trim() : ''
    if (sourceSdk === 'claude' || sourceSdk === 'codex') {
      return sourceSdk
    }
  }

  return null
}

export async function getAgentSessionMessages(input: { sessionId: string; sdkType?: AgentSdkType }): Promise<unknown[]> {
  const strategy = getAgentSdkStrategy(input.sdkType)
  const list = await strategy.getSessionMessages(input.sessionId)
  return list as unknown[]
}

export async function runAgentQuery(input: RunAgentQueryInput): Promise<AgentRunnerResult> {
  const strategy = getAgentSdkStrategy()

  try {
    const result = await strategy.runQuery({
      prompt: input.prompt,
      systemPrompt: input.systemPrompt,
      resumeSessionId: input.resumeSessionId,
      cwd: input.cwd,
      errorMessage: input.errorMessage,
      noResultMessage: input.noResultMessage,
      onProgress: (progress) => {
        input.onProgress?.({
          conversations: progress.conversations as unknown[],
          sessionId: progress.sessionId,
          message: progress.message
        })
      }
    })

    return {
      resultText: result.resultText,
      conversations: result.conversations as unknown[],
      sessionId: result.sessionId
    }
  } catch (error) {
    if (error instanceof AgentRunnerError) {
      throw error
    }
    throw new AgentRunnerError(
      error instanceof Error ? error.message : input.errorMessage,
      [],
      input.resumeSessionId ?? null
    )
  }
}
