import type { AgentSdkType } from '../../shared/types'

export interface AgentMessageEvent {
  sourceSdk: AgentSdkType
  payload: unknown
}

export interface AgentSdkRunProgress {
  conversations: AgentMessageEvent[]
  sessionId: string | null
  message: AgentMessageEvent
}

export interface AgentSdkRunResult {
  resultText: string
  conversations: AgentMessageEvent[]
  sessionId: string | null
}

export interface AgentSdkRunInput {
  prompt: string
  systemPrompt?: string
  resumeSessionId?: string
  cwd?: string
  onProgress?: (progress: AgentSdkRunProgress) => void
  errorMessage: string
  noResultMessage: string
}

export interface AgentSdkStrategy {
  sdkType: AgentSdkType
  runQuery(input: AgentSdkRunInput): Promise<AgentSdkRunResult>
  getSessionMessages(sessionId: string): Promise<AgentMessageEvent[]>
}
