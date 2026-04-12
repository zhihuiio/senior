import type { KeyboardEventHandler } from 'react'
import { Button } from '../ui/button'
import { Textarea } from '../ui/textarea'
import { pickText } from '../../i18n'

interface ComposerProps {
  prompt: string
  loading: boolean
  canSend: boolean
  onPromptChange: (next: string) => void
  onSend: () => void
}

export function Composer({ prompt, loading, canSend, onPromptChange, onSend }: ComposerProps) {
  const onKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      onSend()
    }
  }

  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <Textarea
        value={prompt}
        onChange={(event) => onPromptChange(event.target.value)}
        onKeyDown={onKeyDown}
        rows={4}
        placeholder={pickText('输入你的问题（Enter 发送，Shift+Enter 换行）', 'Enter your question (Enter to send, Shift+Enter for newline)')}
      />
      <div className="mt-3 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{pickText('提示：输入“mock-error”可触发模拟错误态。', 'Tip: enter "mock-error" to trigger simulated error state.')}</p>
        <Button onClick={onSend} disabled={!canSend}>
          {loading ? pickText('发送中...', 'Sending...') : pickText('发送', 'Send')}
        </Button>
      </div>
    </div>
  )
}
