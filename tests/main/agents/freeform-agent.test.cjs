const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const projectRoot = path.resolve(__dirname, '../../..')
const jiti = require('jiti')(path.join(projectRoot, 'tests/jiti-entry.js'))

const freeform = jiti(path.join(projectRoot, 'src/main/agents/freeform-agent.ts'))
const agentRunner = jiti(path.join(projectRoot, 'src/main/agents/agent-runner.ts'))
const prompts = jiti(path.join(projectRoot, 'src/main/agents/prompts.ts'))

test.afterEach(() => {
  freeform.resetRunAgentQueryForTest()
})

test('runFreeFormAgent forwards args and returns resultText', async () => {
  let capturedInput = null
  freeform.setRunAgentQueryForTest(async (input) => {
    capturedInput = input
    return {
      resultText: 'ok-result',
      conversations: [],
      sessionId: null
    }
  })

  const output = await freeform.runFreeFormAgent('hello', '/tmp/demo-cwd')

  assert.equal(output, 'ok-result')
  assert.deepEqual(capturedInput, {
    systemPrompt: prompts.FREEFORM_AGENT_SYSTEM_PROMPT,
    prompt: 'hello',
    cwd: '/tmp/demo-cwd',
    errorMessage: 'Agent 执行失败',
    noResultMessage: '未收到 Agent 返回结果'
  })
})

test('runFreeFormAgent rethrows AgentRunnerError as Error(message)', async () => {
  freeform.setRunAgentQueryForTest(async () => {
    throw new agentRunner.AgentRunnerError('runner failed', [], null)
  })

  await assert.rejects(() => freeform.runFreeFormAgent('hello'), (error) => {
    assert.ok(error instanceof Error)
    assert.equal(error.message, 'runner failed')
    assert.equal(error instanceof agentRunner.AgentRunnerError, false)
    return true
  })
})

test('askAgent trims prompt and validates empty input', async () => {
  let capturedPrompt = ''
  freeform.setRunAgentQueryForTest(async (input) => {
    capturedPrompt = input.prompt
    return {
      resultText: 'done',
      conversations: [],
      sessionId: null
    }
  })

  const ok = await freeform.askAgent({ prompt: '   need help   ' })
  assert.equal(ok, 'done')
  assert.equal(capturedPrompt, 'need help')

  await assert.rejects(() => freeform.askAgent({ prompt: '   ' }), /提示词不能为空/)
})

test('askAgent keeps cwd optional and passes it through', async () => {
  let capturedCwd
  freeform.setRunAgentQueryForTest(async (input) => {
    capturedCwd = input.cwd
    return {
      resultText: 'with-cwd',
      conversations: [],
      sessionId: null
    }
  })

  const cwd = path.dirname(pathToFileURL(__filename).pathname)
  const value = await freeform.askAgent({ prompt: 'x', cwd })
  assert.equal(value, 'with-cwd')
  assert.equal(capturedCwd, cwd)
})
