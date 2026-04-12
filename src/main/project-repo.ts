import { basename } from 'node:path'
import { getDb } from './db'
import type { Project } from '../shared/types'

interface DbProjectRow {
  id: number
  path: string
}

function mapRow(row: DbProjectRow): Project {
  return {
    id: row.id,
    path: row.path
  }
}

export function insertProject(input: { path: string }): Project {
  const db = getDb()
  const now = Date.now()
  const safeName = basename(input.path) || input.path

  const result = db
    .prepare('INSERT INTO projects (name, path, status, created_at) VALUES (?, ?, ?, ?)')
    .run(safeName, input.path, 'idle', now)

  return {
    id: Number(result.lastInsertRowid),
    path: input.path
  }
}

export function findProjectByPath(path: string): Project | null {
  const db = getDb()
  const row = db.prepare('SELECT id, path FROM projects WHERE path = ?').get(path) as DbProjectRow | undefined
  return row ? mapRow(row) : null
}

export function getProjectById(id: number): Project | null {
  const db = getDb()
  const row = db.prepare('SELECT id, path FROM projects WHERE id = ?').get(id) as DbProjectRow | undefined
  return row ? mapRow(row) : null
}

export function listProjects(): Project[] {
  const db = getDb()
  const rows = db.prepare('SELECT id, path FROM projects ORDER BY id DESC').all() as DbProjectRow[]
  return rows.map(mapRow)
}
