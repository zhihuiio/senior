import { getDb } from './db'
import type { StageRun, StageRunResultStatus } from '../shared/types'

type StageRunEntityType = StageRun['entityType']

interface DbStageRunRow {
  id: number
  entity_type: string
  entity_id: number
  stage_key: string
  round: number
  start_at: number
  end_at: number | null
  result_status: string | null
  failure_reason: string
  artifact_file_names: string
  agent_process: string
  agent_session_id: string | null
  created_at: number
  updated_at: number
}

function parseArtifactFileNames(raw: string): string[] {
  const text = raw.trim()
  if (!text) {
    return []
  }

  try {
    const parsed = JSON.parse(text) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  } catch {
    return []
  }
}

function normalizeResultStatus(row: DbStageRunRow): StageRunResultStatus {
  if (
    row.result_status === 'pending' ||
    row.result_status === 'running' ||
    row.result_status === 'succeeded' ||
    row.result_status === 'failed' ||
    row.result_status === 'waiting_human'
  ) {
    return row.result_status
  }

  if (row.end_at) {
    return 'succeeded'
  }

  return 'running'
}

function mapRow(row: DbStageRunRow): StageRun {
  return {
    id: row.id,
    entityType: row.entity_type === 'requirement' ? 'requirement' : 'task',
    entityId: row.entity_id,
    stageKey: row.stage_key,
    round: row.round,
    startAt: row.start_at,
    endAt: row.end_at,
    resultStatus: normalizeResultStatus(row),
    failureReason: row.failure_reason?.trim() ?? '',
    artifactFileNames: parseArtifactFileNames(row.artifact_file_names),
    agentProcess: row.agent_process ?? '',
    agentSessionId: row.agent_session_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function getStageRunRowById(id: number): DbStageRunRow | undefined {
  const db = getDb()
  return db
    .prepare(
      `SELECT id, entity_type, entity_id, stage_key, round, start_at, end_at, result_status, failure_reason, artifact_file_names, agent_process, agent_session_id, created_at, updated_at
       FROM stage_runs
       WHERE id = ?`
    )
    .get(id) as DbStageRunRow | undefined
}

export function getStageRunById(id: number): StageRun | null {
  const row = getStageRunRowById(id)
  return row ? mapRow(row) : null
}

export function listStageRunsByEntity(entityType: StageRunEntityType, entityId: number): StageRun[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT id, entity_type, entity_id, stage_key, round, start_at, end_at, result_status, failure_reason, artifact_file_names, agent_process, agent_session_id, created_at, updated_at
       FROM stage_runs
       WHERE entity_type = ? AND entity_id = ?
       ORDER BY start_at ASC, id ASC`
    )
    .all(entityType, entityId) as DbStageRunRow[]

  return rows.map(mapRow)
}

export function startStageRun(input: { entityType: StageRunEntityType; entityId: number; stageKey: string }): StageRun {
  const db = getDb()
  const now = Date.now()
  const nextRoundRow = db
    .prepare(
      `SELECT COALESCE(MAX(round), 0) + 1 AS next_round
       FROM stage_runs
       WHERE entity_type = ? AND entity_id = ? AND stage_key = ?`
    )
    .get(input.entityType, input.entityId, input.stageKey) as { next_round: number }

  const nextRound = Number.isInteger(nextRoundRow?.next_round) && nextRoundRow.next_round > 0 ? nextRoundRow.next_round : 1

  const result = db
    .prepare(
      `INSERT INTO stage_runs (entity_type, entity_id, stage_key, round, start_at, end_at, result_status, failure_reason, artifact_file_names, agent_process, agent_session_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, 'running', '', '[]', '', NULL, ?, ?)`
    )
    .run(input.entityType, input.entityId, input.stageKey, nextRound, now, now, now)

  const row = getStageRunRowById(Number(result.lastInsertRowid))
  if (!row) {
    throw new Error('创建阶段运行记录失败')
  }

  return mapRow(row)
}

export function finishStageRun(input: {
  entityType: StageRunEntityType
  entityId: number
  stageKey: string
  resultStatus: Exclude<StageRunResultStatus, 'pending' | 'running'>
  failureReason?: string | null
  artifactFileName?: string | null
}): StageRun | null {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT id, entity_type, entity_id, stage_key, round, start_at, end_at, result_status, failure_reason, artifact_file_names, agent_process, agent_session_id, created_at, updated_at
       FROM stage_runs
       WHERE entity_type = ? AND entity_id = ? AND stage_key = ? AND end_at IS NULL
       ORDER BY start_at DESC, id DESC
       LIMIT 1`
    )
    .get(input.entityType, input.entityId, input.stageKey) as DbStageRunRow | undefined

  if (!row) {
    return null
  }

  const now = Date.now()
  const artifactNames = parseArtifactFileNames(row.artifact_file_names)
  const artifactFileName = input.artifactFileName?.trim() ?? ''
  const failureReason =
    input.resultStatus === 'failed' || input.resultStatus === 'waiting_human'
      ? input.failureReason?.trim() ?? ''
      : ''
  const endAt = input.resultStatus === 'waiting_human' ? null : now
  if (artifactFileName && !artifactNames.includes(artifactFileName)) {
    artifactNames.push(artifactFileName)
  }

  db.prepare(
    `UPDATE stage_runs
     SET end_at = ?, result_status = ?, failure_reason = ?, artifact_file_names = ?, updated_at = ?
     WHERE id = ?`
  ).run(endAt, input.resultStatus, failureReason, JSON.stringify(artifactNames), now, row.id)

  const updated = getStageRunRowById(row.id)
  return updated ? mapRow(updated) : null
}

export function hasOpenStageRun(input: { entityType: StageRunEntityType; entityId: number; stageKey: string }): boolean {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT id
       FROM stage_runs
       WHERE entity_type = ? AND entity_id = ? AND stage_key = ? AND end_at IS NULL AND result_status IN ('running', 'waiting_human')
       ORDER BY start_at DESC, id DESC
       LIMIT 1`
    )
    .get(input.entityType, input.entityId, input.stageKey) as { id: number } | undefined

  return Boolean(row?.id)
}

export function hasWaitingHumanStageRun(input: { entityType: StageRunEntityType; entityId: number; stageKey?: string }): boolean {
  const db = getDb()
  if (input.stageKey) {
    const row = db
      .prepare(
        `SELECT id
         FROM stage_runs
         WHERE entity_type = ? AND entity_id = ? AND stage_key = ? AND end_at IS NULL AND result_status = 'waiting_human'
         ORDER BY start_at DESC, id DESC
         LIMIT 1`
      )
      .get(input.entityType, input.entityId, input.stageKey) as { id: number } | undefined

    return Boolean(row?.id)
  }

  const row = db
    .prepare(
      `SELECT id
       FROM stage_runs
       WHERE entity_type = ? AND entity_id = ? AND end_at IS NULL AND result_status = 'waiting_human'
       ORDER BY start_at DESC, id DESC
       LIMIT 1`
    )
    .get(input.entityType, input.entityId) as { id: number } | undefined

  return Boolean(row?.id)
}

export function updateStageRunAgentTrace(input: {
  stageRunId: number
  agentProcess: string
  agentSessionId?: string | null
}): StageRun | null {
  const db = getDb()
  const now = Date.now()
  db.prepare(
    `UPDATE stage_runs
     SET agent_process = ?, agent_session_id = ?, updated_at = ?
     WHERE id = ?`
  ).run(input.agentProcess, input.agentSessionId ?? null, now, input.stageRunId)

  const updated = getStageRunRowById(input.stageRunId)
  return updated ? mapRow(updated) : null
}

export function updateStageRunAgentSessionId(input: { stageRunId: number; agentSessionId: string }): StageRun | null {
  const agentSessionId = input.agentSessionId.trim()
  if (!agentSessionId) {
    return getStageRunById(input.stageRunId)
  }

  const db = getDb()
  const now = Date.now()
  db.prepare(
    `UPDATE stage_runs
     SET agent_session_id = ?, updated_at = ?
     WHERE id = ? AND (agent_session_id IS NULL OR agent_session_id = '')`
  ).run(agentSessionId, now, input.stageRunId)

  const updated = getStageRunRowById(input.stageRunId)
  return updated ? mapRow(updated) : null
}

export function failRunningStageRuns(entityType: StageRunEntityType, failureReason: string): number {
  const reason = failureReason.trim()
  const db = getDb()
  const now = Date.now()
  const result = db
    .prepare(
      `UPDATE stage_runs
       SET end_at = COALESCE(end_at, ?),
           result_status = 'failed',
           failure_reason = ?,
           updated_at = ?
       WHERE entity_type = ? AND result_status = 'running'`
    )
    .run(now, reason, now, entityType)

  return result.changes
}
