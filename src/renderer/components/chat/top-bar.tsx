import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { pickText } from '../../i18n'

interface TopBarProps {
  mode: 'mock' | 'real'
  onClear: () => void
}

export function TopBar({ mode, onClear }: TopBarProps) {
  return (
    <div className="flex items-center justify-between border-b bg-background/95 px-6 py-4 backdrop-blur">
      <div>
        <h1 className="text-lg font-semibold">Senior</h1>
        <p className="text-sm text-muted-foreground">{pickText('先用 mock 数据联调 UI，后续可切换 real IPC', 'Use mock data for UI integration first, then switch to real IPC.')}</p>
      </div>
      <div className="flex items-center gap-3">
        <Badge variant={mode === 'real' ? 'default' : 'secondary'}>{mode.toUpperCase()}</Badge>
        <Button variant="outline" size="sm" onClick={onClear}>
          {pickText('清空会话', 'Clear Chat')}
        </Button>
      </div>
    </div>
  )
}
