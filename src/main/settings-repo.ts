import { getDb } from './db'
import type { AgentSdkType, AppSettings } from '../shared/types'

const APP_SETTINGS_KEYS = {
  AGENT_SDK_TYPE: 'agent_sdk_type'
} as const

function normalizeAgentSdkType(value: string | null | undefined): AgentSdkType {
  return value === 'codex' ? 'codex' : 'claude'
}

export function getAppSettings(): AppSettings {
  const db = getDb()
  const row = db
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get(APP_SETTINGS_KEYS.AGENT_SDK_TYPE) as { value: string } | undefined

  return {
    agentSdkType: normalizeAgentSdkType(row?.value)
  }
}

export function updateAppSettings(input: { agentSdkType?: AgentSdkType }): AppSettings {
  const db = getDb()
  const current = getAppSettings()
  const next: AppSettings = {
    agentSdkType: input.agentSdkType ?? current.agentSdkType
  }

  const now = Date.now()
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(APP_SETTINGS_KEYS.AGENT_SDK_TYPE, next.agentSdkType, now)

  return next
}
