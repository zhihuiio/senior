import type { Project } from '../../../shared/types'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'
import { pickText } from '../../i18n'

interface ProjectPanelProps {
  projects: Project[]
  selectedProjectId: number | null
  loading: boolean
  error: string
  compact?: boolean
  onCreateProject: () => Promise<void>
  onSelectProject: (projectId: number) => void
  canOpenDirectoryDialog?: boolean
}

function getProjectLabel(path: string) {
  const text = path.trim()
  if (!text) {
    return pickText('未命名目录', 'Untitled Directory')
  }

  const normalized = text.replace(/\\/g, '/')
  const segments = normalized.split('/').filter(Boolean)
  return segments.length > 0 ? segments[segments.length - 1] : normalized
}

function getProjectShortName(path: string) {
  const label = getProjectLabel(path)
  return label.slice(0, 1).toUpperCase()
}

export function ProjectPanel({
  projects,
  selectedProjectId,
  loading,
  error,
  compact = false,
  onCreateProject,
  onSelectProject,
  canOpenDirectoryDialog = true
}: ProjectPanelProps) {
  return (
    <div className="space-y-3">
      <div className={cn('space-y-2 rounded-xl border bg-muted/20 p-3', compact ? 'p-2' : '')}>
        <div className="flex items-center justify-between gap-2">
          <p className={cn('text-xs font-medium text-muted-foreground', compact ? 'sr-only' : '')}>{pickText('项目目录', 'Project Directories')}</p>
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-2"
            onClick={() => void onCreateProject()}
            disabled={loading}
            title={
              canOpenDirectoryDialog
                ? pickText('选择本地目录', 'Select local directory')
                : pickText('当前环境不支持目录选择器，将改为手动输入路径', 'Directory picker is unavailable; switch to manual path input.')
            }
          >
            {loading ? '...' : '+'}
          </Button>
        </div>
      </div>

      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-600">{error}</p> : null}

      <div className="space-y-2">
        {projects.length === 0 ? (
          <p className={cn('rounded-md border border-dashed p-3 text-sm text-muted-foreground', compact ? 'text-center text-xs' : '')}>
            {pickText('暂无项目', 'No projects')}
          </p>
        ) : (
          projects.map((project) => {
            const selected = selectedProjectId === project.id
            const label = getProjectLabel(project.path)

            return (
              <button
                key={project.id}
                type="button"
                className={cn(
                  'group w-full rounded-lg border bg-background p-2 text-left transition-colors hover:bg-muted/40',
                  selected ? 'border-primary bg-primary/5' : ''
                )}
                onClick={() => onSelectProject(project.id)}
                title={project.path}
              >
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
                    {getProjectShortName(project.path)}
                  </span>
                  {!compact ? <p className="truncate text-sm font-medium">{label}</p> : null}
                </div>

                {!compact ? <p className="mt-1 truncate text-[11px] text-muted-foreground">{project.path}</p> : null}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
