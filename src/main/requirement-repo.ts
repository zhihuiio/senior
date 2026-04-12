import { getDb } from './db'
import type { Requirement, RequirementStandardizedData, RequirementStatus, RequirementWaitingContext } from '../shared/types'

interface DbRequirementRow {
  id: number
  project_id: number
  title: string
  content: string
  status: RequirementStatus
  source: string
  standardized_data: string | null
  prd_review_reject_count: number
  waiting_context: string
  human_revision_note: string
  agent_process: string
  agent_session_id: string | null
  created_at: number
  updated_at: number
}

function parseStandardizedData(raw: string | null): RequirementStandardizedData | null {
  if (!raw) {
    return null
  }

  try {
    const value = JSON.parse(raw) as RequirementStandardizedData
    return value
  } catch {
    return null
  }
}

function normalizeWaitingContext(value: string): RequirementWaitingContext | null {
  if (value === 'prd_review_gate') {
    return value
  }

  return null
}

function mapRow(row: DbRequirementRow): Requirement {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    content: row.content,
    status: row.status,
    source: row.source,
    standardizedData: parseStandardizedData(row.standardized_data),
    prdReviewRejectCount: row.prd_review_reject_count,
    waitingContext: normalizeWaitingContext(row.waiting_context),
    humanRevisionNote: row.human_revision_note,
    agentProcess: row.agent_process,
    agentSessionId: row.agent_session_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function getRequirementRowById(id: number): DbRequirementRow | undefined {
  const db = getDb()
  return db
    .prepare(
      'SELECT id, project_id, title, content, status, source, standardized_data, prd_review_reject_count, waiting_context, human_revision_note, agent_process, agent_session_id, created_at, updated_at FROM requirements WHERE id = ?'
    )
    .get(id) as DbRequirementRow | undefined
}

export function insertRequirement(input: {
  projectId: number
  title: string
  content: string
  status?: RequirementStatus
  source?: string
  standardizedData?: RequirementStandardizedData | null
  prdReviewRejectCount?: number
  waitingContext?: RequirementWaitingContext | null
  humanRevisionNote?: string
  agentProcess?: string
  agentSessionId?: string | null
}): Requirement {
  const now = Date.now()
  const db = getDb()
  const stmt = db.prepare(
    'INSERT INTO requirements (project_id, title, content, status, source, standardized_data, prd_review_reject_count, waiting_context, human_revision_note, agent_process, agent_session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )

  const status = input.status ?? 'pending'
  const source = input.source?.trim() ?? ''
  const standardizedData = input.standardizedData ? JSON.stringify(input.standardizedData) : null
  const prdReviewRejectCount = input.prdReviewRejectCount ?? 0
  const waitingContext = input.waitingContext ?? null
  const humanRevisionNote = input.humanRevisionNote?.trim() ?? ''
  const agentProcess = input.agentProcess ?? ''
  const agentSessionId = input.agentSessionId ?? null

  const result = stmt.run(
    input.projectId,
    input.title,
    input.content,
    status,
    source,
    standardizedData,
    prdReviewRejectCount,
    waitingContext ?? '',
    humanRevisionNote,
    agentProcess,
    agentSessionId,
    now,
    now
  )
  const row = getRequirementRowById(Number(result.lastInsertRowid))

  if (!row) {
    throw new Error('创建需求后读取记录失败')
  }

  return mapRow(row)
}

export function updateRequirement(input: {
  id: number
  title: string
  content: string
  status: RequirementStatus
  source: string
  standardizedData: RequirementStandardizedData | null
  prdReviewRejectCount: number
  waitingContext: RequirementWaitingContext | null
  humanRevisionNote: string
  agentProcess: string
  agentSessionId: string | null
}): Requirement | null {
  const db = getDb()
  const now = Date.now()
  const standardizedData = input.standardizedData ? JSON.stringify(input.standardizedData) : null
  const result = db
    .prepare(
      'UPDATE requirements SET title = ?, content = ?, status = ?, source = ?, standardized_data = ?, prd_review_reject_count = ?, waiting_context = ?, human_revision_note = ?, agent_process = ?, agent_session_id = ?, updated_at = ? WHERE id = ?'
    )
    .run(
      input.title,
      input.content,
      input.status,
      input.source.trim(),
      standardizedData,
      input.prdReviewRejectCount,
      input.waitingContext ?? '',
      input.humanRevisionNote.trim(),
      input.agentProcess,
      input.agentSessionId,
      now,
      input.id
    )

  if (result.changes === 0) {
    return null
  }

  const row = getRequirementRowById(input.id)
  return row ? mapRow(row) : null
}

export function updateRequirementSessionIdIfEmpty(input: { id: number; agentSessionId: string }): Requirement | null {
  const agentSessionId = input.agentSessionId.trim()
  if (!agentSessionId) {
    return getRequirementById(input.id)
  }

  const db = getDb()
  const now = Date.now()
  const result = db
    .prepare(
      `UPDATE requirements
       SET agent_session_id = ?, updated_at = ?
       WHERE id = ? AND (agent_session_id IS NULL OR agent_session_id = '')`
    )
    .run(agentSessionId, now, input.id)

  if (result.changes === 0) {
    return getRequirementById(input.id)
  }

  const row = getRequirementRowById(input.id)
  return row ? mapRow(row) : null
}

export function getRequirementById(id: number): Requirement | null {
  const row = getRequirementRowById(id)
  return row ? mapRow(row) : null
}

export function grabRequirementIfPending(id: number): Requirement | null {
  const db = getDb()
  const now = Date.now()
  const result = db
    .prepare("UPDATE requirements SET status = 'evaluating', updated_at = ? WHERE id = ? AND status = 'pending'")
    .run(now, id)

  if (result.changes === 0) {
    return null
  }

  const row = getRequirementRowById(id)
  return row ? mapRow(row) : null
}

export function listRequirementsByProject(projectId: number): Requirement[] {
  const db = getDb()
  const rows = db
    .prepare(
      'SELECT id, project_id, title, content, status, source, standardized_data, prd_review_reject_count, waiting_context, human_revision_note, agent_process, agent_session_id, created_at, updated_at FROM requirements WHERE project_id = ? ORDER BY created_at DESC'
    )
    .all(projectId) as DbRequirementRow[]

  return rows.map(mapRow)
}

export function listRequirementsGlobal(): Requirement[] {
  const db = getDb()
  const rows = db
    .prepare(
      'SELECT id, project_id, title, content, status, source, standardized_data, prd_review_reject_count, waiting_context, human_revision_note, agent_process, agent_session_id, created_at, updated_at FROM requirements ORDER BY created_at DESC'
    )
    .all() as DbRequirementRow[]

  return rows.map(mapRow)
}
