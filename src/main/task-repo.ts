import { getDb } from './db'
import type { Task, TaskStatus, TaskWaitingContext } from '../shared/types'

interface DbTaskRow {
  id: number
  project_id: number
  requirement_id: number | null
  title: string
  content: string
  status: TaskStatus
  tech_review_reject_count: number
  qa_reject_count: number
  waiting_context: string
  human_revision_note: string
  created_at: number
  updated_at: number
}

function normalizeWaitingContext(value: string): TaskWaitingContext | null {
  if (value === 'tech_review_gate' || value === 'qa_gate' || value === 'arch_design_gate' || value === 'coding_gate') {
    return value
  }

  return null
}

function mapRow(row: DbTaskRow): Task {
  return {
    id: row.id,
    projectId: row.project_id,
    requirementId: row.requirement_id,
    title: row.title,
    content: row.content,
    status: row.status,
    techReviewRejectCount: row.tech_review_reject_count,
    qaRejectCount: row.qa_reject_count,
    waitingContext: normalizeWaitingContext(row.waiting_context),
    humanRevisionNote: row.human_revision_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function getTaskRowById(id: number): DbTaskRow | undefined {
  const db = getDb()
  return db
    .prepare(
      'SELECT id, project_id, requirement_id, title, content, status, tech_review_reject_count, qa_reject_count, waiting_context, human_revision_note, created_at, updated_at FROM tasks WHERE id = ?'
    )
    .get(id) as DbTaskRow | undefined
}

export function insertTask(input: {
  projectId: number
  requirementId?: number | null
  title: string
  content: string
  status?: TaskStatus
  techReviewRejectCount?: number
  qaRejectCount?: number
  waitingContext?: TaskWaitingContext | null
  humanRevisionNote?: string
}): Task {
  const now = Date.now()
  const db = getDb()
  const status = input.status ?? 'idle'
  const techReviewRejectCount = input.techReviewRejectCount ?? 0
  const qaRejectCount = input.qaRejectCount ?? 0
  const requirementId = input.requirementId ?? null
  const waitingContext = input.waitingContext ?? null
  const humanRevisionNote = input.humanRevisionNote?.trim() ?? ''
  const stmt = db.prepare(
    'INSERT INTO tasks (project_id, requirement_id, title, content, status, tech_review_reject_count, qa_reject_count, waiting_context, human_revision_note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )

  const result = stmt.run(
    input.projectId,
    requirementId,
    input.title,
    input.content,
    status,
    techReviewRejectCount,
    qaRejectCount,
    waitingContext ?? '',
    humanRevisionNote,
    now,
    now
  )
  const row = getTaskRowById(Number(result.lastInsertRowid))

  if (!row) {
    throw new Error('创建任务后读取记录失败')
  }

  return mapRow(row)
}

export function updateTask(input: {
  id: number
  title: string
  content: string
  status: TaskStatus
  techReviewRejectCount: number
  qaRejectCount: number
  waitingContext: TaskWaitingContext | null
  humanRevisionNote: string
}): Task | null {
  const db = getDb()
  const now = Date.now()
  const result = db
    .prepare(
      'UPDATE tasks SET title = ?, content = ?, status = ?, tech_review_reject_count = ?, qa_reject_count = ?, waiting_context = ?, human_revision_note = ?, updated_at = ? WHERE id = ?'
    )
    .run(
      input.title,
      input.content,
      input.status,
      input.techReviewRejectCount,
      input.qaRejectCount,
      input.waitingContext ?? '',
      input.humanRevisionNote.trim(),
      now,
      input.id
    )

  if (result.changes === 0) {
    return null
  }

  const row = getTaskRowById(input.id)
  return row ? mapRow(row) : null
}

export function getTaskById(id: number): Task | null {
  const row = getTaskRowById(id)
  return row ? mapRow(row) : null
}

export function listTasksByRequirement(requirementId: number): Task[] {
  const db = getDb()
  const rows = db
    .prepare(
      'SELECT id, project_id, requirement_id, title, content, status, tech_review_reject_count, qa_reject_count, waiting_context, human_revision_note, created_at, updated_at FROM tasks WHERE requirement_id = ? ORDER BY created_at DESC'
    )
    .all(requirementId) as DbTaskRow[]

  return rows.map(mapRow)
}

export function listTasksByProject(projectId: number): Task[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT t.id, t.project_id, t.requirement_id, t.title, t.content, t.status, t.tech_review_reject_count, t.qa_reject_count, t.waiting_context, t.human_revision_note, t.created_at, t.updated_at
       FROM tasks t
       WHERE t.project_id = ?
       ORDER BY t.created_at DESC`
    )
    .all(projectId) as DbTaskRow[]

  return rows.map(mapRow)
}

export function listTasksGlobal(): Task[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT t.id, t.project_id, t.requirement_id, t.title, t.content, t.status, t.tech_review_reject_count, t.qa_reject_count, t.waiting_context, t.human_revision_note, t.created_at, t.updated_at
       FROM tasks t
       ORDER BY t.created_at DESC`
    )
    .all() as DbTaskRow[]

  return rows.map(mapRow)
}
