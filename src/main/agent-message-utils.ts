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
    const sourceSdk = typeof item.sourceSdk === 'string' ? item.sourceSdk.trim() : ''
    const rawPayload = item.payload
    const normalizedItem = sourceSdk && rawPayload !== undefined ? rawPayload : item
    if (!isRecord(normalizedItem)) {
      continue
    }

    if (normalizedItem.type === 'assistant' || normalizedItem.type === 'user') {
      const message = isRecord(normalizedItem.message) ? normalizedItem.message : null
      const content = extractMessageContent(message?.content)
      if (!content) {
        continue
      }

      messages.push({
        id: `msg-${i}`,
        role: normalizedItem.type === 'assistant' ? 'assistant' : 'user',
        content
      })
      continue
    }

    if (normalizedItem.type === 'result') {
      const subtype = typeof normalizedItem.subtype === 'string' ? normalizedItem.subtype : ''
      const result = typeof normalizedItem.result === 'string' ? normalizedItem.result.trim() : ''
      const errors = Array.isArray(normalizedItem.errors) ? normalizedItem.errors.filter((value): value is string => typeof value === 'string') : []

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
    const wrapped = item as unknown as Record<string, unknown>
    const sourceSdk = typeof wrapped.sourceSdk === 'string' ? wrapped.sourceSdk.trim() : ''
    const record = (sourceSdk && wrapped.payload && typeof wrapped.payload === 'object'
      ? wrapped.payload
      : wrapped) as Record<string, unknown>
    if (sourceSdk === 'codex') {
      const type = typeof record.type === 'string' ? record.type : ''
      if (type === 'response') {
        const response = isRecord(record.response) ? record.response : null
        const responseId = typeof response?.id === 'string' ? response.id : `codex-response-${index}`
        const outputText = typeof response?.output_text === 'string' ? response.output_text.trim() : ''
        if (outputText) {
          return {
            id: responseId,
            role: 'assistant',
            content: outputText
          } as RequirementConversationMessage
        }

        const content = extractMessageContent(response?.output)
        return {
          id: responseId,
          role: 'assistant',
          content
        } as RequirementConversationMessage
      }
      if (type === 'input_items') {
        const data = isRecord(record.data) ? record.data : null
        const inputItems = Array.isArray(data?.data) ? data.data : []
        const merged = inputItems
          .map((inputItem) => {
            if (!isRecord(inputItem)) {
              return ''
            }
            return extractMessageContent(inputItem.content)
          })
          .filter(Boolean)
          .join('\n')
          .trim()
        return {
          id: `codex-input-items-${index}`,
          role: 'user',
          content: merged
        } as RequirementConversationMessage
      }
    }

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
    const wrapped = item as unknown as Record<string, unknown>
    const sourceSdk = typeof wrapped.sourceSdk === 'string' ? wrapped.sourceSdk.trim() : ''
    const record = (sourceSdk && wrapped.payload && typeof wrapped.payload === 'object'
      ? wrapped.payload
      : wrapped) as Record<string, unknown>
    if (sourceSdk === 'codex') {
      const type = typeof record.type === 'string' ? record.type : ''
      if (type === 'response') {
        const response = isRecord(record.response) ? record.response : null
        const responseId = typeof response?.id === 'string' ? response.id : `codex-response-${index}`
        const outputText = typeof response?.output_text === 'string' ? response.output_text.trim() : ''
        if (outputText) {
          normalized.push({
            id: responseId,
            role: 'assistant',
            messageType: 'text',
            content: outputText
          })
          continue
        }
        const outputTextFallback = extractMessageContent(response?.output)
        if (outputTextFallback) {
          normalized.push({
            id: responseId,
            role: 'assistant',
            messageType: 'text',
            content: outputTextFallback
          })
          continue
        }
      }

      if (type === 'input_items') {
        const data = isRecord(record.data) ? record.data : null
        const inputItems = Array.isArray(data?.data) ? data.data : []
        for (let inputIndex = 0; inputIndex < inputItems.length; inputIndex += 1) {
          const inputItem = inputItems[inputIndex]
          if (!isRecord(inputItem)) {
            continue
          }
          const content = extractMessageContent(inputItem.content) || JSON.stringify(inputItem)
          if (!content.trim()) {
            continue
          }
          const role =
            inputItem.role === 'assistant'
              ? 'assistant'
              : inputItem.role === 'user'
                ? 'user'
                : 'system'
          normalized.push({
            id: `codex-input-${index}-${inputIndex}`,
            role,
            messageType: 'text',
            content
          })
        }
        continue
      }
    }

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
    const sourceSdk = typeof item.sourceSdk === 'string' ? item.sourceSdk.trim() : ''
    const normalizedItem = sourceSdk && item.payload !== undefined ? item.payload : item
    if (!isRecord(normalizedItem)) {
      continue
    }

    if (sourceSdk === 'codex') {
      const codexMessages = parseTaskTraceMessagesFromSessionList([item])
      messages.push(...codexMessages)
      continue
    }

    const type = typeof normalizedItem.type === 'string' ? normalizedItem.type : ''
    if (type === 'assistant' || type === 'user') {
      const message = isRecord(normalizedItem.message) ? normalizedItem.message : null
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
      const name = typeof normalizedItem.name === 'string' ? normalizedItem.name.trim() : 'tool'
      const input = normalizedItem.input
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
      const isError = normalizedItem.is_error === true
      const result = normalizedItem.result
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
      const subtype = typeof normalizedItem.subtype === 'string' ? normalizedItem.subtype : ''
      const result = typeof normalizedItem.result === 'string' ? normalizedItem.result.trim() : ''
      const errors = Array.isArray(normalizedItem.errors) ? normalizedItem.errors.filter((value): value is string => typeof value === 'string') : []
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
