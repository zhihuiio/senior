import type { AskRequest, AskResponse, AskService } from './ask-service'
import { pickText } from '../i18n'

const MOCK_REPLIES = [
  pickText('这是一个 mock 响应，你可以继续完善接口字段。', 'This is a mock response. You can continue refining interface fields.'),
  pickText('UI 已经接入 mock 服务，后续可一键切到 real 模式。', 'UI is connected to mock service. You can switch to real mode in one click later.'),
  pickText('这条数据来自本地模拟，适合先联调交互和状态。', 'This data comes from local simulation and is suitable for interaction/state integration.')
]

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export class MockAskService implements AskService {
  async ask(req: AskRequest): Promise<AskResponse> {
    const prompt = req.prompt.trim()
    if (!prompt) {
      throw new Error(pickText('提示词不能为空', 'Prompt cannot be empty'))
    }

    await sleep(600)

    if (prompt.toLowerCase().includes('mock-error')) {
      throw new Error(pickText('这是模拟错误：请检查输入或重试', 'This is a simulated error: please check input or retry'))
    }

    const picked = MOCK_REPLIES[Math.floor(Math.random() * MOCK_REPLIES.length)]
    return {
      text: `${picked}\n\n${pickText('你的输入', 'Your input')}: ${prompt}`
    }
  }
}
