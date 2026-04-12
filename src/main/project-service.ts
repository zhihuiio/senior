import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Project } from '../shared/types'
import { findProjectByPath, getProjectById, insertProject, listProjects } from './project-repo'

export class ProjectServiceError extends Error {
  constructor(public readonly code: 'INVALID_INPUT' | 'CONFLICT' | 'NOT_DIRECTORY' | 'DB_ERROR', message: string) {
    super(message)
  }
}

function normalizePath(path: string): string {
  const normalized = path.trim()
  if (!normalized) {
    throw new ProjectServiceError('INVALID_INPUT', '目录路径不能为空')
  }

  return resolve(normalized)
}

async function ensureDirectory(path: string): Promise<void> {
  try {
    const result = await stat(path)
    if (!result.isDirectory()) {
      throw new ProjectServiceError('NOT_DIRECTORY', '请选择目录而不是文件')
    }
  } catch (error) {
    if (error instanceof ProjectServiceError) {
      throw error
    }

    throw new ProjectServiceError('NOT_DIRECTORY', '目录不存在或不可访问')
  }
}

export async function createProjectByPath(path: string): Promise<Project> {
  const normalizedPath = normalizePath(path)
  await ensureDirectory(normalizedPath)

  const exists = findProjectByPath(normalizedPath)
  if (exists) {
    throw new ProjectServiceError('CONFLICT', '该目录已创建为项目')
  }

  try {
    return insertProject({ path: normalizedPath })
  } catch (error) {
    throw new ProjectServiceError('DB_ERROR', error instanceof Error ? error.message : '写入项目失败')
  }
}

export function getProjects(): Project[] {
  return listProjects()
}

export function getProject(projectId: number): Project | null {
  if (!Number.isInteger(projectId) || projectId <= 0) {
    throw new ProjectServiceError('INVALID_INPUT', 'projectId 非法')
  }

  return getProjectById(projectId)
}
