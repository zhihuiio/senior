import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentSdkRunInput, AgentSdkRunResult, AgentSdkStrategy, AgentMessageEvent } from './agent-sdk-types'

interface OpenAiClientShape {
  responses?: {
    create?: (input: Record<string, unknown>) => Promise<Record<string, unknown>>
    retrieve?: (responseId: string) => Promise<Record<string, unknown>>
    stream?: (
      input: Record<string, unknown>
    ) => Promise<AsyncIterable<Record<string, unknown>> & { finalResponse?: () => Promise<Record<string, unknown>> }>
    input_items?: {
      list?: (responseId: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>
    }
  }
}

interface CodexTomlConfig {
  modelProvider: string | null
  model: string | null
  providerBaseUrl: string | null
  providerHeaders: Record<string, string>
}

function normalizeText(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).filter(Boolean).join('\n')
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.text === 'string') {
      return record.text
    }
    if (typeof record.output_text === 'string') {
      return record.output_text
    }
    if (record.content !== undefined) {
      return normalizeText(record.content)
    }
  }

  return ''
}

function resolveResultText(response: Record<string, unknown>, fallback = ''): string {
  const outputText = normalizeText(response.output_text)
  if (outputText.trim()) {
    return outputText.trim()
  }

  const output = response.output
  if (Array.isArray(output)) {
    const combined = output
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return ''
        }
        return normalizeText((item as Record<string, unknown>).content)
      })
      .filter(Boolean)
      .join('\n')
      .trim()
    if (combined) {
      return combined
    }
  }

  return fallback.trim()
}

function parseTomlStringValue(line: string): string | null {
  const match = line.match(/=\s*"(.*)"\s*$/)
  if (!match) {
    return null
  }

  return match[1] ?? null
}

