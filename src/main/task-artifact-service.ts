import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getDb } from './db'

export interface TaskArtifactFile {
  fileName: string
  size: number
  updatedAt: number
}

export async function resolveTaskArtifactDir(taskId: number): Promise<string> {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT p.path AS project_path
       FROM tasks t
       INNER JOIN projects p ON p.id = t.project_id
       WHERE t.id = ?`
    )
    .get(taskId) as { project_path: string } | undefined

  if (!row?.project_path?.trim()) {
    throw new Error('无法解析任务产物目录')
  }

  const dir = join(row.project_path, '.senior', 'tasks', String(taskId))
  await mkdir(dir, { recursive: true })
  return dir
}

export async function readArtifactIfExists(dir: string, fileName: string): Promise<string | null> {
  try {
    const content = await readFile(join(dir, fileName), 'utf8')
    const text = content.trim()
    return text ? text : null
  } catch {
    return null
  }
}

export async function writeArtifact(dir: string, fileName: string, content: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, fileName), content, 'utf8')
}

export async function listTaskArtifacts(taskId: number): Promise<TaskArtifactFile[]> {
  if (!Number.isInteger(taskId) || taskId <= 0) {
    throw new Error('taskId 非法')
  }

  const dir = await resolveTaskArtifactDir(taskId)
  const entries = await readdir(dir, { withFileTypes: true })
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const fullPath = join(dir, entry.name)
        const meta = await stat(fullPath)
        return {
          fileName: entry.name,
          size: meta.size,
          updatedAt: meta.mtimeMs
        }
      })
  )

  return files.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function readTaskArtifact(taskId: number, fileName: string): Promise<string> {
  if (!Number.isInteger(taskId) || taskId <= 0) {
    throw new Error('taskId 非法')
  }

  const normalizedFileName = fileName.trim()
  if (!normalizedFileName || normalizedFileName.includes('/') || normalizedFileName.includes('\\') || normalizedFileName === '.' || normalizedFileName === '..') {
    throw new Error('fileName 非法')
  }

  const dir = await resolveTaskArtifactDir(taskId)
  const fullPath = join(dir, normalizedFileName)
  const content = await readFile(fullPath, 'utf8')
  return content
}
