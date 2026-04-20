import type { AgentSdkType } from '../../shared/types'
import { getAppSettings } from '../settings-repo'
import type { AgentSdkStrategy } from './agent-sdk-types'
import { ClaudeAgentSdkStrategy } from './claude-agent-sdk-strategy'
import { CodexAgentSdkStrategy } from './codex-agent-sdk-strategy'

const claudeStrategy = new ClaudeAgentSdkStrategy()
const codexStrategy = new CodexAgentSdkStrategy()

function normalizeAgentSdkType(value: string | null | undefined): AgentSdkType {
  return value === 'codex' ? 'codex' : 'claude'
}

export function getCurrentAgentSdkType(): AgentSdkType {
  const settings = getAppSettings()
  return normalizeAgentSdkType(settings.agentSdkType)
}

export function getAgentSdkStrategy(type?: AgentSdkType): AgentSdkStrategy {
  const resolvedType = type ?? getCurrentAgentSdkType()
  return resolvedType === 'codex' ? codexStrategy : claudeStrategy
}
