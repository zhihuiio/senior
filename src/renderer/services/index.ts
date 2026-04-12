import type { AskService } from './ask-service'
import { IpcAskService } from './ipc-ask-service'
import { MockAskService } from './mock-ask-service'

export type ApiMode = 'mock' | 'real'

export function getApiMode(): ApiMode {
  const raw = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_API_MODE
  return raw === 'real' ? 'real' : 'mock'
}

export function createAskService(mode: ApiMode = getApiMode()): AskService {
  if (mode === 'real') {
    return new IpcAskService()
  }

  return new MockAskService()
}
