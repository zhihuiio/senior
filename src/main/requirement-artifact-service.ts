import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getDb } from './db'

export interface RequirementArtifactFile {
  fileName: string
  size: number
  updatedAt: number
}

export async function resolveRequirementArtifactDir(requirementId: number): Promise<string> {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT p.path AS project_path
       FROM requirements r
       INNER JOIN projects p ON p.id = r.project_id
       WHERE r.id = ?`
    )
    .get(requirementId) as { project_path: string } | undefined

  if (!row?.project_path?.trim()) {
    throw new Error('无法解析需求产物目录')
  }

  const dir = join(row.project_path, '.senior', 'requirements', String(requirementId))
  await mkdir(dir, { recursive: true })
  return dir
}

export async function readRequirementArtifactIfExists(dir: string, fileName: string): Promise<string | null> {
  try {
    const content = await readFile(join(dir, fileName), 'utf8')
    const text = content.trim()
    return text ? text : null
  } catch {
    return null
  }
}

export async function writeRequirementArtifact(dir: string, fileName: string, content: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, fileName), content, 'utf8')
}

export async function listRequirementArtifacts(requirementId: number): Promise<RequirementArtifactFile[]> {
  if (!Number.isInteger(requirementId) || requirementId <= 0) {
    throw new Error('requirementId 非法')
  }

  const dir = await resolveRequirementArtifactDir(requirementId)
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

export async function readRequirementArtifact(requirementId: number, fileName: string): Promise<string> {
  if (!Number.isInteger(requirementId) || requirementId <= 0) {
    throw new Error('requirementId 非法')
  }

  const normalizedFileName = fileName.trim()
  if (!normalizedFileName || normalizedFileName.includes('/') || normalizedFileName.includes('\\') || normalizedFileName === '.' || normalizedFileName === '..') {
    throw new Error('fileName 非法')
  }

  const dir = await resolveRequirementArtifactDir(requirementId)
  const fullPath = join(dir, normalizedFileName)
  const content = await readFile(fullPath, 'utf8')
  return content
}
