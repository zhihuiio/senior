import type { AskRequest, AskResponse, AskService } from './ask-service'
import { pickText } from '../i18n'

function getRendererApi() {
  if (!window.api) {
    throw new Error(pickText('客户端接口不可用，请重启应用', 'Renderer API is unavailable. Please restart the app.'))
  }

  return window.api
}

export class IpcAskService implements AskService {
  async ask(req: AskRequest): Promise<AskResponse> {
    const api = getRendererApi()
    const res = await api.sendPrompt({ prompt: req.prompt, projectId: req.projectId })

    if (!res.ok) {
      throw new Error(res.error.message)
    }

    return {
      text: res.data.text
    }
  }
}
