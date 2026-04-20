import type { AgentSdkType, AppSettings } from '../../shared/types'
import { pickText } from '../i18n'

function getRendererApi() {
  if (!window.api) {
    throw new Error(pickText('客户端接口不可用，请重启应用', 'Renderer API is unavailable. Please restart the app.'))
  }

  return window.api
}

export async function getAppSettings(): Promise<AppSettings> {
  const api = getRendererApi()
  if (typeof api.getSettings !== 'function') {
    throw new Error(
      pickText(
        '当前客户端版本不支持设置读取，请重启应用后重试',
        'This app version does not support settings read. Please restart and try again.'
      )
    )
  }

  const res = await api.getSettings()
  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return res.data.settings
}

export async function updateAppSettings(input: { agentSdkType: AgentSdkType }): Promise<AppSettings> {
  const api = getRendererApi()
  if (typeof api.updateSettings !== 'function') {
    throw new Error(
      pickText(
        '当前客户端版本不支持设置更新，请重启应用后重试',
        'This app version does not support settings update. Please restart and try again.'
      )
    )
  }

  const res = await api.updateSettings({ agentSdkType: input.agentSdkType })
  if (!res.ok) {
    throw new Error(res.error.message)
  }

  return res.data.settings
}
