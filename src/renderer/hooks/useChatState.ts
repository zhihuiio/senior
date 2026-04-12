import { useCallback, useMemo, useState } from 'react'
import type { Message, Role } from '../../shared/types'
import type { AskService } from '../services/ask-service'
import { pickText } from '../i18n'

interface UseChatStateInput {
  askService: AskService
  projectId?: number | null
}

function createMessage(role: Role, content: string): Message {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role,
    content,
    createdAt: Date.now()
  }
}

export function useChatState({ askService, projectId }: UseChatStateInput) {
  const [prompt, setPrompt] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const canSend = useMemo(() => !loading && !!prompt.trim(), [loading, prompt])

  const onSend = useCallback(async () => {
    const input = prompt.trim()
    if (!input || loading) {
      return
    }

    setPrompt('')
    setError('')
    setLoading(true)
    setMessages((prev) => [...prev, createMessage('user', input)])

    try {
      const res = await askService.ask({ prompt: input, projectId: projectId ?? undefined })
      setMessages((prev) => [...prev, createMessage('assistant', res.text)])
    } catch (e) {
      setError(e instanceof Error ? e.message : pickText('请求失败', 'Request failed'))
    } finally {
      setLoading(false)
    }
  }, [askService, loading, prompt, projectId])

  const clearMessages = useCallback(() => {
    setMessages([])
    setError('')
  }, [])

  return {
    prompt,
    setPrompt,
    messages,
    loading,
    error,
    canSend,
    onSend,
    clearMessages
  }
}
