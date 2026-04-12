import type { RequirementConversationMessage, TaskAgentTraceMessage } from '../shared/types'

export function stringifyAgentConversations(conversations: unknown[]): string {
  const seen = new WeakSet<object>()
  try {
    return JSON.stringify(conversations, (_key, value: unknown) => {
      if (typeof value === 'bigint') {
        return value.toString()
      }

      if (value && typeof value === 'object') {
        if (seen.has(value as object)) {
          return '[Circular]'
        }

        seen.add(value as object)
      }

      return value
    })
  } catch {
    return '[]'
  }
}

export function parseAgentConversations(raw: string): unknown[] {
  const text = raw.trim()
  if (!text) {
    return []
  }

  try {
    const value = JSON.parse(text) as unknown
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function extractMessageContent(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim()
  }

  if (Array.isArray(value)) {
    const parts: string[] = []
    for (const item of value) {
      if (!isRecord(item)) {
        continue
      }

      if (typeof item.text === 'string' && item.text.trim()) {
        parts.push(item.text.trim())
      }
    }
    return parts.join('\n').trim()
  }

  if (isRecord(value) && typeof value.text === 'string') {
    return value.text.trim()
  }

  return ''
}

export function parseConversationMessages(conversations: unknown[]): RequirementConversationMessage[] {
  const messages: RequirementConversationMessage[] = []

  for (let i = 0; i < conversations.length; i += 1) {
    const item = conversations[i]
    if (!isRecord(item)) {
      continue
    }

    if (item.type === 'assistant' || item.type === 'user') {
      const message = isRecord(item.message) ? item.message : null
      const content = extractMessageContent(message?.content)
      if (!content) {
        continue
      }

      messages.push({
        id: `msg-${i}`,
        role: item.type === 'assistant' ? 'assistant' : 'user',
        content
      })
      continue
    }

    if (item.type === 'result') {
      const subtype = typeof item.subtype === 'string' ? item.subtype : ''
      const result = typeof item.result === 'string' ? item.result.trim() : ''
      const errors = Array.isArray(item.errors) ? item.errors.filter((value): value is string => typeof value === 'string') : []

      if (subtype === 'success' && result) {
        messages.push({
          id: `result-${i}`,
          role: 'assistant',
          content: result
        })
        continue
      }

      if (subtype === 'error' && errors.length > 0) {
        messages.push({
          id: `err-${i}`,
          role: 'system',
          content: errors.join('\n')
        })
      }
    }
  }

  return messages
}

export function parseRequirementMessagesFromSessionList(list: unknown[]): RequirementConversationMessage[] {
  const normalized = list.map((item, index) => {
    const record = item as unknown as Record<string, unknown>
    const type = typeof record.type === 'string' ? record.type : ''
    const id = typeof record.uuid === 'string' && record.uuid ? record.uuid : `session-msg-${index}`
    const messageRecord = isRecord(record.message) ? record.message : null

    if (type === 'result') {
      const subtype = typeof record.subtype === 'string' ? record.subtype : ''
      const resultText = typeof record.result === 'string' ? record.result.trim() : ''
      const errors = Array.isArray(record.errors)
        ? record.errors.filter((value): value is string => typeof value === 'string')
        : []
      if (subtype === 'success' && resultText) {
        return {
          id,
          role: 'assistant',
          content: resultText
        } as RequirementConversationMessage
      }

      if (subtype === 'error' && errors.length > 0) {
        return {
          id,
          role: 'system',
          content: errors.join('\n')
        } as RequirementConversationMessage
      }
    }

    const role: RequirementConversationMessage['role'] =
      type === 'user' || type === 'assistant' || type === 'system' ? type : 'system'
    const content = extractMessageContent(messageRecord?.content)

    return {
      id,
      role,
      content
    } as RequirementConversationMessage
  })

  return normalized.filter((item) => item.content)
}

export function parseTaskTraceMessagesFromSessionList(list: unknown[]): TaskAgentTraceMessage[] {
  const normalized: TaskAgentTraceMessage[] = []

  for (let index = 0; index < list.length; index += 1) {
    const item = list[index]
    const record = item as unknown as Record<string, unknown>
    const type = typeof record.type === 'string' ? record.type : ''
    const id = typeof record.uuid === 'string' && record.uuid ? record.uuid : `session-msg-${index}`
    const messageRecord = isRecord(record.message) ? record.message : null

    const rawBlocks = messageRecord?.content
    if (Array.isArray(rawBlocks) && rawBlocks.length > 0) {
      for (let blockIndex = 0; blockIndex < rawBlocks.length; blockIndex += 1) {
        const block = rawBlocks[blockIndex]
        const blockRecord = isRecord(block) ? block : null
        const blockType = typeof blockRecord?.type === 'string' ? blockRecord.type : 'unknown'

        let role: TaskAgentTraceMessage['role'] = type === 'user' ? 'user' : type === 'assistant' ? 'assistant' : 'system'
        let content = ''

        if (blockType === 'tool_use') {
          const name = typeof blockRecord?.name === 'string' && blockRecord.name.trim() ? blockRecord.name.trim() : 'tool'
          const input = blockRecord?.input
          let inputText = ''
          if (input !== undefined) {
            inputText = typeof input === 'string' ? input : JSON.stringify(input, null, 2)
          }
          role = 'tool'
          content = inputText ? `[${name}] ${inputText}` : `[${name}]`
        } else if (blockType === 'tool_result') {
          const isError = blockRecord?.is_error === true
          const result = blockRecord?.content
          let contentText = ''
          if (result !== undefined) {
            contentText = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
          }
          role = isError ? 'system' : 'tool'
          content = isError ? `工具执行失败: ${contentText || '(空返回)'}` : contentText || '(空返回)'
        } else if (blockType === 'text') {
          const text = typeof blockRecord?.text === 'string' ? blockRecord.text : ''
          content = text.trim()
        } else {
          const extracted = extractMessageContent(block)
          if (extracted) {
            content = extracted
          } else {
            try {
              content = JSON.stringify(block, null, 2)
            } catch {
              content = String(block)
            }
          }
        }

        if (!content) {
          try {
            content = JSON.stringify(block, null, 2)
          } catch {
            content = String(block)
          }
        }

        normalized.push({
          id: `${id}-${blockIndex}`,
          role,
          messageType: blockType,
          content,
          toolCallId:
            blockType === 'tool_use'
              ? (typeof blockRecord?.id === 'string' ? blockRecord.id : undefined)
              : blockType === 'tool_result'
                ? (typeof blockRecord?.tool_use_id === 'string' ? blockRecord.tool_use_id : undefined)
                : undefined,
          toolName: blockType === 'tool_use' && typeof blockRecord?.name === 'string' ? blockRecord.name : undefined,
          isError: blockType === 'tool_result' ? blockRecord?.is_error === true : undefined
        })
      }
      continue
    }

    const messageType = type || 'unknown'
    const role: TaskAgentTraceMessage['role'] =
      type === 'user'
        ? 'user'
        : type === 'assistant' || type === 'result'
          ? 'assistant'
          : type.startsWith('tool') || type === 'tool_use' || type === 'tool_result'
            ? 'tool'
            : 'system'

    const preferredValues: unknown[] = [record.result, record.error, record.errors, record.input, record.content, record.message]
    let content = ''
    for (const value of preferredValues) {
      if (value === undefined || value === null) {
        continue
      }

      if (typeof value === 'string') {
        const trimmed = value.trim()
        if (trimmed) {
          content = trimmed
          break
        }
        continue
      }

      if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
        const joined = value.join('\n').trim()
        if (joined) {
          content = joined
          break
        }
        continue
      }

      const extracted = extractMessageContent(value)
      if (extracted) {
        content = extracted
        break
      }

      try {
        const json = JSON.stringify(value, null, 2)
        if (json && json !== 'null' && json !== '""') {
          content = json
          break
        }
      } catch {
        // ignore stringify error and try next candidate
      }
    }

    if (!content) {
      try {
        content = JSON.stringify(record, null, 2)
      } catch {
        content = String(record)
      }
    }

    normalized.push({
      id,
      role,
      messageType,
      content
    })
  }

  return normalized
}