function parseTomlHeaderMapInline(line: string): Record<string, string> {
  const mapMatch = line.match(/=\s*\{(.+)\}\s*$/)
  if (!mapMatch) {
    return {}
  }

  const body = mapMatch[1]
  const result: Record<string, string> = {}
  const entryRegex = /"([^"]+)"\s*=\s*"([^"]*)"/g
  let entryMatch: RegExpExecArray | null = null
  while ((entryMatch = entryRegex.exec(body)) !== null) {
    const key = entryMatch[1]?.trim()
    const value = entryMatch[2] ?? ''
    if (key) {
      result[key] = value
    }
  }

  return result
}

function parseCodexConfigToml(raw: string): CodexTomlConfig {
  const lines = raw.split(/\r?\n/)
  let section = ''
  let modelProvider: string | null = null
  let model: string | null = null
  const providerBaseUrlByName = new Map<string, string>()
  const providerHeadersByName = new Map<string, Record<string, string>>()

  for (const lineRaw of lines) {
    const line = lineRaw.trim()
    if (!line || line.startsWith('#')) {
      continue
    }

    if (line.startsWith('[') && line.endsWith(']')) {
      section = line.slice(1, -1).trim()
      continue
    }

    if (!line.includes('=')) {
      continue
    }

    if (!section) {
      if (line.startsWith('model_provider')) {
        const value = parseTomlStringValue(line)
        if (value?.trim()) {
          modelProvider = value.trim()
        }
        continue
      }

      if (line.startsWith('model')) {
        const value = parseTomlStringValue(line)
        if (value?.trim()) {
          model = value.trim()
        }
      }
      continue
    }

    const providerSection = section.match(/^model_providers\.(.+)$/)
    if (!providerSection?.[1]) {
      continue
    }

    const providerName = providerSection[1].trim()
    if (!providerName) {
      continue
    }

    if (line.startsWith('base_url')) {
      const value = parseTomlStringValue(line)
      if (value?.trim()) {
        providerBaseUrlByName.set(providerName, value.trim())
      }
      continue
    }

    if (line.startsWith('http_headers')) {
      const map = parseTomlHeaderMapInline(line)
      if (Object.keys(map).length > 0) {
        providerHeadersByName.set(providerName, map)
      }
    }
  }

  const selectedProvider = modelProvider?.trim() || null
  const providerBaseUrl = selectedProvider ? providerBaseUrlByName.get(selectedProvider) ?? null : null
  const providerHeaders = selectedProvider ? providerHeadersByName.get(selectedProvider) ?? {} : {}

  return {
    modelProvider: selectedProvider,
    model: model?.trim() || null,
    providerBaseUrl,
    providerHeaders
  }
}

async function readCodexConfigToml(): Promise<CodexTomlConfig | null> {
  const configPath = join(homedir(), '.codex', 'config.toml')
  try {
    const content = await readFile(configPath, 'utf8')
    return parseCodexConfigToml(content)
  } catch {
    return null
  }
}

async function getOpenAiClientAndModel(): Promise<{ client: OpenAiClientShape; model: string }> {
  const openAiModule = (await import('openai')) as unknown as {
    default?: new (input: Record<string, unknown>) => OpenAiClientShape
    OpenAI?: new (input: Record<string, unknown>) => OpenAiClientShape
  }
  const OpenAI = openAiModule.default ?? openAiModule.OpenAI
  if (!OpenAI) {
    throw new Error('Codex SDK 初始化失败：未找到 OpenAI Node SDK 导出')
  }

  const codexToml = await readCodexConfigToml()
  const model = codexToml?.model || 'gpt-5-codex'
  const apiKeyFromEnv = process.env.OPENAI_API_KEY?.trim()

  const ctorInput: Record<string, unknown> = {}
  if (apiKeyFromEnv) {
    ctorInput.apiKey = apiKeyFromEnv
  } else {
    // Do not require env key; rely on provider headers from ~/.codex/config.toml.
    ctorInput.apiKey = 'not-required-when-provider-headers-present'
  }

  if (codexToml?.providerBaseUrl) {
    ctorInput.baseURL = codexToml.providerBaseUrl
  }

  if (codexToml?.providerHeaders && Object.keys(codexToml.providerHeaders).length > 0) {
    ctorInput.defaultHeaders = codexToml.providerHeaders
  }

  const client = new OpenAI(ctorInput)
  return { client, model }
}

function buildCodexInput(input: AgentSdkRunInput, model: string): Record<string, unknown> {
  const userText = input.prompt.trim()
  const payload: Record<string, unknown> = {
    model,
    store: true,
    input: [
      {
        role: 'user',
        content: [{ type: 'input_text', text: userText }]
      }
    ]
  }

  if (input.systemPrompt?.trim()) {
    payload.instructions = input.systemPrompt.trim()
  }

  if (input.resumeSessionId?.trim()) {
    payload.previous_response_id = input.resumeSessionId.trim()
  }

  return payload
}

export class CodexAgentSdkStrategy implements AgentSdkStrategy {
  readonly sdkType = 'codex' as const

  async runQuery(input: AgentSdkRunInput): Promise<AgentSdkRunResult> {
    const { client, model } = await getOpenAiClientAndModel()
    const responsesApi = client.responses
    if (!responsesApi?.create) {
      throw new Error('Codex SDK 不可用：responses.create 未找到')
    }

    const request = buildCodexInput(input, model)
    const conversations: AgentMessageEvent[] = [
      {
        sourceSdk: 'codex',
        payload: {
          type: 'input',
          prompt: input.prompt,
          systemPrompt: input.systemPrompt ?? '',
          resumeSessionId: input.resumeSessionId ?? null
        }
      }
    ]
    let sessionId: string | null = input.resumeSessionId ?? null
    let outputTextFromDelta = ''

    const publishProgress = (message: AgentMessageEvent): void => {
      conversations.push(message)
      input.onProgress?.({
        conversations,
        sessionId,
        message
      })
    }

    if (responsesApi.stream) {
      const stream = await responsesApi.stream(request)
      for await (const event of stream) {
        const eventType = typeof event?.type === 'string' ? event.type : 'event'
        if (eventType === 'response.output_text.delta' && typeof event.delta === 'string') {
          outputTextFromDelta += event.delta
        }

        publishProgress({
          sourceSdk: 'codex',
          payload: {
            type: 'stream_event',
            event
          }
        })
      }

      if (typeof stream.finalResponse === 'function') {
        const finalResponse = await stream.finalResponse()
        if (typeof finalResponse?.id === 'string' && finalResponse.id.trim()) {
          sessionId = finalResponse.id.trim()
        }
        publishProgress({
          sourceSdk: 'codex',
          payload: {
            type: 'response',
            response: finalResponse
          }
        })
        const resultText = resolveResultText(finalResponse, outputTextFromDelta)
        if (!resultText.trim()) {
          throw new Error(input.noResultMessage)
        }
        return {
          resultText,
          conversations,
          sessionId
        }
      }
    }

    const response = await responsesApi.create(request)
    if (typeof response?.id === 'string' && response.id.trim()) {
      sessionId = response.id.trim()
    }
    publishProgress({
      sourceSdk: 'codex',
      payload: {
        type: 'response',
        response
      }
    })

    const resultText = resolveResultText(response, outputTextFromDelta)
    if (!resultText.trim()) {
      throw new Error(input.noResultMessage)
    }

    return {
      resultText,
      conversations,
      sessionId
    }
  }

  async getSessionMessages(sessionId: string): Promise<AgentMessageEvent[]> {
    const normalizedSessionId = sessionId.trim()
    if (!normalizedSessionId) {
      throw new Error('no available session id')
    }

    const { client } = await getOpenAiClientAndModel()
    const responsesApi = client.responses
    if (!responsesApi?.retrieve) {
      throw new Error('Codex SDK 不可用：responses.retrieve 未找到')
    }

    const messages: AgentMessageEvent[] = []
    if (responsesApi.input_items?.list) {
      const inputItemsResult = await responsesApi.input_items.list(normalizedSessionId, { limit: 200 })
      messages.push({
        sourceSdk: 'codex',
        payload: {
          type: 'input_items',
          data: inputItemsResult
        }
      })
    } else {
      throw new Error('Codex SDK 不支持远端会话消息拉取（缺少 responses.input_items.list）')
    }

    const response = await responsesApi.retrieve(normalizedSessionId)
    messages.push({
      sourceSdk: 'codex',
      payload: {
        type: 'response',
        response
      }
    })

    return messages
  }
}
