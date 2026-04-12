import type { Project } from '../../shared/types'
import { pickText } from '../i18n'

export interface CreateProjectRequest {
  path: string
}

export interface RevealProjectInFinderRequest {
  path: string
}

function getRendererApi() {
  if (!window.api) {
    throw new Error(pickText('客户端接口不可用，请重启应用', 'Renderer API is unavailable. Please restart the app.'))
  }

  return window.api
}

export async function createProject(req: CreateProjectRequest): Promise<Project> {
  const api = getRendererApi()
  const res = await api.createProject(req)

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return res.data.project
}

export async function fetchProjects(): Promise<Project[]> {
  const api = getRendererApi()
  const res = await api.listProjects()

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return res.data.projects
}

export async function revealProjectInFinder(req: RevealProjectInFinderRequest): Promise<boolean> {
  const api = getRendererApi()
  if (typeof api.revealProjectInFinder !== 'function') {
    throw new Error(
      pickText(
        '当前客户端版本不支持“在Finder中查看”，请重启应用后重试',
        'This app version does not support "Reveal in Finder". Please restart and try again.'
      )
    )
  }

  const res = await api.revealProjectInFinder(req)

  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return res.data.opened
}
