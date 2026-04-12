import { AgentRunnerError, runAgentQuery } from './agent-runner'
import { FREEFORM_AGENT_SYSTEM_PROMPT } from './prompts'

interface AskAgentInput {
  prompt: string
  cwd?: string
}

let runAgentQueryImpl: typeof runAgentQuery = runAgentQuery

export function setRunAgentQueryForTest(fn: typeof runAgentQuery): void {
  runAgentQueryImpl = fn
}

export function resetRunAgentQueryForTest(): void {
  runAgentQueryImpl = runAgentQuery
}

function normalizePrompt(prompt: string): string {
  const value = prompt.trim()
  if (!value) {
    throw new Error('提示词不能为空')
  }

  return value
}

export async function runFreeFormAgent(prompt: string, cwd?: string): Promise<string> {
  try {
    const result = await runAgentQueryImpl({
      systemPrompt: FREEFORM_AGENT_SYSTEM_PROMPT,
      prompt,
      cwd,
      errorMessage: 'Agent 执行失败',
      noResultMessage: '未收到 Agent 返回结果'
    })
    return result.resultText
  } catch (error) {
    if (error instanceof AgentRunnerError) {
      throw new Error(error.message)
    }

    throw error
  }
}

export async function askAgent(input: AskAgentInput): Promise<string> {
  const prompt = normalizePrompt(input.prompt)
  return runFreeFormAgent(prompt, input.cwd)
}
