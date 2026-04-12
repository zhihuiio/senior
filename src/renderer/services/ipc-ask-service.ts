import type { AskRequest, AskResponse, AskService } from './ask-service'

export class IpcAskService implements AskService {
  async ask(req: AskRequest): Promise<AskResponse> {
    const res = await window.api.sendPrompt({ prompt: req.prompt, projectId: req.projectId })

    if (!res.ok) {
      throw new Error(res.error.message)
    }

    return {
      text: res.data.text
    }
  }
}