export function parseTaskTraceMessages(conversations: unknown[]): TaskAgentTraceMessage[] {
  const messages: TaskAgentTraceMessage[] = []

  for (let i = 0; i < conversations.length; i += 1) {
    const item = conversations[i]
    if (!isRecord(item)) {
      continue
    }

    const type = typeof item.type === 'string' ? item.type : ''
    if (type === 'assistant' || type === 'user') {
      const message = isRecord(item.message) ? item.message : null
      const content = extractMessageContent(message?.content)
      if (!content) {
        continue
      }
      messages.push({
        id: `msg-${i}`,
        role: type === 'assistant' ? 'assistant' : 'user',
        content
      })
      continue
    }

    if (type === 'tool_use') {
      const name = typeof item.name === 'string' ? item.name.trim() : 'tool'
      const input = item.input
      const inputText =
        input === undefined ? '' : typeof input === 'string' ? input : JSON.stringify(input, null, 2)
      const content = inputText ? `[${name}] ${inputText}` : `[${name}]`
      messages.push({
        id: `tool-use-${i}`,
        role: 'tool',
        content
      })
      continue
    }

    if (type === 'tool_result') {
      const isError = item.is_error === true
      const result = item.result
      const contentText =
        result === undefined ? '' : typeof result === 'string' ? result : JSON.stringify(result, null, 2)
      const content = isError ? `工具执行失败: ${contentText || '(空返回)'}` : contentText || '(空返回)'
      messages.push({
        id: `tool-result-${i}`,
        role: isError ? 'system' : 'tool',
        content
      })
      continue
    }

    if (type === 'result') {
      const subtype = typeof item.subtype === 'string' ? item.subtype : ''
      const result = typeof item.result === 'string' ? item.result.trim() : ''
      const errors = Array.isArray(item.errors) ? item.errors.filter((value): value is string => typeof value === 'string') : []
      if (subtype === 'success' && result) {
        messages.push({
          id: `result-${i}`,
          role: 'assistant',
          content: result
        })
        continue
      }

      if (subtype === 'error' && errors.length > 0) {
        messages.push({
          id: `result-error-${i}`,
          role: 'system',
          content: errors.join('\n')
        })
      }
    }
  }

  return messages
}
