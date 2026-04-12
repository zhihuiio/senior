import * as React from 'react'
import { cn } from '../../lib/utils'
import { pickText } from '../../i18n'

interface SidebarContextValue {
  collapsed: boolean
  toggleCollapsed: () => void
}

const SidebarContext = React.createContext<SidebarContextValue | null>(null)

function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (!context) {
    throw new Error('useSidebar must be used within SidebarProvider')
  }

  return context
}

interface SidebarProviderProps {
  children: React.ReactNode
  defaultCollapsed?: boolean
}

function SidebarProvider({ children, defaultCollapsed = false }: SidebarProviderProps) {
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed)

  const value = React.useMemo(
    () => ({
      collapsed,
      toggleCollapsed: () => setCollapsed((prev) => !prev)
    }),
    [collapsed]
  )

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
}

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> {
  collapsible?: boolean
}

function Sidebar({ className, collapsible = true, ...props }: SidebarProps) {
  const { collapsed } = useSidebar()

  return (
    <aside
      className={cn(
        'group/sidebar relative flex h-full flex-col border-r bg-background transition-all duration-200 ease-in-out',
        collapsible ? (collapsed ? 'w-16' : 'w-72') : 'w-72',
        className
      )}
      data-collapsed={collapsed ? 'true' : 'false'}
      {...props}
    />
  )
}

function SidebarHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center gap-2 border-b p-3', className)} {...props} />
}

function SidebarContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex-1 overflow-y-auto p-3', className)} {...props} />
}

function SidebarFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('border-t p-3', className)} {...props} />
}

function SidebarInset({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('min-h-screen flex-1 bg-muted/40', className)} {...props} />
}

interface SidebarTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label?: string
}

function SidebarTrigger({ className, label = pickText('切换侧栏', 'Toggle sidebar'), ...props }: SidebarTriggerProps) {
  const { toggleCollapsed } = useSidebar()

  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-md border bg-background text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        className
      )}
      onClick={toggleCollapsed}
      aria-label={label}
      {...props}
    >
      ≡
    </button>
  )
}

export {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarInset,
  SidebarTrigger,
  useSidebar
}
