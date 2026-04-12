export interface AskRequest {
  prompt: string
  projectId?: number
}

export interface AskResponse {
  text: string
}

export interface AskService {
  ask(req: AskRequest): Promise<AskResponse>
}
