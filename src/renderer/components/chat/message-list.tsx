import type { Message } from '../../../shared/types'
import { cn } from '../../lib/utils'
import { Card } from '../ui/card'
import { pickText } from '../../i18n'

interface MessageListProps {
  messages: Message[]
  loading: boolean
  error: string
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function MessageList({ messages, loading, error }: MessageListProps) {
  if (!messages.length) {
    return (
      <div className="flex h-full min-h-[320px] items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
        {pickText('还没有消息，输入提示词开始对话。', 'No messages yet. Enter a prompt to start chatting.')}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {messages.map((message) => {
        const isUser = message.role === 'user'
        return (
          <div key={message.id} className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
            <Card
              className={cn(
                'max-w-[78%] rounded-2xl px-4 py-3 shadow-sm',
                isUser ? 'bg-primary text-primary-foreground' : 'bg-card text-card-foreground'
              )}
            >
              <div className="whitespace-pre-wrap text-sm leading-6">{message.content}</div>
              <div className={cn('mt-2 text-xs', isUser ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
                {formatTime(message.createdAt)}
              </div>
            </Card>
          </div>
        )
      })}

      {loading ? <p className="text-sm text-muted-foreground">{pickText('助手正在思考中...', 'Assistant is thinking...')}</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  )
}
