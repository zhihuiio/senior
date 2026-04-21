import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import {
  Bot,
  ChevronDown,
  Clock3,
  FolderOpen,
  FolderPlus,
  LayoutGrid,
  LoaderCircle,
  PanelLeftClose,
  PenLine,
  Settings2,
  UserRound
} from 'lucide-react'
import seniorLogo from './assets/senior-logo.png'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { Select, SelectItem } from './components/ui/select'
import { Separator } from './components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from './components/ui/table'
import { Tabs, TabsList, TabsTrigger } from './components/ui/tabs'
import { Textarea } from './components/ui/textarea'
import { cn } from './lib/utils'
import { useProjectState } from './hooks/useProjectState'
import type { RequirementStatusFilter, TaskStatusFilter } from './hooks/useProjectState'
import { useI18n, pickText } from './i18n'
import { revealProjectInFinder } from './services/project-service'
import {
  getRequirementStageRunTrace,
  listRequirementArtifacts,
  listRequirementStageRuns,
  processRequirement as processRequirementService,
  readRequirementArtifact
} from './services/requirement-service'
import { getTaskStageRunTrace, listTaskArtifacts, listTaskStageRuns, readTaskArtifact } from './services/task-service'
import type { RequirementArtifactFile, TaskArtifactFile } from '../shared/ipc'
import type {
  AgentSdkType,
  Requirement,
  RequirementConversationMessage,
  RequirementStageRun,
  RequirementStatus,
  TaskAgentTraceMessage,
  Task,
  TaskStatus,
  TaskStageRun
} from '../shared/types'
import { getAppSettings, updateAppSettings } from './services/settings-service'

const STATUS_TABS: RequirementStatusFilter[] = ['pending', 'processing', 'queued', 'canceled']
const TASK_STATUS_OPTIONS: TaskStatusFilter[] = ['idle', 'running', 'waiting_human', 'done']
const DISCOVERY_CARDS = [
  {
    id: 'requirement-collector-runner',
    icon: '🧭',
    titleZh: '需求采集Runner',
    titleEn: 'Requirement Collector Runner',
    keywordZh: '需求采集',
    keywordEn: 'Requirement Collection'
  },
  {
    id: 'requirement-processor-runner',
    icon: '🧩',
    titleZh: '需求处理Runner',
    titleEn: 'Requirement Processor Runner',
    keywordZh: '需求处理',
    keywordEn: 'Requirement Processing'
  },
  {
    id: 'task-executor-runner',
    icon: '⚙️',
    titleZh: '任务执行Runner',
    titleEn: 'Task Executor Runner',
    keywordZh: '任务执行',
    keywordEn: 'Task Execution'
  }
] as const
const REQUIREMENT_PROCESSOR_RUNNER_ID = 'requirement-processor-runner' as const
const TASK_EXECUTOR_RUNNER_ID = 'task-executor-runner' as const
type DiscoveryCardId = (typeof DISCOVERY_CARDS)[number]['id']

function createInitialRunnerState(): Record<DiscoveryCardId, boolean> {
  return Object.fromEntries(DISCOVERY_CARDS.map((card) => [card.id, false])) as Record<DiscoveryCardId, boolean>
}

const ROWS_PER_PAGE_OPTIONS = [10, 20, 50]
const DETAIL_PANEL_WIDTH = 460
const SIDEBAR_DEFAULT_WIDTH = 290
const SIDEBAR_COLLAPSED_WIDTH = 88
const SIDEBAR_MIN_WIDTH = 220
const SIDEBAR_MIN_CONTENT_WIDTH = 760
const SIDEBAR_RESIZER_WIDTH = 6
const OVERLAY_DETAIL_BREAKPOINT = 1320

function getRequirementStatusLabel(status: RequirementStatus): string {
  if (status === 'pending') {
    return pickText('待处理', 'Pending')
  }
  if (status === 'evaluating') {
    return pickText('需求评估', 'Requirement Evaluation')
  }
  if (status === 'prd_designing') {
    return pickText('PRD设计', 'PRD Design')
  }
  if (status === 'prd_reviewing') {
    return pickText('PRD评审', 'PRD Review')
  }
  if (status === 'queued') {
    return pickText('已入队', 'Queued')
  }

  return pickText('已取消', 'Canceled')
}

function getTaskStatusLabel(status: TaskStatus): string {
  if (status === 'idle') {
    return pickText('空闲', 'Idle')
  }
  if (status === 'arch_designing') {
    return pickText('架构设计', 'Architecture Design')
  }
  if (status === 'tech_reviewing') {
    return pickText('技术评审', 'Technical Review')
  }
  if (status === 'waiting_human') {
    return pickText('等待人工', 'Waiting for Human')
  }
  if (status === 'coding') {
    return pickText('编码中', 'Coding')
  }
  if (status === 'qa_reviewing') {
    return pickText('QA/CR评审', 'QA/CR Review')
  }
  if (status === 'deploying') {
    return pickText('部署中', 'Deploying')
  }

  return pickText('已完成', 'Done')
}

function getRequirementStatusFilterLabel(status: RequirementStatusFilter): string {
  if (status === 'pending') {
    return pickText('待处理', 'Pending')
  }

  if (status === 'processing') {
    return pickText('处理中', 'Processing')
  }

  if (status === 'queued') {
    return pickText('已入队', 'Queued')
  }

  return pickText('已取消', 'Canceled')
}

function getTaskStatusFilterLabel(status: TaskStatusFilter): string {
  if (status === 'idle') {
    return pickText('空闲', 'Idle')
  }

  if (status === 'running') {
    return pickText('执行中', 'Running')
  }

  if (status === 'waiting_human') {
    return pickText('等待人工', 'Waiting Human')
  }

  return pickText('已完成', 'Done')
}

function getTaskStageLabel(status: TaskStatus): string {
  if (status === 'arch_designing') {
    return pickText('架构设计', 'Architecture Design')
  }
  if (status === 'tech_reviewing') {
    return pickText('技术评审', 'Technical Review')
  }
  if (status === 'coding') {
    return pickText('编码实现', 'Coding')
  }
  if (status === 'qa_reviewing') {
    return pickText('QA 评审', 'QA Review')
  }
  if (status === 'deploying') {
    return pickText('部署发布', 'Deploy & Release')
  }

  return status
}

function getRequirementStageLabel(stageKey: RequirementStageRun['stageKey']): string {
  if (stageKey === 'evaluating') {
    return pickText('需求评估', 'Requirement Evaluation')
  }
  if (stageKey === 'prd_designing') {
    return pickText('PRD 设计', 'PRD Design')
  }

  return pickText('PRD 评审', 'PRD Review')
}

function getDefaultRequirementArtifactFileName(stageKey: RequirementStageRun['stageKey']): string {
  if (stageKey === 'evaluating') {
    return 'evaluation.json'
  }
  if (stageKey === 'prd_designing') {
    return 'prd.md'
  }

  return 'prd_review.json'
}

interface TaskFlowCardItem {
  id: string
  stageRunId: number
  stageKey: TaskStatus
  stageLabel: string
  round: number
  startAt: number
  endAt: number | null
  resultStatus: 'pending' | 'running' | 'succeeded' | 'failed' | 'waiting_human'
  failureReason: string
  durationText: string
  artifactFiles: TaskArtifactFile[]
}

interface RequirementFlowCardItem {
  id: string
  stageRunId: number
  stageKey: RequirementStageRun['stageKey']
  stageLabel: string
  round: number
  startAt: number
  endAt: number | null
  resultStatus: 'pending' | 'running' | 'succeeded' | 'failed' | 'waiting_human'
  failureReason: string
  durationText: string
  agentSessionId: string | null
  artifactFiles: RequirementArtifactFile[]
}

interface OverviewMetricCard {
  id: string
  title: string
  value: string
  subtitle: string
}

interface StageFlowCardViewModel {
  id: string
  stageLabel: string
  resultStatus: 'pending' | 'running' | 'succeeded' | 'failed' | 'waiting_human'
  failureReason: string
  startAt: number
  endAt: number | null
  durationText: string
}

interface TaskStageTraceModalState {
  open: boolean
  stageRunId: number | null
  taskId: number | null
  humanMode: boolean
  stageLabel: string
  round: number
  loading: boolean
  error: string
  messages: TaskAgentTraceMessage[]
}

interface TaskTraceDetailModalState {
  open: boolean
  title: string
  subtitle: string
  content: string
}

interface TaskTraceDisplayItem {
  kind: 'message' | 'paired_tool'
  id: string
  message?: TaskAgentTraceMessage
  toolUse?: TaskAgentTraceMessage
  toolResult?: TaskAgentTraceMessage | null
}

function normalizeComparableText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function appendTaskHumanMessageIfMissing(messages: TaskAgentTraceMessage[], content: string): TaskAgentTraceMessage[] {
  const normalized = normalizeComparableText(content)
  if (!normalized) {
    return messages
  }

  const exists = messages.some((item) => item.role === 'user' && normalizeComparableText(item.content) === normalized)
  if (exists) {
    return messages
  }

  return [
    ...messages,
    {
      id: `local-user-${Date.now()}`,
      role: 'user',
      messageType: 'text',
      content: normalized
    }
  ]
}

function mergeTaskHumanMessages(
  prev: TaskAgentTraceMessage[],
  incoming: TaskAgentTraceMessage[],
  options?: { ensureInput?: string }
): TaskAgentTraceMessage[] {
  const nextById = new Map<string, TaskAgentTraceMessage>()
  const nextOrder: string[] = []

  const push = (item: TaskAgentTraceMessage) => {
    const id = item.id?.trim()
    if (id) {
      if (!nextById.has(id)) {
        nextOrder.push(id)
      }
      nextById.set(id, item)
      return
    }

    const key = `${item.role}:${item.messageType ?? ''}:${normalizeComparableText(item.content)}`
    if (!nextById.has(key)) {
      nextOrder.push(key)
    }
    nextById.set(key, item)
  }

  for (const item of prev) {
    push(item)
  }
  for (const item of incoming) {
    push(item)
  }

  let merged = nextOrder.map((id) => nextById.get(id)!).filter(Boolean)
  const confirmedUserContents = new Set(
    merged
      .filter((item) => item.role === 'user' && !item.id.startsWith('local-user-'))
      .map((item) => normalizeComparableText(item.content))
      .filter(Boolean)
  )
  if (confirmedUserContents.size > 0) {
    merged = merged.filter((item) => {
      if (item.role !== 'user' || !item.id.startsWith('local-user-')) {
        return true
      }

      return !confirmedUserContents.has(normalizeComparableText(item.content))
    })
  }

  if (options?.ensureInput) {
    merged = appendTaskHumanMessageIfMissing(merged, options.ensureInput)
  }

  return merged
}

function countAssistantMessages(messages: TaskAgentTraceMessage[]): number {
  return messages.filter((item) => item.role === 'assistant').length
}

interface RequirementStageTraceModalState {
  open: boolean
  stageRunId: number | null
  requirementId: number | null
  agentSessionId: string | null
  humanMode: boolean
  stageLabel: string
  round: number
  loading: boolean
  error: string
  messages: TaskAgentTraceMessage[]
}

function getTaskTraceRoleLabel(role: TaskAgentTraceMessage['role']): string {
  if (role === 'user') {
    return 'User'
  }
  if (role === 'assistant') {
    return 'Assistant'
  }
  if (role === 'tool') {
    return 'Tool'
  }

  return 'System'
}

function getTaskTraceTypeLabel(type?: string): string {
  const text = (type || '').trim()
  if (!text) {
    return 'unknown'
  }

  return text
}

function safeJsonParse(value: string): unknown | null {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function parseJsonFromMixedText(value: string): unknown | null {
  const text = value.trim()
  if (!text) {
    return null
  }

  const direct = safeJsonParse(text)
  if (direct !== null) {
    return direct
  }

  const objectStart = text.indexOf('{')
  const objectEnd = text.lastIndexOf('}')
  if (objectStart >= 0 && objectEnd > objectStart) {
    const objectParsed = safeJsonParse(text.slice(objectStart, objectEnd + 1))
    if (objectParsed !== null) {
      return objectParsed
    }
  }

  const arrayStart = text.indexOf('[')
  const arrayEnd = text.lastIndexOf(']')
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    const arrayParsed = safeJsonParse(text.slice(arrayStart, arrayEnd + 1))
    if (arrayParsed !== null) {
      return arrayParsed
    }
  }

  return null
}

function ellipsis(text: string, max = 180): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= max) {
    return normalized
  }

  return `${normalized.slice(0, max)}...`
}

interface TodoWriteItem {
  content: string
  status: string
}

function extractTodoWriteItems(value: unknown): TodoWriteItem[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((todo) => {
      if (!todo || typeof todo !== 'object' || Array.isArray(todo)) {
        return null
      }
      const todoRecord = todo as Record<string, unknown>
      const content = typeof todoRecord.content === 'string' ? todoRecord.content.trim() : ''
      const status = typeof todoRecord.status === 'string' ? todoRecord.status.trim().toLowerCase() : 'pending'
      if (!content) {
        return null
      }

      return {
        content,
        status
      } as TodoWriteItem
    })
    .filter((item): item is TodoWriteItem => Boolean(item))
}

function parseTodoWriteItems(message: TaskAgentTraceMessage): TodoWriteItem[] {
  const toolName = message.toolName?.trim()
  if (!toolName || toolName.toLowerCase() !== 'todowrite') {
    return []
  }

  const parsed = parseJsonFromMixedText(message.content)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return []
  }

  const record = parsed as Record<string, unknown>
  return extractTodoWriteItems(record.todos)
}

function getTodoStatusMeta(status: string): { label: string; badgeClassName: string; rowClassName: string } {
  if (status === 'completed' || status === 'done') {
    return {
      label: pickText('已完成', 'Done'),
      badgeClassName: 'bg-emerald-100 text-emerald-800',
      rowClassName: 'border-emerald-200 bg-emerald-50/70 text-emerald-900'
    }
  }

  if (status === 'in_progress' || status === 'running' || status === 'doing') {
    return {
      label: pickText('进行中', 'In Progress'),
      badgeClassName: 'bg-sky-100 text-sky-800',
      rowClassName: 'border-sky-200 bg-sky-50/70 text-sky-900'
    }
  }

  return {
    label: pickText('待办', 'Todo'),
    badgeClassName: 'bg-slate-100 text-slate-700',
    rowClassName: 'border-slate-200 bg-white text-slate-800'
  }
}

function summarizeToolUse(message: TaskAgentTraceMessage): string {
  if (message.messageType !== 'tool_use') {
    return message.content
  }

  const parsed = safeJsonParse(message.content)
  const toolName = message.toolName?.trim() || 'tool'
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>
    const command = typeof record.command === 'string' ? record.command.trim() : ''
    const filePath = typeof record.file_path === 'string' ? record.file_path.trim() : ''
    const pattern = typeof record.pattern === 'string' ? record.pattern.trim() : ''
    const query = typeof record.q === 'string' ? record.q.trim() : ''
    const target = command || filePath || pattern || query
    if (target) {
      return `[${toolName}] ${ellipsis(target, 200)}`
    }
  }

  const raw = message.content.trim()
  const duplicatedPrefix = `[${toolName}]`
  const normalizedRaw = raw.startsWith(duplicatedPrefix) ? raw.slice(duplicatedPrefix.length).trim() : raw
  return ellipsis(normalizedRaw, 220)
}

function summarizeToolResult(message: TaskAgentTraceMessage | null | undefined): string {
  if (!message) {
    return pickText('执行中...', 'Running...')
  }

  const failed = message.isError === true || message.role === 'system'
  if (message.messageType !== 'tool_result') {
    return ellipsis(message.content, 160)
  }

  const text = message.content.trim().replace(/^工具执行失败:\s*/u, '')
  if (!text) {
    return failed ? pickText('执行失败（无错误详情）', 'Failed (no error details)') : pickText('执行完成', 'Completed')
  }

  return ellipsis(text, 160)
}

function buildTaskTraceDisplayItems(messages: TaskAgentTraceMessage[]): TaskTraceDisplayItem[] {
  const pending = new Map<string, TaskAgentTraceMessage[]>()
  const usedResultIds = new Set<string>()

  for (const message of messages) {
    if (message.messageType !== 'tool_result') {
      continue
    }
    const key = message.toolCallId?.trim()
    if (!key) {
      continue
    }

    const queue = pending.get(key) ?? []
    queue.push(message)
    pending.set(key, queue)
  }

  const items: TaskTraceDisplayItem[] = []

  for (const message of messages) {
    if (message.messageType === 'tool_use') {
      const key = message.toolCallId?.trim()
      const queue = key ? pending.get(key) : undefined
      const paired = queue && queue.length > 0 ? queue.shift() ?? null : null
      if (paired) {
        usedResultIds.add(paired.id)
      }

      items.push({
        kind: 'paired_tool',
        id: `pair-${message.id}`,
        toolUse: message,
        toolResult: paired
      })
      continue
    }

    if (message.messageType === 'tool_result' && usedResultIds.has(message.id)) {
      continue
    }

    items.push({
      kind: 'message',
      id: `msg-${message.id}`,
      message
    })
  }

  return items
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleString(pickText('zh-CN', 'en-US'), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatDurationMs(durationMs: number): string {
  const safe = Math.max(0, durationMs)
  const totalSeconds = Math.floor(safe / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return pickText(
      `${hours}小时${String(minutes).padStart(2, '0')}分${String(seconds).padStart(2, '0')}秒`,
      `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`
    )
  }

  if (minutes > 0) {
    return pickText(`${minutes}分${String(seconds).padStart(2, '0')}秒`, `${minutes}m ${String(seconds).padStart(2, '0')}s`)
  }

  return pickText(`${seconds}秒`, `${seconds}s`)
}

function getStageRunDurationMs(
  input: { startAt: number; endAt: number | null; updatedAt: number; resultStatus: 'pending' | 'running' | 'succeeded' | 'failed' | 'waiting_human' },
  nowMs: number
): number {
  const startAt = Number.isFinite(input.startAt) ? input.startAt : 0
  if (startAt <= 0) {
    return 0
  }

  const effectiveEndAt = input.endAt ?? (input.resultStatus === 'running' ? nowMs : input.updatedAt)
  return Math.max(0, effectiveEndAt - startAt)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function getSidebarMaxWidth(viewportWidth: number) {
  return Math.max(SIDEBAR_MIN_WIDTH, viewportWidth - SIDEBAR_MIN_CONTENT_WIDTH - SIDEBAR_RESIZER_WIDTH)
}

function getProjectLabel(path: string) {
  const text = path.trim()
  if (!text) {
    return pickText('目录', 'Directory')
  }

  const normalized = text.replace(/\\/g, '/')
  const segments = normalized.split('/').filter(Boolean)
  return segments.length > 0 ? segments[segments.length - 1] : normalized
}

function getStatusBadgeClass(status: RequirementStatus | TaskStatus) {
  if (status === 'queued' || status === 'done') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  }

  if (status === 'canceled') {
    return 'border-rose-200 bg-rose-50 text-rose-700'
  }

  if (status === 'prd_designing' || status === 'arch_designing' || status === 'coding' || status === 'deploying') {
    return 'border-blue-200 bg-blue-50 text-blue-700'
  }

  if (status === 'evaluating' || status === 'prd_reviewing' || status === 'tech_reviewing' || status === 'qa_reviewing' || status === 'waiting_human') {
    return 'border-amber-200 bg-amber-50 text-amber-700'
  }

  return 'border-slate-200 bg-slate-100 text-slate-700'
}

type ClarifyChatMessage = RequirementConversationMessage

function parseStandardizedAcceptContent(standardized: string): { title: string; content: string } | null {
  const text = standardized.trim()
  if (!text) {
    return null
  }

  try {
    const parsed = JSON.parse(text) as { title?: unknown; content?: unknown }
    const title = typeof parsed.title === 'string' ? parsed.title.trim() : ''
    const content = typeof parsed.content === 'string' ? parsed.content.trim() : ''

    if (!title && !content) {
      return null
    }

    return { title, content }
  } catch {
    return null
  }
}

interface JsonFieldLine {
  path: string
  value: string
}

function formatJsonValue(value: unknown): string {
  if (value === null) {
    return 'null'
  }

  if (value === undefined) {
    return 'undefined'
  }

  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }

  return JSON.stringify(value)
}

function flattenJsonFields(value: unknown, basePath = ''): JsonFieldLine[] {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [{ path: basePath || '(root)', value: '[]' }]
    }

    return value.flatMap((item, index) => {
      const nextPath = basePath ? `${basePath}[${index}]` : `[${index}]`
      return flattenJsonFields(item, nextPath)
    })
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) {
      return [{ path: basePath || '(root)', value: '{}' }]
    }

    return entries.flatMap(([key, child]) => {
      const nextPath = basePath ? `${basePath}.${key}` : key
      return flattenJsonFields(child, nextPath)
    })
  }

  return [{ path: basePath || '(root)', value: formatJsonValue(value) }]
}

type AssistantDisplayPayload =
  | { kind: 'text'; text: string }
  | { kind: 'accept'; title: string; content: string }
  | { kind: 'review'; result: 'pass' | 'fail'; summary: string }

function parseAssistantDisplayPayload(content: string): AssistantDisplayPayload | null {
  const text = content.trim()
  if (!text) {
    return null
  }

  const candidates: string[] = [text]
  const block = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (block?.[1]) {
    candidates.push(block[1].trim())
  }

  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) {
    candidates.push(text.slice(start, end + 1))
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as { type?: unknown; question?: unknown; standardized?: unknown; prd?: unknown; result?: unknown; summary?: unknown }
      if (parsed.type === 'clarify' && typeof parsed.question === 'string' && parsed.question.trim()) {
        return { kind: 'text', text: parsed.question.trim() }
      }

      if (parsed.type === 'accept') {
        const standardizedRaw =
          typeof parsed.standardized === 'string'
            ? parsed.standardized
            : parsed.standardized && typeof parsed.standardized === 'object'
              ? JSON.stringify(parsed.standardized)
              : ''

        const standardized = parseStandardizedAcceptContent(standardizedRaw)
        if (standardized) {
          const title = standardized.title.trim()
          const contentText = standardized.content.trim()
          return {
            kind: 'accept',
            title,
            content: contentText
          }
        }
      }

      if (parsed.type === 'prd' && typeof parsed.prd === 'string' && parsed.prd.trim()) {
        return {
          kind: 'accept',
          title: 'PRD',
          content: parsed.prd.trim()
        }
      }

      if (parsed.type === 'review' && (parsed.result === 'pass' || parsed.result === 'fail')) {
        return {
          kind: 'review',
          result: parsed.result,
          summary: typeof parsed.summary === 'string' ? parsed.summary : ''
        }
      }
    } catch {
      // ignore parse error and continue
    }
  }

  return null
}

function renderConversationMessageContent(message: ClarifyChatMessage): ReactNode {
  if (message.role !== 'assistant') {
    return message.content
  }

  const payload = parseAssistantDisplayPayload(message.content)
  if (!payload) {
    return message.content
  }

  if (payload.kind === 'text') {
    return payload.text
  }

  if (payload.kind === 'review') {
    return (
      <div className="space-y-1">
        <p className="font-semibold text-slate-900">{pickText('评审', 'Review')}: {payload.result}</p>
        <p className="text-slate-700">{payload.summary}</p>
      </div>
    )
  }

  if (!payload.title && !payload.content) {
    return message.content
  }

  return (
    <div className="space-y-1">
      {payload.title ? <p className="font-semibold text-slate-900">{payload.title}</p> : null}
      {payload.content ? <p className="text-slate-700">{payload.content}</p> : null}
    </div>
  )
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const tokenRegex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g
  const tokens = text.split(tokenRegex).filter(Boolean)

  return tokens.map((token, index) => {
    const key = `${keyPrefix}-${index}`

    if (token.startsWith('`') && token.endsWith('`')) {
      return (
        <code key={key} className="rounded bg-slate-100 px-1 py-0.5 text-[0.92em] text-slate-800">
          {token.slice(1, -1)}
        </code>
      )
    }

    if (token.startsWith('**') && token.endsWith('**')) {
      return (
        <strong key={key} className="font-semibold text-slate-900">
          {token.slice(2, -2)}
        </strong>
      )
    }

    if (token.startsWith('*') && token.endsWith('*')) {
      return (
        <em key={key} className="italic text-slate-800">
          {token.slice(1, -1)}
        </em>
      )
    }

    const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (linkMatch) {
      return (
        <a
          key={key}
          href={linkMatch[2]}
          target="_blank"
          rel="noreferrer"
          className="text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-800"
        >
          {linkMatch[1]}
        </a>
      )
    }

    return <span key={key}>{token}</span>
  })
}

function renderMarkdown(content: string): ReactNode[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let index = 0
  let blockKey = 0

  const isSpecialStart = (line: string): boolean => {
    return (
      /^#{1,6}\s+/.test(line) ||
      /^```/.test(line) ||
      /^[-*+]\s+/.test(line) ||
      /^\d+\.\s+/.test(line) ||
      /^>\s?/.test(line)
    )
  }

  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (!line.trim()) {
      index += 1
      continue
    }

    if (/^```/.test(line)) {
      const language = line.replace(/^```/, '').trim()
      const codeLines: string[] = []
      index += 1
      while (index < lines.length && !/^```/.test(lines[index] ?? '')) {
        codeLines.push(lines[index] ?? '')
        index += 1
      }
      if (index < lines.length) {
        index += 1
      }

      blocks.push(
        <div key={`md-${blockKey++}`} className="overflow-hidden rounded-lg border border-slate-200 bg-slate-950/95">
          {language ? <p className="border-b border-slate-800 px-3 py-1.5 text-[11px] text-slate-300">{language}</p> : null}
          <pre className="max-h-[56vh] overflow-auto p-3 text-xs text-slate-100">
            <code>{codeLines.join('\n')}</code>
          </pre>
        </div>
      )
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      const level = heading[1].length
      const text = heading[2]
      const headingClass = level <= 2 ? 'text-xl font-semibold' : level === 3 ? 'text-lg font-semibold' : 'text-base font-semibold'
      blocks.push(
        <p key={`md-${blockKey++}`} className={cn(headingClass, 'text-slate-900')}>
          {renderInlineMarkdown(text, `heading-${blockKey}`)}
        </p>
      )
      index += 1
      continue
    }

    if (/^[-*+]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^[-*+]\s+/.test(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(/^[-*+]\s+/, ''))
        index += 1
      }
      blocks.push(
        <ul key={`md-${blockKey++}`} className="list-disc space-y-1 pl-5 text-sm text-slate-800">
          {items.map((item, itemIndex) => (
            <li key={`li-${itemIndex}`}>{renderInlineMarkdown(item, `ul-${blockKey}-${itemIndex}`)}</li>
          ))}
        </ul>
      )
      continue
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\d+\.\s+/.test(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(/^\d+\.\s+/, ''))
        index += 1
      }
      blocks.push(
        <ol key={`md-${blockKey++}`} className="list-decimal space-y-1 pl-5 text-sm text-slate-800">
          {items.map((item, itemIndex) => (
            <li key={`li-${itemIndex}`}>{renderInlineMarkdown(item, `ol-${blockKey}-${itemIndex}`)}</li>
          ))}
        </ol>
      )
      continue
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = []
      while (index < lines.length && /^>\s?/.test(lines[index] ?? '')) {
        quoteLines.push((lines[index] ?? '').replace(/^>\s?/, ''))
        index += 1
      }
      blocks.push(
        <blockquote key={`md-${blockKey++}`} className="border-l-4 border-sky-200 bg-sky-50/70 px-3 py-2 text-sm text-slate-700">
          {quoteLines.join('\n')}
        </blockquote>
      )
      continue
    }

    const paragraphLines: string[] = []
    while (index < lines.length && lines[index]?.trim() && !isSpecialStart(lines[index] ?? '')) {
      paragraphLines.push(lines[index] ?? '')
      index += 1
    }
    blocks.push(
      <p key={`md-${blockKey++}`} className="text-sm leading-6 text-slate-800">
        {paragraphLines.map((paragraphLine, lineIndex) => (
          <span key={`line-${lineIndex}`}>
            {renderInlineMarkdown(paragraphLine, `p-${blockKey}-${lineIndex}`)}
            {lineIndex < paragraphLines.length - 1 ? <br /> : null}
          </span>
        ))}
      </p>
    )
  }

  return blocks
}

function StageFlowList({
  cards,
  onViewDetail,
  renderExtra
}: {
  cards: StageFlowCardViewModel[]
  onViewDetail?: (cardId: string, resultStatus: StageFlowCardViewModel['resultStatus']) => void
  renderExtra?: (cardId: string) => ReactNode
}) {
  return (
    <div className="space-y-2 rounded-xl border border-slate-200/90 bg-gradient-to-b from-slate-50 to-white p-4 shadow-sm">
      {cards.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-white/70 px-3 py-2 text-xs text-slate-500">
          {pickText('暂无阶段记录', 'No stage records yet')}
        </div>
      ) : (
        cards.map((card, index) => {
          const waitingHuman = card.resultStatus === 'waiting_human'
          const running = card.endAt === null && !waitingHuman
          const failed = card.resultStatus === 'failed'
          const succeeded = !running && !failed && !waitingHuman
          return (
            <div
              key={card.id}
              className={cn(
                'flex gap-3 rounded-lg border px-2.5 py-2 transition-colors',
                running
                  ? 'border-sky-200 bg-sky-50/70'
                  : waitingHuman
                    ? 'border-amber-200 bg-amber-50/70'
                    : failed
                      ? 'border-red-200 bg-red-50/70'
                      : 'border-emerald-200 bg-emerald-50/60'
              )}
            >
              <div className="flex w-5 flex-col items-center">
                <span
                  className={cn(
                    'mt-1 inline-block h-4 w-4 rounded-full border shadow-sm',
                    running
                      ? 'animate-pulse border-sky-500 bg-sky-500'
                      : waitingHuman
                        ? 'border-amber-500 bg-amber-500'
                        : failed
                          ? 'border-red-500 bg-red-500'
                          : 'border-emerald-500 bg-emerald-500'
                  )}
                />
                {index < cards.length - 1 ? (
                  <span
                    className={cn(
                      'mt-1 h-8 w-px',
                      running ? 'bg-sky-300' : waitingHuman ? 'bg-amber-300' : failed ? 'bg-red-300' : 'bg-emerald-300'
                    )}
                  />
                ) : null}
              </div>
              <div className="min-w-0 flex-1 pb-1">
                <p className="text-sm font-medium text-slate-900">{card.stageLabel}</p>
                <p className="mt-1 text-xs text-slate-600">
                  {pickText('阶段结果', 'Stage result')}:
                  {running
                    ? pickText('进行中', 'Running')
                    : waitingHuman
                      ? pickText('等待人工', 'Waiting for human')
                      : succeeded
                        ? pickText('已完成', 'Completed')
                        : pickText('失败', 'Failed')}
                </p>
                {waitingHuman ? <p className="mt-1 text-xs text-amber-700">{pickText('待处理原因', 'Pending reason')}: {card.failureReason || pickText('未提供', 'N/A')}</p> : null}
                {failed ? <p className="mt-1 text-xs text-red-700">{pickText('失败原因', 'Failure reason')}: {card.failureReason || pickText('未提供', 'N/A')}</p> : null}
                <p className="mt-1 text-xs text-slate-600">{pickText('开始时间', 'Start time')}: {formatTime(card.startAt)}</p>
                <p className="mt-1 text-xs text-slate-600">
                  {pickText('结束时间', 'End time')}:
                  {card.endAt
                    ? formatTime(card.endAt)
                    : waitingHuman
                      ? pickText('等待人工中', 'Waiting for human')
                      : pickText('进行中', 'Running')}
                </p>
                <p className="mt-1 text-xs text-slate-600">{pickText('运行时长', 'Duration')}: {card.durationText}</p>
                {renderExtra ? renderExtra(card.id) : null}
                {onViewDetail ? (
                  <div className="mt-2">
                    {(() => {
                      const isWaitingHuman = card.resultStatus === 'waiting_human'
                      return (
                        <Button
                          size="sm"
                          variant="outline"
                          className={cn(
                            'h-7 rounded-md bg-white px-2.5 text-xs hover:bg-slate-50',
                            isWaitingHuman
                              ? 'border-amber-200 text-amber-700 hover:bg-amber-50'
                              : 'border-slate-200 text-slate-700'
                          )}
                          onClick={() => onViewDetail(card.id, card.resultStatus)}
                        >
                          {isWaitingHuman ? pickText('人工处理', 'Human handling') : pickText('查看详情', 'View details')}
                        </Button>
                      )
                    })()}
                  </div>
                ) : null}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}

function isTaskInWaitingHumanGate(waitingContext: Task['waitingContext']): boolean {
  return waitingContext === 'arch_design_gate' || waitingContext === 'coding_gate'
}

interface WorkspaceProps {
  projects: ReturnType<typeof useProjectState>['projects']
  requirements: ReturnType<typeof useProjectState>['requirements']
  filteredRequirements: ReturnType<typeof useProjectState>['filteredRequirements']
  filteredTasks: ReturnType<typeof useProjectState>['filteredTasks']
  projectTasks: ReturnType<typeof useProjectState>['projectTasks']
  selectedProjectId: number | null
  selectedRequirement: ReturnType<typeof useProjectState>['selectedRequirement']
  activeListType: ReturnType<typeof useProjectState>['activeListType']
  requirementStatusFilter: RequirementStatusFilter
  taskStatusFilter: TaskStatusFilter
  tasksForSelectedRequirement: ReturnType<typeof useProjectState>['tasksForSelectedRequirement']
  loading: boolean
  error: string
  addProject: ReturnType<typeof useProjectState>['addProject']
  selectProject: ReturnType<typeof useProjectState>['selectProject']
  setActiveListType: ReturnType<typeof useProjectState>['setActiveListType']
  setStatusFilter: ReturnType<typeof useProjectState>['setStatusFilter']
  setTaskFilter: ReturnType<typeof useProjectState>['setTaskFilter']
  selectRequirement: ReturnType<typeof useProjectState>['selectRequirement']
  createRequirementPending: ReturnType<typeof useProjectState>['createRequirementPending']
  createTaskItem: ReturnType<typeof useProjectState>['createTaskItem']
  clarifyRequirement: ReturnType<typeof useProjectState>['clarifyRequirement']
  loadRequirementConversation: ReturnType<typeof useProjectState>['loadRequirementConversation']
  getClarifyMessages: ReturnType<typeof useProjectState>['getClarifyMessages']
  clearClarifyMessages: ReturnType<typeof useProjectState>['clearClarifyMessages']
  saveRequirement: ReturnType<typeof useProjectState>['saveRequirement']
  applyTaskCommand: ReturnType<typeof useProjectState>['applyTaskCommand']
  loadTaskHumanConversation: ReturnType<typeof useProjectState>['loadTaskHumanConversation']
  sendTaskHumanConversation: ReturnType<typeof useProjectState>['sendTaskHumanConversation']
  autoProcessorRunning: ReturnType<typeof useProjectState>['autoProcessorRunning']
  autoProcessorStartedAt: ReturnType<typeof useProjectState>['autoProcessorStartedAt']
  autoProcessorLoading: ReturnType<typeof useProjectState>['autoProcessorLoading']
  toggleAutoProcessor: ReturnType<typeof useProjectState>['toggleAutoProcessor']
  taskAutoProcessorRunning: ReturnType<typeof useProjectState>['taskAutoProcessorRunning']
  taskAutoProcessorStartedAt: ReturnType<typeof useProjectState>['taskAutoProcessorStartedAt']
  taskAutoProcessorLoading: ReturnType<typeof useProjectState>['taskAutoProcessorLoading']
  toggleTaskProcessor: ReturnType<typeof useProjectState>['toggleTaskProcessor']
}

function Workspace({
  projects,
  requirements,
  filteredRequirements,
  filteredTasks,
  projectTasks,
  selectedProjectId,
  selectedRequirement,
  activeListType,
  requirementStatusFilter,
  taskStatusFilter,
  tasksForSelectedRequirement,
  loading,
  error,
  addProject,
  selectProject,
  setActiveListType,
  setStatusFilter,
  setTaskFilter,
  selectRequirement,
  createRequirementPending,
  createTaskItem,
  clarifyRequirement,
  loadRequirementConversation,
  getClarifyMessages,
  clearClarifyMessages,
  saveRequirement,
  applyTaskCommand,
  loadTaskHumanConversation,
  sendTaskHumanConversation,
  autoProcessorRunning,
  autoProcessorStartedAt,
  autoProcessorLoading,
  toggleAutoProcessor,
  taskAutoProcessorRunning,
  taskAutoProcessorStartedAt,
  taskAutoProcessorLoading,
  toggleTaskProcessor
}: WorkspaceProps) {
  const { language, setLanguage, t } = useI18n()
  const canOpenDirectoryDialog = Boolean(window.api && typeof window.api.selectDirectory === 'function')
  const [isDetailVisible, setIsDetailVisible] = useState(false)
  const [queueKeyword, setQueueKeyword] = useState('')
  const [isCreateRequirementDialogOpen, setIsCreateRequirementDialogOpen] = useState(false)
  const [newRequirementContent, setNewRequirementContent] = useState('')
  const [createRequirementProjectId, setCreateRequirementProjectId] = useState<number | null>(null)
  const [isCreateTaskDialogOpen, setIsCreateTaskDialogOpen] = useState(false)
  const [newTaskContent, setNewTaskContent] = useState('')
  const [createTaskProjectId, setCreateTaskProjectId] = useState<number | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarExpandedWidth, setSidebarExpandedWidth] = useState(SIDEBAR_DEFAULT_WIDTH)
  const [isSidebarResizing, setIsSidebarResizing] = useState(false)
  const [freezeSidebarTransition, setFreezeSidebarTransition] = useState(false)
  const [rowsPerPage, setRowsPerPage] = useState(10)
  const [currentPage, setCurrentPage] = useState(1)
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  const [clarifyRequirementId, setClarifyRequirementId] = useState<number | null>(null)
  const [clarifyDialogMode, setClarifyDialogMode] = useState<'clarify' | 'detail'>('clarify')
  const [clarifyDialogSessionId, setClarifyDialogSessionId] = useState<string | undefined>(undefined)
  const [clarifyInput, setClarifyInput] = useState('')
  const [clarifyDialogRefreshSeq, setClarifyDialogRefreshSeq] = useState(0)
  const [clarifyConversationPending, setClarifyConversationPending] = useState(false)
  const [clarifyLoadingVisible, setClarifyLoadingVisible] = useState(false)
  const [runnerEnabledById, setRunnerEnabledById] = useState<Record<DiscoveryCardId, boolean>>(() => createInitialRunnerState())
  const [taskDurationNowMs, setTaskDurationNowMs] = useState(() => Date.now())
  const [requirementDurationNowMs, setRequirementDurationNowMs] = useState(() => Date.now())
  const [runnerDurationNowMs, setRunnerDurationNowMs] = useState(() => Date.now())
  const [activeMainTab, setActiveMainTab] = useState<'collector' | 'workspace' | 'overview' | 'settings'>('workspace')
  const [agentSdkType, setAgentSdkType] = useState<AgentSdkType>('claude')
  const [agentSdkLoading, setAgentSdkLoading] = useState(false)
  const [agentSdkError, setAgentSdkError] = useState('')
  const [activeTaskId, setActiveTaskId] = useState<number | null>(null)
  const [projectContextMenu, setProjectContextMenu] = useState<{ projectPath: string; x: number; y: number } | null>(null)
  const [taskArtifactsByTaskId, setTaskArtifactsByTaskId] = useState<Record<number, TaskArtifactFile[]>>({})
  const [taskStageRunsByTaskId, setTaskStageRunsByTaskId] = useState<Record<number, TaskStageRun[]>>({})
  const [requirementArtifactsByRequirementId, setRequirementArtifactsByRequirementId] = useState<Record<number, RequirementArtifactFile[]>>({})
  const [requirementStageRunsByRequirementId, setRequirementStageRunsByRequirementId] = useState<Record<number, RequirementStageRun[]>>({})
  const [overviewTaskStageRunsByTaskId, setOverviewTaskStageRunsByTaskId] = useState<Record<number, TaskStageRun[]>>({})
  const [overviewRequirementStageRunsByRequirementId, setOverviewRequirementStageRunsByRequirementId] = useState<Record<number, RequirementStageRun[]>>({})
  const [overviewDurationNowMs, setOverviewDurationNowMs] = useState(() => Date.now())
  const [artifactModalOpen, setArtifactModalOpen] = useState(false)
  const [artifactModalFileName, setArtifactModalFileName] = useState('')
  const [artifactModalContent, setArtifactModalContent] = useState('')
  const [artifactModalLoading, setArtifactModalLoading] = useState(false)
  const [artifactModalError, setArtifactModalError] = useState('')
  const clarifyMessagesContainerRef = useRef<HTMLDivElement | null>(null)
  const taskStageTraceMessagesContainerRef = useRef<HTMLDivElement | null>(null)
  const taskHumanInputRef = useRef<HTMLTextAreaElement | null>(null)
  const requirementStageTraceMessagesContainerRef = useRef<HTMLDivElement | null>(null)
  const requirementHumanInputRef = useRef<HTMLTextAreaElement | null>(null)
  const sidebarResizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const sidebarTransitionEnableRafRef = useRef<number | null>(null)
  const [taskStageTraceModal, setTaskStageTraceModal] = useState<TaskStageTraceModalState>({
    open: false,
    stageRunId: null,
    taskId: null,
    humanMode: false,
    stageLabel: '',
    round: 1,
    loading: false,
    error: '',
    messages: []
  })
  const [requirementStageTraceModal, setRequirementStageTraceModal] = useState<RequirementStageTraceModalState>({
    open: false,
    stageRunId: null,
    requirementId: null,
    agentSessionId: null,
    humanMode: false,
    stageLabel: '',
    round: 1,
    loading: false,
    error: '',
    messages: []
  })
  const [taskTraceDetailModal, setTaskTraceDetailModal] = useState<TaskTraceDetailModalState>({
    open: false,
    title: '',
    subtitle: '',
    content: ''
  })
  const [taskHumanMessagesByTaskId, setTaskHumanMessagesByTaskId] = useState<Record<number, TaskAgentTraceMessage[]>>({})
  const [taskHumanInput, setTaskHumanInput] = useState('')
  const [taskHumanConversationLoading, setTaskHumanConversationLoading] = useState(false)
  const [taskHumanConversationError, setTaskHumanConversationError] = useState('')
  const [taskHumanAwaitingAssistant, setTaskHumanAwaitingAssistant] = useState<{ taskId: number; baselineAssistantCount: number } | null>(null)
  const [requirementHumanMessagesByRequirementId, setRequirementHumanMessagesByRequirementId] = useState<Record<number, TaskAgentTraceMessage[]>>({})
  const [requirementHumanInput, setRequirementHumanInput] = useState('')
  const [requirementHumanConversationLoading, setRequirementHumanConversationLoading] = useState(false)
  const [requirementHumanConversationError, setRequirementHumanConversationError] = useState('')
  const [requirementHumanAwaitingAssistant, setRequirementHumanAwaitingAssistant] = useState<{ requirementId: number; baselineAssistantCount: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    setAgentSdkLoading(true)
    setAgentSdkError('')
    void getAppSettings()
      .then((settings) => {
        if (cancelled) {
          return
        }
        setAgentSdkType(settings.agentSdkType)
      })
      .catch((error) => {
        if (cancelled) {
          return
        }
        setAgentSdkError(error instanceof Error ? error.message : t('读取 Agent SDK 设置失败', 'Failed to load agent SDK settings'))
      })
      .finally(() => {
        if (!cancelled) {
          setAgentSdkLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [t])

  const handleAgentSdkChange = useCallback(async (value: string) => {
    if (value !== 'claude' && value !== 'codex') {
      return
    }
    const nextValue = value as AgentSdkType
    setAgentSdkLoading(true)
    setAgentSdkError('')
    try {
      const updated = await updateAppSettings({ agentSdkType: nextValue })
      setAgentSdkType(updated.agentSdkType)
    } catch (error) {
      setAgentSdkError(error instanceof Error ? error.message : t('更新 Agent SDK 设置失败', 'Failed to update agent SDK settings'))
    } finally {
      setAgentSdkLoading(false)
    }
  }, [t])

  const refreshTaskTimelineData = useCallback(async (taskId: number) => {
    const [files, stageRuns] = await Promise.all([listTaskArtifacts(taskId), listTaskStageRuns({ taskId })])
    setTaskArtifactsByTaskId((prev) => ({
      ...prev,
      [taskId]: files
    }))
    setTaskStageRunsByTaskId((prev) => ({
      ...prev,
      [taskId]: stageRuns
    }))
  }, [])

  const refreshRequirementTimelineData = useCallback(async (requirementId: number) => {
    const [filesResult, stageRunsResult] = await Promise.allSettled([
      listRequirementArtifacts({ requirementId }),
      listRequirementStageRuns({ requirementId })
    ])

    if (filesResult.status === 'fulfilled') {
      setRequirementArtifactsByRequirementId((prev) => ({
        ...prev,
        [requirementId]: filesResult.value
      }))
    }

    if (stageRunsResult.status === 'fulfilled') {
      setRequirementStageRunsByRequirementId((prev) => ({
        ...prev,
        [requirementId]: stageRunsResult.value
      }))
      return
    }

    throw stageRunsResult.reason
  }, [])

  const refreshTaskStageTrace = useCallback(async (stageRunId: number, silent = false) => {
    if (!silent) {
      setTaskStageTraceModal((prev) => {
        if (prev.stageRunId !== stageRunId) {
          return prev
        }

        return {
          ...prev,
          loading: true,
          error: ''
        }
      })
    }

    try {
      const trace = await getTaskStageRunTrace({ stageRunId })
      setTaskStageTraceModal((prev) => {
        if (prev.stageRunId !== stageRunId) {
          return prev
        }

        return {
          ...prev,
          loading: false,
          error: '',
          messages: trace.messages
        }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : pickText('读取阶段执行详情失败', 'Failed to load stage trace details')
      const waitingSession = message.includes('no available session id') || message.includes('没有可用的 session id')
      setTaskStageTraceModal((prev) => {
        if (prev.stageRunId !== stageRunId) {
          return prev
        }

        return {
          ...prev,
          loading: false,
          error: waitingSession ? pickText('会话建立中，自动刷新中...', 'Session is being established, auto-refreshing...') : message
        }
      })
    }
  }, [])

  const refreshRequirementStageTrace = useCallback(async (stageRunId: number, silent = false) => {
    if (!silent) {
      setRequirementStageTraceModal((prev) => {
        if (prev.stageRunId !== stageRunId) {
          return prev
        }

        return {
          ...prev,
          loading: true,
          error: ''
        }
      })
    }

    try {
      const trace = await getRequirementStageRunTrace({ stageRunId })
      setRequirementStageTraceModal((prev) => {
        if (prev.stageRunId !== stageRunId) {
          return prev
        }

        return {
          ...prev,
          loading: false,
          error: '',
          messages: trace.messages
        }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : pickText('读取阶段执行详情失败', 'Failed to load stage trace details')
      const waitingSession = message.includes('no available session id') || message.includes('没有可用的 session id')
      setRequirementStageTraceModal((prev) => {
        if (prev.stageRunId !== stageRunId) {
          return prev
        }

        return {
          ...prev,
          loading: false,
          error: waitingSession ? pickText('会话建立中，自动刷新中...', 'Session is being established, auto-refreshing...') : message
        }
      })
    }
  }, [])


  const clarifyRequirementItem = useMemo(() => {
    if (!clarifyRequirementId) {
      return null
    }

    return requirements.find((item) => item.id === clarifyRequirementId) ?? null
  }, [clarifyRequirementId, requirements])

  const clarifyMessages = useMemo(() => {
    if (!clarifyRequirementItem) {
      return []
    }

    return getClarifyMessages(clarifyRequirementItem.id)
  }, [clarifyRequirementItem, getClarifyMessages])

  useEffect(() => {
    if (!clarifyRequirementId) {
      return
    }

    let cancelled = false
    setClarifyConversationPending(true)
    setClarifyLoadingVisible(false)

    const loadingDelayTimer = window.setTimeout(() => {
      if (!cancelled) {
        setClarifyLoadingVisible(true)
      }
    }, 180)

    void loadRequirementConversation(clarifyRequirementId, clarifyDialogSessionId)
      .catch(() => {
        // error is handled in hook state
      })
      .finally(() => {
        if (cancelled) {
          return
        }
        setClarifyConversationPending(false)
        setClarifyLoadingVisible(false)
      })

    return () => {
      cancelled = true
      window.clearTimeout(loadingDelayTimer)
    }
  }, [clarifyRequirementId, clarifyDialogSessionId, clarifyDialogRefreshSeq, loadRequirementConversation])

  useEffect(() => {
    if (!clarifyRequirementId) {
      return
    }

    if (clarifyDialogMode !== 'detail') {
      return
    }

    const timer = window.setInterval(() => {
      setClarifyDialogRefreshSeq((prev) => prev + 1)
    }, 1000)

    return () => {
      window.clearInterval(timer)
    }
  }, [clarifyRequirementId, clarifyDialogMode])

  const isClarifyQueued = clarifyRequirementItem?.status === 'queued'
  const isClarifyDialogReadonly = clarifyDialogMode === 'detail'
  const isClarifyProcessing =
    clarifyRequirementItem?.status === 'evaluating' ||
    clarifyRequirementItem?.status === 'prd_designing' ||
    clarifyRequirementItem?.status === 'prd_reviewing'
  const hasClarifySessionId = Boolean(clarifyRequirementItem?.agentSessionId?.trim())
  const shouldShowSessionLoading = clarifyConversationPending && clarifyLoadingVisible && hasClarifySessionId && clarifyMessages.length === 0
  const shouldShowThinkingIndicator = isClarifyProcessing
  const canSendClarify = !loading && Boolean(clarifyInput.trim()) && clarifyRequirementItem?.waitingContext === 'prd_review_gate'
  const selectedTask = useMemo(() => {
    if (!activeTaskId) {
      return null
    }

    return filteredTasks.find((task) => task.id === activeTaskId) ?? null
  }, [activeTaskId, filteredTasks])
  const selectedTaskId = selectedTask?.id ?? null
  const selectedTaskWaitingContext = selectedTask?.waitingContext ?? null
  const selectedRequirementId = selectedRequirement?.id ?? null
  const selectedRequirementWaitingContext = selectedRequirement?.waitingContext ?? null
  const isTaskDetailMode = activeListType === 'task' && Boolean(selectedTask)
  const hasRunningStageCard = useMemo(() => {
    if (!selectedTask) {
      return false
    }

    const stageRuns = taskStageRunsByTaskId[selectedTask.id] ?? []
    return stageRuns.some((run) => Boolean(getTaskStageLabel(run.stageKey)) && run.endAt === null && run.resultStatus === 'running')
  }, [selectedTask, taskStageRunsByTaskId])
  const hasRunningRequirementStageCard = useMemo(() => {
    if (!selectedRequirement) {
      return false
    }

    const stageRuns = requirementStageRunsByRequirementId[selectedRequirement.id] ?? []
    return stageRuns.some((run) => run.endAt === null && run.resultStatus === 'running')
  }, [requirementStageRunsByRequirementId, selectedRequirement])

  useEffect(() => {
    if (activeListType === 'requirement' && !selectedRequirement) {
      setIsDetailVisible(false)
    }
  }, [activeListType, selectedRequirement])

  useEffect(() => {
    if (activeListType !== 'task') {
      setActiveTaskId(null)
      setArtifactModalOpen(false)
      setArtifactModalFileName('')
      setArtifactModalContent('')
      setArtifactModalLoading(false)
      setArtifactModalError('')
      closeTaskStageTraceModal()
      setTaskHumanInput('')
      setTaskHumanConversationError('')
      setTaskHumanAwaitingAssistant(null)
    }
  }, [activeListType])

  useEffect(() => {
    if (activeListType !== 'requirement') {
      closeRequirementStageTraceModal()
      setRequirementHumanAwaitingAssistant(null)
    }
  }, [activeListType])

  useEffect(() => {
    if (!taskHumanAwaitingAssistant) {
      return
    }

    const messages = taskHumanMessagesByTaskId[taskHumanAwaitingAssistant.taskId] ?? []
    if (countAssistantMessages(messages) > taskHumanAwaitingAssistant.baselineAssistantCount) {
      setTaskHumanAwaitingAssistant(null)
    }
  }, [taskHumanAwaitingAssistant, taskHumanMessagesByTaskId])

  useEffect(() => {
    if (!requirementHumanAwaitingAssistant) {
      return
    }

    const messages = requirementHumanMessagesByRequirementId[requirementHumanAwaitingAssistant.requirementId] ?? []
    if (countAssistantMessages(messages) > requirementHumanAwaitingAssistant.baselineAssistantCount) {
      setRequirementHumanAwaitingAssistant(null)
    }
  }, [requirementHumanAwaitingAssistant, requirementHumanMessagesByRequirementId])

  useEffect(() => {
    if (!selectedTask) {
      return
    }

    let cancelled = false

    const run = async () => {
      try {
        const [files, stageRuns] = await Promise.all([listTaskArtifacts(selectedTask.id), listTaskStageRuns({ taskId: selectedTask.id })])
        if (!cancelled) {
          setTaskArtifactsByTaskId((prev) => ({
            ...prev,
            [selectedTask.id]: files
          }))
          setTaskStageRunsByTaskId((prev) => ({
            ...prev,
            [selectedTask.id]: stageRuns
          }))
        }
      } catch {
        if (!cancelled) {
          setTaskArtifactsByTaskId((prev) => ({
            ...prev,
            [selectedTask.id]: []
          }))
          setTaskStageRunsByTaskId((prev) => ({
            ...prev,
            [selectedTask.id]: []
          }))
        }
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [selectedTask?.id])

  useEffect(() => {
    if (!selectedRequirement) {
      return
    }

    let cancelled = false

    const run = async () => {
      try {
        await refreshRequirementTimelineData(selectedRequirement.id)
      } catch {
        if (!cancelled) {
          setRequirementStageRunsByRequirementId((prev) => ({
            ...prev,
            [selectedRequirement.id]: []
          }))
        }
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [refreshRequirementTimelineData, selectedRequirement?.id, selectedRequirement?.updatedAt])

  useEffect(() => {
    if (!selectedRequirement || !window.api || typeof window.api.onRequirementStageRunChanged !== 'function') {
      return
    }

    let inFlight = false
    let pending = false

    const refresh = () => {
      if (inFlight) {
        pending = true
        return
      }

      inFlight = true
      void refreshRequirementTimelineData(selectedRequirement.id)
        .catch(() => {
          // ignore push-refresh errors; fallback to existing state
        })
        .finally(() => {
          inFlight = false
          if (pending) {
            pending = false
            refresh()
          }
        })
    }

    const unsubscribe = window.api.onRequirementStageRunChanged((event) => {
      if (event.requirementId !== selectedRequirement.id) {
        return
      }

      refresh()
    })

    return () => {
      unsubscribe()
    }
  }, [refreshRequirementTimelineData, selectedRequirement?.id])

  useEffect(() => {
    if (!selectedRequirement || !requirementStageTraceModal.open || requirementStageTraceModal.stageRunId === null) {
      return
    }

    if (!window.api || typeof window.api.onRequirementStageRunChanged !== 'function') {
      return
    }

    const stageRunId = requirementStageTraceModal.stageRunId
    const unsubscribe = window.api.onRequirementStageRunChanged((event) => {
      if (event.requirementId !== selectedRequirement.id || event.stageRunId !== stageRunId) {
        return
      }

      void refreshRequirementStageTrace(stageRunId, true)
    })

    return () => {
      unsubscribe()
    }
  }, [
    refreshRequirementStageTrace,
    requirementStageTraceModal.open,
    requirementStageTraceModal.stageRunId,
    selectedRequirement?.id
  ])

  useEffect(() => {
    if (!selectedTask || !window.api || typeof window.api.onTaskStageTraceChanged !== 'function') {
      return
    }

    let inFlight = false
    let pending = false

    const refresh = () => {
      if (inFlight) {
        pending = true
        return
      }

      inFlight = true
      void refreshTaskTimelineData(selectedTask.id)
        .catch(() => {
          // ignore push-refresh errors; fallback to existing state
        })
        .finally(() => {
          inFlight = false
          if (pending) {
            pending = false
            refresh()
          }
        })
    }

    const unsubscribe = window.api.onTaskStageTraceChanged((event) => {
      if (event.taskId !== selectedTask.id) {
        return
      }

      refresh()
      if (taskStageTraceModal.open && taskStageTraceModal.stageRunId === event.stageRunId) {
        void refreshTaskStageTrace(event.stageRunId, true)
      }
    })

    return () => {
      unsubscribe()
    }
  }, [refreshTaskStageTrace, refreshTaskTimelineData, selectedTask?.id, taskStageTraceModal.open, taskStageTraceModal.stageRunId])

  useEffect(() => {
    if (!selectedTask || !window.api || typeof window.api.onTaskStatusChanged !== 'function') {
      return
    }

    const unsubscribe = window.api.onTaskStatusChanged((event) => {
      if (event.taskId !== selectedTask.id) {
        return
      }

      void refreshTaskTimelineData(selectedTask.id).catch(() => {
        // ignore push-refresh errors; fallback to existing state
      })
    })

    return () => {
      unsubscribe()
    }
  }, [refreshTaskTimelineData, selectedTask?.id])

  useEffect(() => {
    if (
      !selectedTaskId ||
      !isTaskInWaitingHumanGate(selectedTaskWaitingContext) ||
      !taskStageTraceModal.open ||
      taskStageTraceModal.taskId !== selectedTaskId
    ) {
      return
    }

    let cancelled = false
    setTaskHumanConversationLoading(true)
    setTaskHumanConversationError('')

    void loadTaskHumanConversation(selectedTaskId)
      .then((data) => {
        if (cancelled) {
          return
        }

        setTaskHumanMessagesByTaskId((prev) => ({
          ...prev,
          [selectedTaskId]: mergeTaskHumanMessages(prev[selectedTaskId] ?? [], data.messages)
        }))
      })
      .catch((error) => {
        if (cancelled) {
          return
        }

        setTaskHumanConversationError(error instanceof Error ? error.message : pickText('读取人工会话失败', 'Failed to load human conversation'))
      })
      .finally(() => {
        if (cancelled) {
          return
        }
        setTaskHumanConversationLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [loadTaskHumanConversation, selectedTaskId, selectedTaskWaitingContext, taskStageTraceModal.open, taskStageTraceModal.taskId])

  useEffect(() => {
    if (!hasRunningStageCard) {
      return
    }

    setTaskDurationNowMs(Date.now())
    const timer = window.setInterval(() => {
      setTaskDurationNowMs(Date.now())
    }, 1000)

    return () => {
      window.clearInterval(timer)
    }
  }, [hasRunningStageCard, selectedTask?.id])

  useEffect(() => {
    if (!hasRunningRequirementStageCard) {
      return
    }

    setRequirementDurationNowMs(Date.now())
    const timer = window.setInterval(() => {
      setRequirementDurationNowMs(Date.now())
    }, 1000)

    return () => {
      window.clearInterval(timer)
    }
  }, [hasRunningRequirementStageCard, selectedRequirement?.id])

  const hasRunningRunner = autoProcessorRunning || taskAutoProcessorRunning

  useEffect(() => {
    if (!hasRunningRunner) {
      return
    }

    setRunnerDurationNowMs(Date.now())
    const timer = window.setInterval(() => {
      setRunnerDurationNowMs(Date.now())
    }, 1000)

    return () => {
      window.clearInterval(timer)
    }
  }, [hasRunningRunner])

  const requirementRunnerDurationText = useMemo(() => {
    if (!autoProcessorRunning || autoProcessorStartedAt === null) {
      return ''
    }
    return formatDurationMs(runnerDurationNowMs - autoProcessorStartedAt)
  }, [autoProcessorRunning, autoProcessorStartedAt, runnerDurationNowMs])

  const taskRunnerDurationText = useMemo(() => {
    if (!taskAutoProcessorRunning || taskAutoProcessorStartedAt === null) {
      return ''
    }
    return formatDurationMs(runnerDurationNowMs - taskAutoProcessorStartedAt)
  }, [taskAutoProcessorRunning, taskAutoProcessorStartedAt, runnerDurationNowMs])

  useEffect(() => {
    if (activeMainTab !== 'overview') {
      return
    }

    const timer = window.setInterval(() => {
      setOverviewDurationNowMs(Date.now())
    }, 1000)

    return () => {
      window.clearInterval(timer)
    }
  }, [activeMainTab])

  useEffect(() => {
    setIsDetailVisible(false)
  }, [selectedProjectId, requirementStatusFilter, taskStatusFilter])

  useEffect(() => {
    if (activeListType === 'task') {
      setIsDetailVisible(false)
    }
  }, [activeListType])

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const maxWidth = getSidebarMaxWidth(viewportWidth)
    setSidebarExpandedWidth((prev) => clamp(prev, SIDEBAR_MIN_WIDTH, maxWidth))
  }, [viewportWidth])

  useEffect(() => {
    return () => {
      if (sidebarTransitionEnableRafRef.current !== null) {
        window.cancelAnimationFrame(sidebarTransitionEnableRafRef.current)
        sidebarTransitionEnableRafRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!isSidebarResizing) {
      return
    }

    const onPointerMove = (event: PointerEvent) => {
      const resizeState = sidebarResizeStateRef.current
      if (!resizeState) {
        return
      }
      const maxWidth = getSidebarMaxWidth(window.innerWidth)
      const width = clamp(resizeState.startWidth + event.clientX - resizeState.startX, SIDEBAR_MIN_WIDTH, maxWidth)
      setSidebarExpandedWidth(width)
    }

    const onPointerUp = () => {
      sidebarResizeStateRef.current = null
      setIsSidebarResizing(false)
      if (sidebarTransitionEnableRafRef.current !== null) {
        window.cancelAnimationFrame(sidebarTransitionEnableRafRef.current)
      }
      sidebarTransitionEnableRafRef.current = window.requestAnimationFrame(() => {
        sidebarTransitionEnableRafRef.current = window.requestAnimationFrame(() => {
          setFreezeSidebarTransition(false)
          sidebarTransitionEnableRafRef.current = null
        })
      })
    }

    const originalCursor = document.body.style.cursor
    const originalUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)

    return () => {
      document.body.style.cursor = originalCursor
      document.body.style.userSelect = originalUserSelect
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
  }, [isSidebarResizing])

  useEffect(() => {
    if (!projectContextMenu) {
      return
    }

    const closeMenu = () => setProjectContextMenu(null)
    window.addEventListener('click', closeMenu)
    window.addEventListener('scroll', closeMenu, true)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('scroll', closeMenu, true)
    }
  }, [projectContextMenu])

  useEffect(() => {
    setRunnerEnabledById((prev) => ({
      ...prev,
      [REQUIREMENT_PROCESSOR_RUNNER_ID]: autoProcessorRunning
    }))
  }, [autoProcessorRunning])

  useEffect(() => {
    setRunnerEnabledById((prev) => ({
      ...prev,
      [TASK_EXECUTOR_RUNNER_ID]: taskAutoProcessorRunning
    }))
  }, [taskAutoProcessorRunning])

  const displayedRequirements = useMemo(() => {
    const keyword = queueKeyword.trim().toLowerCase()
    if (!keyword) {
      return filteredRequirements
    }

    return filteredRequirements.filter((requirement) => {
      return requirement.title.toLowerCase().includes(keyword) || requirement.content.toLowerCase().includes(keyword)
    })
  }, [filteredRequirements, queueKeyword])

  const displayedTasks = useMemo(() => {
    const keyword = queueKeyword.trim().toLowerCase()
    if (!keyword) {
      return filteredTasks
    }

    return filteredTasks.filter((task) => {
      return task.title.toLowerCase().includes(keyword) || task.content.toLowerCase().includes(keyword)
    })
  }, [filteredTasks, queueKeyword])

  const displayedRows = activeListType === 'task' ? displayedTasks : displayedRequirements
  const requirementCountByStatus = useMemo(() => {
    const counts: Record<RequirementStatusFilter, number> = {
      pending: 0,
      processing: 0,
      queued: 0,
      canceled: 0
    }

    for (const requirement of requirements) {
      if (requirement.status === 'pending') {
        counts.pending += 1
        continue
      }

      if (requirement.status === 'queued') {
        counts.queued += 1
        continue
      }

      if (requirement.status === 'canceled') {
        counts.canceled += 1
        continue
      }

      if (requirement.status === 'evaluating' || requirement.status === 'prd_designing' || requirement.status === 'prd_reviewing') {
        counts.processing += 1
      }
    }

    return counts
  }, [requirements])
  const taskCountByStatus = useMemo(() => {
    const counts: Record<TaskStatusFilter, number> = {
      idle: 0,
      running: 0,
      waiting_human: 0,
      done: 0
    }

    for (const task of projectTasks) {
      if (task.status === 'idle') {
        counts.idle += 1
        continue
      }

      if (task.waitingContext) {
        counts.waiting_human += 1
        continue
      }

      if (task.status === 'done') {
        counts.done += 1
        continue
      }

      counts.running += 1
    }

    return counts
  }, [projectTasks])
  const requirementProcessedCount = requirementCountByStatus.queued + requirementCountByStatus.canceled
  const requirementProcessingCount = requirementCountByStatus.processing
  const taskProcessedCount = taskCountByStatus.done
  const taskProcessingCount = taskCountByStatus.running
  const totalRows = displayedRows.length
  const totalPages = Math.max(1, Math.ceil(totalRows / rowsPerPage))

  useEffect(() => {
    setCurrentPage(1)
  }, [displayedRows, rowsPerPage])

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  const pagedRequirements = useMemo(() => {
    const start = (currentPage - 1) * rowsPerPage
    return displayedRequirements.slice(start, start + rowsPerPage)
  }, [currentPage, displayedRequirements, rowsPerPage])

  const pagedTasks = useMemo(() => {
    const start = (currentPage - 1) * rowsPerPage
    return displayedTasks.slice(start, start + rowsPerPage)
  }, [currentPage, displayedTasks, rowsPerPage])

  const currentRows = activeListType === 'task' ? pagedTasks : pagedRequirements
  const currentStart = totalRows === 0 ? 0 : (currentPage - 1) * rowsPerPage + 1
  const currentEnd = totalRows === 0 ? 0 : Math.min(totalRows, (currentPage - 1) * rowsPerPage + currentRows.length)
  const isDetailOpen = isDetailVisible && (Boolean(selectedRequirement) || Boolean(selectedTask))
  const sidebarWidth = sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarExpandedWidth
  const contentViewportWidth = viewportWidth - sidebarWidth - SIDEBAR_RESIZER_WIDTH
  const useCompactDetail = contentViewportWidth < OVERLAY_DETAIL_BREAKPOINT
  const buildTaskFlowCardsByTaskId = useCallback(
    (taskId: number): TaskFlowCardItem[] => {
      const stageRuns = taskStageRunsByTaskId[taskId] ?? []
      const artifactFiles = taskArtifactsByTaskId[taskId] ?? []

      return stageRuns
        .filter((run) => Boolean(getTaskStageLabel(run.stageKey)))
        .map((run) => {
          const stageLabel = getTaskStageLabel(run.stageKey)
          const stageTitle = run.round > 1 ? t(`${stageLabel}（第${run.round}轮）`, `${stageLabel} (Round ${run.round})`) : stageLabel
          const stageArtifacts = artifactFiles.filter((file) => run.artifactFileNames.includes(file.fileName))
          const endAt = run.endAt
          const duration = (endAt ?? taskDurationNowMs) - run.startAt
          return {
            id: `${run.stageKey}-${run.round}-${run.id}`,
            stageRunId: run.id,
            stageKey: run.stageKey,
            stageLabel: stageTitle,
            round: run.round,
            startAt: run.startAt,
            endAt,
            resultStatus: run.resultStatus,
            failureReason: run.failureReason,
            durationText: formatDurationMs(duration),
            artifactFiles: stageArtifacts
          }
        })
    },
    [t, taskArtifactsByTaskId, taskDurationNowMs, taskStageRunsByTaskId]
  )
  const selectedTaskFlowCards = useMemo<TaskFlowCardItem[]>(() => {
    if (!selectedTask) {
      return []
    }

    return buildTaskFlowCardsByTaskId(selectedTask.id)
  }, [buildTaskFlowCardsByTaskId, selectedTask])
  const selectedRequirementFlowCards = useMemo<RequirementFlowCardItem[]>(() => {
    if (!selectedRequirement) {
      return []
    }

    const stageRuns = requirementStageRunsByRequirementId[selectedRequirement.id] ?? []
    const artifactFiles = requirementArtifactsByRequirementId[selectedRequirement.id] ?? []

    return stageRuns.map((run) => {
      const stageLabel = getRequirementStageLabel(run.stageKey)
      const stageTitle = run.round > 1 ? t(`${stageLabel}（第${run.round}轮）`, `${stageLabel} (Round ${run.round})`) : stageLabel
      const endAt = run.endAt
      const duration = (endAt ?? requirementDurationNowMs) - run.startAt
      const normalizedArtifactFileNames = run.artifactFileNames.length > 0 ? run.artifactFileNames : [getDefaultRequirementArtifactFileName(run.stageKey)]
      const stageArtifacts = artifactFiles.filter((file) => normalizedArtifactFileNames.includes(file.fileName))
      return {
        id: `${run.stageKey}-${run.round}-${run.id}`,
        stageRunId: run.id,
        stageKey: run.stageKey,
        stageLabel: stageTitle,
        round: run.round,
        startAt: run.startAt,
        endAt,
        resultStatus: run.resultStatus,
        failureReason: run.failureReason,
        durationText: formatDurationMs(duration),
        agentSessionId: run.agentSessionId,
        artifactFiles: stageArtifacts
      }
    })
  }, [requirementArtifactsByRequirementId, requirementDurationNowMs, requirementStageRunsByRequirementId, selectedRequirement, t])
  const taskFlowStageCards = useMemo<StageFlowCardViewModel[]>(
    () =>
      selectedTaskFlowCards.map((card) => ({
        id: card.id,
        stageLabel: card.stageLabel,
        resultStatus: card.resultStatus,
        failureReason: card.failureReason,
        startAt: card.startAt,
        endAt: card.endAt,
        durationText: card.durationText
      })),
    [selectedTaskFlowCards]
  )
  const requirementFlowStageCards = useMemo<StageFlowCardViewModel[]>(
    () =>
      selectedRequirementFlowCards.map((card) => ({
        id: card.id,
        stageLabel: card.stageLabel,
        resultStatus: card.resultStatus,
        failureReason: card.failureReason,
        startAt: card.startAt,
        endAt: card.endAt,
        durationText: card.durationText
      })),
    [selectedRequirementFlowCards]
  )
  const latestTaskFlowCard = selectedTaskFlowCards[selectedTaskFlowCards.length - 1] ?? null
  const latestRequirementFlowCard = selectedRequirementFlowCards[selectedRequirementFlowCards.length - 1] ?? null
  const selectedTaskHumanMessages = useMemo(() => {
    if (!selectedTask) {
      return []
    }

    return taskHumanMessagesByTaskId[selectedTask.id] ?? []
  }, [selectedTask, taskHumanMessagesByTaskId])
  const taskTraceIsWaitingHumanMode = useMemo(() => {
    if (!selectedTask || !isTaskInWaitingHumanGate(selectedTask.waitingContext)) {
      return false
    }

    return taskStageTraceModal.open && taskStageTraceModal.taskId === selectedTask.id && taskStageTraceModal.humanMode
  }, [selectedTask, taskStageTraceModal.humanMode, taskStageTraceModal.open, taskStageTraceModal.taskId])
  const taskTraceMessages = useMemo(() => {
    if (taskTraceIsWaitingHumanMode && selectedTaskHumanMessages.length > 0) {
      return selectedTaskHumanMessages
    }

    return taskStageTraceModal.messages
  }, [selectedTaskHumanMessages, taskStageTraceModal.messages, taskTraceIsWaitingHumanMode])
  const taskStageTraceDisplayItems = useMemo(() => buildTaskTraceDisplayItems(taskTraceMessages), [taskTraceMessages])
  const selectedRequirementHumanMessages = useMemo(() => {
    if (!selectedRequirement) {
      return []
    }

    return requirementHumanMessagesByRequirementId[selectedRequirement.id] ?? []
  }, [requirementHumanMessagesByRequirementId, selectedRequirement])
  const requirementTraceIsWaitingHumanMode = useMemo(() => {
    if (!selectedRequirement || selectedRequirement.waitingContext !== 'prd_review_gate') {
      return false
    }

    return requirementStageTraceModal.open && requirementStageTraceModal.requirementId === selectedRequirement.id && requirementStageTraceModal.humanMode
  }, [requirementStageTraceModal.humanMode, requirementStageTraceModal.open, requirementStageTraceModal.requirementId, selectedRequirement])
  const requirementTraceMessages = useMemo(() => {
    if (requirementTraceIsWaitingHumanMode && selectedRequirementHumanMessages.length > 0) {
      return selectedRequirementHumanMessages
    }

    return requirementStageTraceModal.messages
  }, [requirementStageTraceModal.messages, requirementTraceIsWaitingHumanMode, selectedRequirementHumanMessages])
  const requirementStageTraceDisplayItems = useMemo(() => buildTaskTraceDisplayItems(requirementTraceMessages), [requirementTraceMessages])
  const taskTraceHasAssistantMessage = useMemo(() => taskTraceMessages.some((message) => message.role === 'assistant'), [taskTraceMessages])
  const taskTraceHasPendingToolCall = useMemo(
    () => taskStageTraceDisplayItems.some((item) => item.kind === 'paired_tool' && !item.toolResult),
    [taskStageTraceDisplayItems]
  )
  const shouldShowTaskTraceToolWaitingDots =
    taskStageTraceModal.open &&
    !taskStageTraceModal.error &&
    (taskStageTraceModal.loading ||
      (!taskTraceHasAssistantMessage && taskTraceHasPendingToolCall) ||
      (taskTraceIsWaitingHumanMode && !!selectedTask && taskHumanAwaitingAssistant?.taskId === selectedTask.id))
  const requirementTraceHasAssistantMessage = useMemo(
    () => requirementTraceMessages.some((message) => message.role === 'assistant'),
    [requirementTraceMessages]
  )
  const requirementTraceHasPendingToolCall = useMemo(
    () => requirementStageTraceDisplayItems.some((item) => item.kind === 'paired_tool' && !item.toolResult),
    [requirementStageTraceDisplayItems]
  )
  const shouldShowRequirementTraceToolWaitingDots =
    requirementStageTraceModal.open &&
    !requirementStageTraceModal.error &&
    (requirementStageTraceModal.loading ||
      (!requirementTraceHasAssistantMessage && requirementTraceHasPendingToolCall) ||
      (requirementTraceIsWaitingHumanMode &&
        !!selectedRequirement &&
        requirementHumanAwaitingAssistant?.requirementId === selectedRequirement.id))

  const openRequirementDetail = (requirementId: number) => {
    if (activeListType !== 'requirement') {
      return
    }

    if (selectedRequirement?.id !== requirementId) {
      selectRequirement(requirementId)
    }

    if (activeTaskId !== null) {
      setActiveTaskId(null)
      setArtifactModalOpen(false)
      setArtifactModalFileName('')
      setArtifactModalContent('')
      setArtifactModalError('')
    }

    if (!isDetailVisible) {
      setIsDetailVisible(true)
    }
  }

  const openTaskDetail = (taskId: number) => {
    if (activeListType !== 'task') {
      return
    }

    setActiveTaskId(taskId)
    setArtifactModalOpen(false)
    setArtifactModalFileName('')
    setArtifactModalContent('')
    setArtifactModalError('')
    if (!isDetailVisible) {
      setIsDetailVisible(true)
    }
  }

  const focusTaskHumanInput = useCallback(() => {
    window.requestAnimationFrame(() => {
      taskHumanInputRef.current?.focus()
    })
  }, [])

  const focusRequirementHumanInput = useCallback(() => {
    window.requestAnimationFrame(() => {
      requirementHumanInputRef.current?.focus()
    })
  }, [])

  const openTaskHumanConversation = useCallback(
    (taskId: number) => {
      if (activeListType !== 'task') {
        return
      }

      openTaskDetail(taskId)
      const task = filteredTasks.find((item) => item.id === taskId)
      const waitingContext = task?.waitingContext ?? null
      if (!isTaskInWaitingHumanGate(waitingContext)) {
        return
      }

      const waitingStageKey = waitingContext === 'coding_gate' ? 'coding' : 'arch_designing'
      const waitingCard = buildTaskFlowCardsByTaskId(taskId)
        .filter((item) => item.stageKey === waitingStageKey)
        .slice()
        .reverse()
        .find((item) => item.resultStatus === 'waiting_human')
      if (!waitingCard) {
        return
      }

      const cachedHumanMessages = taskHumanMessagesByTaskId[taskId] ?? []
      const hasCachedHumanMessages = cachedHumanMessages.length > 0
      if (
        taskStageTraceModal.open &&
        taskStageTraceModal.humanMode &&
        taskStageTraceModal.taskId === taskId &&
        taskStageTraceModal.stageRunId === waitingCard.stageRunId
      ) {
        focusTaskHumanInput()
        return
      }

      setTaskStageTraceModal({
        open: true,
        stageRunId: waitingCard.stageRunId,
        taskId,
        humanMode: true,
        stageLabel: waitingCard.stageLabel,
        round: waitingCard.round,
        loading: !hasCachedHumanMessages,
        error: '',
        messages: cachedHumanMessages
      })
      void refreshTaskStageTrace(waitingCard.stageRunId, hasCachedHumanMessages)
      focusTaskHumanInput()
    },
    [activeListType, buildTaskFlowCardsByTaskId, filteredTasks, focusTaskHumanInput, openTaskDetail, refreshTaskStageTrace, taskHumanMessagesByTaskId, taskStageTraceModal]
  )

  const openRequirementHumanConversation = useCallback(
    async (requirementId: number) => {
      if (activeListType !== 'requirement') {
        return
      }

      if (selectedRequirement?.id !== requirementId) {
        selectRequirement(requirementId)
      }

      try {
        const stageRuns = await listRequirementStageRuns({ requirementId })
        setRequirementStageRunsByRequirementId((prev) => ({
          ...prev,
          [requirementId]: stageRuns
        }))

        const waitingStageRun = stageRuns.slice().reverse().find((run) => run.resultStatus === 'waiting_human')
        if (!waitingStageRun) {
          return
        }

        const stageLabel = getRequirementStageLabel(waitingStageRun.stageKey)
        const stageTitle =
          waitingStageRun.round > 1
            ? t(`${stageLabel}（第${waitingStageRun.round}轮）`, `${stageLabel} (Round ${waitingStageRun.round})`)
            : stageLabel

        const cachedHumanMessages = requirementHumanMessagesByRequirementId[requirementId] ?? []
        const hasCachedHumanMessages = cachedHumanMessages.length > 0
        if (
          requirementStageTraceModal.open &&
          requirementStageTraceModal.humanMode &&
          requirementStageTraceModal.requirementId === requirementId &&
          requirementStageTraceModal.stageRunId === waitingStageRun.id
        ) {
          focusRequirementHumanInput()
          return
        }

        setRequirementStageTraceModal({
          open: true,
          stageRunId: waitingStageRun.id,
          requirementId,
          agentSessionId: waitingStageRun.agentSessionId,
          humanMode: true,
          stageLabel: stageTitle,
          round: waitingStageRun.round,
          loading: !hasCachedHumanMessages,
          error: '',
          messages: cachedHumanMessages
        })
        void refreshRequirementStageTrace(waitingStageRun.id, hasCachedHumanMessages)
        focusRequirementHumanInput()
      } catch {
        // ignore; timeline refresh fallback already handled elsewhere
      }
    },
    [
      activeListType,
      focusRequirementHumanInput,
      refreshRequirementStageTrace,
      requirementHumanMessagesByRequirementId,
      requirementStageTraceModal,
      selectRequirement,
      selectedRequirement?.id,
      t
    ]
  )

  const closeArtifactModal = () => {
    setArtifactModalOpen(false)
    setArtifactModalFileName('')
    setArtifactModalContent('')
    setArtifactModalError('')
    setArtifactModalLoading(false)
  }

  const scrollClarifyMessagesToBottom = () => {
    window.requestAnimationFrame(() => {
      const node = clarifyMessagesContainerRef.current
      if (!node) {
        return
      }
      node.scrollTop = node.scrollHeight
    })
  }

  const scrollTaskStageTraceMessagesToBottom = () => {
    window.requestAnimationFrame(() => {
      const node = taskStageTraceMessagesContainerRef.current
      if (!node) {
        return
      }
      node.scrollTop = node.scrollHeight
    })
  }

  const scrollRequirementStageTraceMessagesToBottom = () => {
    window.requestAnimationFrame(() => {
      const node = requirementStageTraceMessagesContainerRef.current
      if (!node) {
        return
      }
      node.scrollTop = node.scrollHeight
    })
  }

  useEffect(() => {
    if (!taskStageTraceModal.open) {
      return
    }

    scrollTaskStageTraceMessagesToBottom()
  }, [taskStageTraceModal.open, taskStageTraceModal.messages, taskStageTraceModal.loading, taskStageTraceModal.error])

  useEffect(() => {
    if (!requirementStageTraceModal.open) {
      return
    }

    scrollRequirementStageTraceMessagesToBottom()
  }, [requirementStageTraceModal.open, requirementStageTraceModal.messages, requirementStageTraceModal.loading, requirementStageTraceModal.error])

  const closeTaskStageTraceModal = () => {
    setTaskStageTraceModal({
      open: false,
      stageRunId: null,
      taskId: null,
      humanMode: false,
      stageLabel: '',
      round: 1,
      loading: false,
      error: '',
      messages: []
    })
    setTaskHumanAwaitingAssistant(null)
    setTaskTraceDetailModal({
      open: false,
      title: '',
      subtitle: '',
      content: ''
    })
  }

  const closeRequirementStageTraceModal = () => {
    setRequirementStageTraceModal({
      open: false,
      stageRunId: null,
      requirementId: null,
      agentSessionId: null,
      humanMode: false,
      stageLabel: '',
      round: 1,
      loading: false,
      error: '',
      messages: []
    })
    setRequirementHumanAwaitingAssistant(null)
    setRequirementHumanInput('')
    setRequirementHumanConversationError('')
    setTaskTraceDetailModal({
      open: false,
      title: '',
      subtitle: '',
      content: ''
    })
  }

  const openTaskTraceDetailModal = (input: { title: string; subtitle: string; content: string }) => {
    setTaskTraceDetailModal({
      open: true,
      title: input.title,
      subtitle: input.subtitle,
      content: input.content
    })
  }

  const closeTaskTraceDetailModal = () => {
    setTaskTraceDetailModal({
      open: false,
      title: '',
      subtitle: '',
      content: ''
    })
  }

  const onOpenTaskStageTraceModal = (card: TaskFlowCardItem) => {
    setTaskStageTraceModal({
      open: true,
      stageRunId: card.stageRunId,
      taskId: selectedTask?.id ?? null,
      humanMode: false,
      stageLabel: card.stageLabel,
      round: card.round,
      loading: true,
      error: '',
      messages: []
    })
    void refreshTaskStageTrace(card.stageRunId)
  }

  const onOpenRequirementStageTraceModal = (card: RequirementFlowCardItem, requirementId?: number) => {
    setRequirementStageTraceModal({
      open: true,
      stageRunId: card.stageRunId,
      requirementId: requirementId ?? selectedRequirement?.id ?? null,
      agentSessionId: card.agentSessionId,
      humanMode: card.resultStatus === 'waiting_human',
      stageLabel: card.stageLabel,
      round: card.round,
      loading: true,
      error: '',
      messages: []
    })
    void refreshRequirementStageTrace(card.stageRunId)
    if (card.resultStatus === 'waiting_human') {
      focusRequirementHumanInput()
    }
  }

  const openRequirementLatestStageTraceFromList = useCallback(
    async (requirementId: number) => {
      if (activeListType !== 'requirement') {
        return
      }

      try {
        const stageRuns = await listRequirementStageRuns({ requirementId })
        setRequirementStageRunsByRequirementId((prev) => ({
          ...prev,
          [requirementId]: stageRuns
        }))

        const latestStageRun = stageRuns[stageRuns.length - 1]
        if (!latestStageRun) {
          return
        }

        const stageLabel = getRequirementStageLabel(latestStageRun.stageKey)
        const stageTitle =
          latestStageRun.round > 1 ? t(`${stageLabel}（第${latestStageRun.round}轮）`, `${stageLabel} (Round ${latestStageRun.round})`) : stageLabel

        onOpenRequirementStageTraceModal(
          {
            id: `${latestStageRun.stageKey}-${latestStageRun.round}-${latestStageRun.id}`,
            stageRunId: latestStageRun.id,
            stageKey: latestStageRun.stageKey,
            stageLabel: stageTitle,
            round: latestStageRun.round,
            startAt: latestStageRun.startAt,
            endAt: latestStageRun.endAt,
            resultStatus: latestStageRun.resultStatus,
            failureReason: latestStageRun.failureReason,
            durationText: formatDurationMs((latestStageRun.endAt ?? Date.now()) - latestStageRun.startAt),
            agentSessionId: latestStageRun.agentSessionId,
            artifactFiles: []
          },
          requirementId
        )
      } catch {
        // ignore; fallback to existing timeline state
      }
    },
    [activeListType, onOpenRequirementStageTraceModal, t]
  )

  const onPreviewTaskArtifact = async (taskId: number, fileName: string) => {
    setArtifactModalOpen(true)
    setArtifactModalLoading(true)
    setArtifactModalError('')
    setArtifactModalFileName(fileName)
    setArtifactModalContent('')
    try {
      const content = await readTaskArtifact({ taskId, fileName })
      setArtifactModalContent(content)
    } catch (error) {
      setArtifactModalError(
        error instanceof Error ? `${pickText('读取失败', 'Read failed')}: ${error.message}` : pickText('读取失败', 'Read failed')
      )
    } finally {
      setArtifactModalLoading(false)
    }
  }

  const onPreviewRequirementArtifact = async (requirementId: number, fileName: string) => {
    setArtifactModalOpen(true)
    setArtifactModalLoading(true)
    setArtifactModalError('')
    setArtifactModalFileName(fileName)
    setArtifactModalContent('')
    try {
      const content = await readRequirementArtifact({ requirementId, fileName })
      setArtifactModalContent(content)
    } catch (error) {
      setArtifactModalError(
        error instanceof Error ? error.message : t('读取产物失败', 'Failed to load artifact')
      )
    } finally {
      setArtifactModalLoading(false)
    }
  }

  const onSendTaskHumanConversation = async () => {
    if (!selectedTask || !selectedTask.waitingContext) {
      return
    }

    const message = taskHumanInput.trim()
    if (!message) {
      return
    }
    const baselineAssistantCount = countAssistantMessages(taskHumanMessagesByTaskId[selectedTask.id] ?? [])
    setTaskHumanInput('')

    setTaskHumanConversationLoading(true)
    setTaskHumanConversationError('')
    setTaskHumanAwaitingAssistant({
      taskId: selectedTask.id,
      baselineAssistantCount
    })

    setTaskHumanMessagesByTaskId((prev) => ({
      ...prev,
      [selectedTask.id]: appendTaskHumanMessageIfMissing(prev[selectedTask.id] ?? [], message)
    }))

    try {
      const data = await sendTaskHumanConversation(selectedTask.id, message)
      setTaskHumanMessagesByTaskId((prev) => ({
        ...prev,
        [selectedTask.id]: mergeTaskHumanMessages(prev[selectedTask.id] ?? [], data.messages, { ensureInput: message })
      }))
    } catch (error) {
      setTaskHumanAwaitingAssistant(null)
      setTaskHumanInput(message)
      setTaskHumanConversationError(error instanceof Error ? error.message : pickText('人工会话回复失败', 'Failed to reply in human conversation'))
    } finally {
      setTaskHumanConversationLoading(false)
    }
  }

  const onConfirmTaskHuman = async () => {
    if (!selectedTask || !selectedTask.waitingContext) {
      return
    }

    setTaskHumanConversationLoading(true)
    setTaskHumanConversationError('')

    try {
      await applyTaskCommand(selectedTask.id, 'force_pass')
      setTaskHumanInput('')
    } catch (error) {
      setTaskHumanConversationError(error instanceof Error ? error.message : pickText('确认流转失败', 'Failed to confirm transition'))
    } finally {
      setTaskHumanConversationLoading(false)
    }
  }

  const loadRequirementHumanConversation = useCallback(
    async (requirementId: number, sessionId?: string) => {
      const normalizedSessionId = sessionId?.trim()
      if (!normalizedSessionId) {
        return
      }

      setRequirementHumanConversationLoading(true)
      setRequirementHumanConversationError('')
      try {
        const data = await loadRequirementConversation(requirementId, normalizedSessionId)
        const converted: TaskAgentTraceMessage[] = data.messages.map((message) => ({
          id: message.id,
          role: message.role === 'assistant' ? 'assistant' : message.role === 'user' ? 'user' : 'system',
          messageType: 'text',
          content: message.content
        }))
        setRequirementHumanMessagesByRequirementId((prev) => ({
          ...prev,
          [requirementId]: mergeTaskHumanMessages(prev[requirementId] ?? [], converted)
        }))
      } catch (error) {
        setRequirementHumanConversationError(error instanceof Error ? error.message : pickText('读取人工会话失败', 'Failed to load human conversation'))
      } finally {
        setRequirementHumanConversationLoading(false)
      }
    },
    [loadRequirementConversation]
  )

  useEffect(() => {
    if (
      !selectedRequirementId ||
      selectedRequirementWaitingContext !== 'prd_review_gate' ||
      !requirementStageTraceModal.open ||
      !requirementStageTraceModal.humanMode ||
      requirementStageTraceModal.requirementId !== selectedRequirementId
    ) {
      return
    }

    void loadRequirementHumanConversation(selectedRequirementId, requirementStageTraceModal.agentSessionId ?? undefined)
  }, [
    loadRequirementHumanConversation,
    requirementStageTraceModal.agentSessionId,
    requirementStageTraceModal.humanMode,
    requirementStageTraceModal.open,
    requirementStageTraceModal.requirementId,
    selectedRequirementId,
    selectedRequirementWaitingContext
  ])

  const onSendRequirementHumanConversation = async () => {
    if (!selectedRequirement || selectedRequirement.waitingContext !== 'prd_review_gate') {
      return
    }

    const message = requirementHumanInput.trim()
    if (!message) {
      return
    }
    const baselineAssistantCount = countAssistantMessages(requirementHumanMessagesByRequirementId[selectedRequirement.id] ?? [])
    setRequirementHumanInput('')

    setRequirementHumanConversationLoading(true)
    setRequirementHumanConversationError('')
    setRequirementHumanAwaitingAssistant({
      requirementId: selectedRequirement.id,
      baselineAssistantCount
    })
    setRequirementHumanMessagesByRequirementId((prev) => ({
      ...prev,
      [selectedRequirement.id]: appendTaskHumanMessageIfMissing(prev[selectedRequirement.id] ?? [], message)
    }))
    try {
      const data = await clarifyRequirement(selectedRequirement.id, message)
      const converted: TaskAgentTraceMessage[] = data.messages.map((item) => ({
        id: item.id,
        role: item.role === 'assistant' ? 'assistant' : item.role === 'user' ? 'user' : 'system',
        messageType: 'text',
        content: item.content
      }))
      setRequirementHumanMessagesByRequirementId((prev) => ({
        ...prev,
        [selectedRequirement.id]: mergeTaskHumanMessages(prev[selectedRequirement.id] ?? [], converted, { ensureInput: message })
      }))
    } catch (error) {
      setRequirementHumanAwaitingAssistant(null)
      setRequirementHumanInput(message)
      setRequirementHumanConversationError(error instanceof Error ? error.message : pickText('人工会话回复失败', 'Failed to reply in human conversation'))
    } finally {
      setRequirementHumanConversationLoading(false)
    }
  }

  const onConfirmRequirementHuman = async () => {
    if (!selectedRequirement || selectedRequirement.waitingContext !== 'prd_review_gate') {
      return
    }

    setRequirementHumanConversationLoading(true)
    setRequirementHumanConversationError('')
    try {
      await saveRequirement({
        id: selectedRequirement.id,
        title: selectedRequirement.title,
        content: selectedRequirement.content,
        status: selectedRequirement.status,
        source: selectedRequirement.source
      })
      await processRequirementService({
        requirementId: selectedRequirement.id,
        type: 'clarify',
        source: '人工对齐'
      })
      setRequirementHumanInput('')
    } catch (error) {
      setRequirementHumanConversationError(error instanceof Error ? error.message : pickText('确认流转失败', 'Failed to confirm transition'))
    } finally {
      setRequirementHumanConversationLoading(false)
    }
  }

  const onCancelTaskHuman = async () => {
    if (!selectedTask || !selectedTask.waitingContext) {
      return
    }

    setTaskHumanConversationLoading(true)
    setTaskHumanConversationError('')

    try {
      await applyTaskCommand(selectedTask.id, 'cancel')
      setTaskHumanInput('')
    } catch (error) {
      setTaskHumanConversationError(error instanceof Error ? error.message : pickText('取消任务失败', 'Failed to cancel task'))
    } finally {
      setTaskHumanConversationLoading(false)
    }
  }

  useEffect(() => {
    if (!isCreateRequirementDialogOpen) {
      return
    }

    if (projects.length === 0) {
      if (createRequirementProjectId !== null) {
        setCreateRequirementProjectId(null)
      }
      return
    }

    const hasCurrent = createRequirementProjectId !== null && projects.some((project) => project.id === createRequirementProjectId)
    if (!hasCurrent) {
      const fallbackProjectId =
        selectedProjectId !== null && projects.some((project) => project.id === selectedProjectId)
          ? selectedProjectId
          : projects[0].id
      setCreateRequirementProjectId(fallbackProjectId)
    }
  }, [createRequirementProjectId, isCreateRequirementDialogOpen, projects, selectedProjectId])

  useEffect(() => {
    if (!isCreateTaskDialogOpen) {
      return
    }

    if (projects.length === 0) {
      if (createTaskProjectId !== null) {
        setCreateTaskProjectId(null)
      }
      return
    }

    const hasCurrent = createTaskProjectId !== null && projects.some((project) => project.id === createTaskProjectId)
    if (!hasCurrent) {
      const fallbackProjectId =
        selectedProjectId !== null && projects.some((project) => project.id === selectedProjectId)
          ? selectedProjectId
          : projects[0].id
      setCreateTaskProjectId(fallbackProjectId)
    }
  }, [createTaskProjectId, isCreateTaskDialogOpen, projects, selectedProjectId])

  const openCreateRequirementDialog = () => {
    const defaultProjectId =
      projects.length > 0
        ? selectedProjectId !== null && projects.some((project) => project.id === selectedProjectId)
          ? selectedProjectId
          : projects[0].id
        : null
    setCreateRequirementProjectId(defaultProjectId)
    setIsCreateRequirementDialogOpen(true)
  }

  const openCreateTaskDialog = () => {
    const defaultProjectId =
      projects.length > 0
        ? selectedProjectId !== null && projects.some((project) => project.id === selectedProjectId)
          ? selectedProjectId
          : projects[0].id
        : null
    setCreateTaskProjectId(defaultProjectId)
    setIsCreateTaskDialogOpen(true)
  }

  const resetCreateRequirementDialog = () => {
    setNewRequirementContent('')
    setCreateRequirementProjectId(null)
  }

  const closeCreateRequirementDialog = () => {
    setIsCreateRequirementDialogOpen(false)
    resetCreateRequirementDialog()
  }

  const resetCreateTaskDialog = () => {
    setNewTaskContent('')
    setCreateTaskProjectId(null)
  }

  const closeCreateTaskDialog = () => {
    setIsCreateTaskDialogOpen(false)
    resetCreateTaskDialog()
  }

  const onCreateRequirementOnly = async () => {
    const content = newRequirementContent.trim()
    if (!content || !createRequirementProjectId) {
      return
    }

    closeCreateRequirementDialog()
    await createRequirementPending(content, content, t('人工提需', 'Human Submitted Requirement'), createRequirementProjectId)
  }

  const onCreateTaskOnly = async () => {
    const content = newTaskContent.trim()
    if (!content || !createTaskProjectId) {
      return
    }

    closeCreateTaskDialog()
    await createTaskItem(createTaskProjectId, content, content, null)
  }

  const onRevealProjectInFinder = async (path: string) => {
    setProjectContextMenu(null)
    try {
      await revealProjectInFinder({ path })
    } catch (e) {
      // eslint-disable-next-line no-alert
      window.alert(e instanceof Error ? e.message : t('在 Finder 中打开失败', 'Failed to reveal in Finder'))
    }
  }

  const canSubmitRequirement = Boolean(newRequirementContent.trim()) && !loading && Boolean(createRequirementProjectId)
  const canSubmitTask = Boolean(newTaskContent.trim()) && !loading && Boolean(createTaskProjectId)
  const canToggleAutoProcessor = !autoProcessorLoading
  const canToggleTaskAutoProcessor = !taskAutoProcessorLoading
  const showRequirementActions = activeMainTab === 'workspace' && activeListType === 'requirement'
  const showTaskActions = activeMainTab === 'workspace' && activeListType === 'task'
  const isOverviewTabActive = activeMainTab === 'overview'

  const openConversationDetailDialog = (requirementId: number) => {
    setClarifyDialogMode('detail')
    setClarifyDialogSessionId(undefined)
    setClarifyDialogRefreshSeq(0)
    setClarifyConversationPending(false)
    setClarifyLoadingVisible(false)
    setClarifyRequirementId(requirementId)
    setClarifyInput('')
  }

  const closeClarifyDialog = () => {
    setClarifyDialogMode('clarify')
    setClarifyDialogSessionId(undefined)
    setClarifyDialogRefreshSeq(0)
    setClarifyConversationPending(false)
    setClarifyLoadingVisible(false)
    setClarifyRequirementId(null)
    setClarifyInput('')
  }

  const onSendClarify = async () => {
    if (!clarifyRequirementItem) {
      return
    }
    if (isClarifyDialogReadonly) {
      return
    }

    const message = clarifyInput.trim()
    if (!message) {
      return
    }

    setClarifyInput('')
    scrollClarifyMessagesToBottom()
    try {
      await clarifyRequirement(clarifyRequirementItem.id, message)
      scrollClarifyMessagesToBottom()
    } catch {
      setClarifyInput(message)
    }
  }

  const onSidebarResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (sidebarCollapsed || event.button !== 0) {
      return
    }

    if (sidebarTransitionEnableRafRef.current !== null) {
      window.cancelAnimationFrame(sidebarTransitionEnableRafRef.current)
      sidebarTransitionEnableRafRef.current = null
    }
    setFreezeSidebarTransition(true)
    sidebarResizeStateRef.current = {
      startX: event.clientX,
      startWidth: sidebarExpandedWidth
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsSidebarResizing(true)
    event.preventDefault()
  }

  const refreshOverviewStageRuns = useCallback(async () => {
    if (activeMainTab !== 'overview') {
      return
    }

    if (requirements.length === 0) {
      setOverviewRequirementStageRunsByRequirementId({})
    } else {
      const requirementEntries = await Promise.all(
        requirements.map(async (requirement) => {
          try {
            const stageRuns = await listRequirementStageRuns({ requirementId: requirement.id })
            return [requirement.id, stageRuns] as [number, RequirementStageRun[]]
          } catch {
            return [requirement.id, []] as [number, RequirementStageRun[]]
          }
        })
      )
      const nextRequirementRuns: Record<number, RequirementStageRun[]> = {}
      for (const [requirementId, stageRuns] of requirementEntries) {
        nextRequirementRuns[requirementId] = stageRuns
      }
      setOverviewRequirementStageRunsByRequirementId(nextRequirementRuns)
    }

    if (projectTasks.length === 0) {
      setOverviewTaskStageRunsByTaskId({})
    } else {
      const taskEntries = await Promise.all(
        projectTasks.map(async (task) => {
          try {
            const stageRuns = await listTaskStageRuns({ taskId: task.id })
            return [task.id, stageRuns] as [number, TaskStageRun[]]
          } catch {
            return [task.id, []] as [number, TaskStageRun[]]
          }
        })
      )
      const nextTaskRuns: Record<number, TaskStageRun[]> = {}
      for (const [taskId, stageRuns] of taskEntries) {
        nextTaskRuns[taskId] = stageRuns
      }
      setOverviewTaskStageRunsByTaskId(nextTaskRuns)
    }
  }, [activeMainTab, projectTasks, requirements])

  useEffect(() => {
    if (activeMainTab !== 'overview') {
      return
    }

    let cancelled = false

    const run = async () => {
      await refreshOverviewStageRuns()
      if (cancelled) {
        return
      }
      setOverviewDurationNowMs(Date.now())
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [activeMainTab, refreshOverviewStageRuns])

  const overviewRequirementRunSummary = useMemo(() => {
    const runs = Object.values(overviewRequirementStageRunsByRequirementId).flat()
    if (runs.length === 0) {
      return { count: 0, totalDurationMs: 0 }
    }

    let totalDurationMs = 0
    for (const run of runs) {
      totalDurationMs += getStageRunDurationMs(
        {
          startAt: run.startAt,
          endAt: run.endAt,
          updatedAt: run.updatedAt,
          resultStatus: run.resultStatus
        },
        overviewDurationNowMs
      )
    }

    return {
      count: runs.length,
      totalDurationMs
    }
  }, [overviewDurationNowMs, overviewRequirementStageRunsByRequirementId])

  const overviewTaskRunSummary = useMemo(() => {
    const runs = Object.values(overviewTaskStageRunsByTaskId).flat()
    if (runs.length === 0) {
      return { count: 0, totalDurationMs: 0 }
    }

    let totalDurationMs = 0
    for (const run of runs) {
      totalDurationMs += getStageRunDurationMs(
        {
          startAt: run.startAt,
          endAt: run.endAt,
          updatedAt: run.updatedAt,
          resultStatus: run.resultStatus
        },
        overviewDurationNowMs
      )
    }

    return {
      count: runs.length,
      totalDurationMs
    }
  }, [overviewDurationNowMs, overviewTaskStageRunsByTaskId])

  const overviewAgentRunCount = overviewRequirementRunSummary.count + overviewTaskRunSummary.count
  const overviewAgentTotalDurationMs = overviewRequirementRunSummary.totalDurationMs + overviewTaskRunSummary.totalDurationMs
  const overviewAgentAverageDurationMs = overviewAgentRunCount > 0 ? Math.round(overviewAgentTotalDurationMs / overviewAgentRunCount) : 0
  const overviewCards = useMemo<OverviewMetricCard[]>(
    () => [
      {
        id: 'running-requirements',
        title: t('当前运行需求数', 'Running Requirements'),
        value: `${requirementProcessingCount}`,
        subtitle: t(`总需求数 ${requirements.length}`, `Total requirements ${requirements.length}`)
      },
      {
        id: 'total-requirements',
        title: t('总需求数', 'Total Requirements'),
        value: `${requirements.length}`,
        subtitle: t(`当前运行 ${requirementProcessingCount}`, `Running now ${requirementProcessingCount}`)
      },
      {
        id: 'running-tasks',
        title: t('当前运行任务数', 'Running Tasks'),
        value: `${taskProcessingCount}`,
        subtitle: t(`总任务数 ${projectTasks.length}`, `Total tasks ${projectTasks.length}`)
      },
      {
        id: 'total-tasks',
        title: t('总任务数', 'Total Tasks'),
        value: `${projectTasks.length}`,
        subtitle: t(`当前运行 ${taskProcessingCount}`, `Running now ${taskProcessingCount}`)
      },
      {
        id: 'agent-average-duration',
        title: t('Agent平均处理时长', 'Average Agent Duration'),
        value: formatDurationMs(overviewAgentAverageDurationMs),
        subtitle: t(`统计样本 ${overviewAgentRunCount} 次`, `Samples ${overviewAgentRunCount}`)
      },
      {
        id: 'agent-total-duration',
        title: t('Agent处理总时长', 'Total Agent Duration'),
        value: formatDurationMs(overviewAgentTotalDurationMs),
        subtitle: t(
          `需求 ${overviewRequirementRunSummary.count} + 任务 ${overviewTaskRunSummary.count}`,
          `Requirements ${overviewRequirementRunSummary.count} + Tasks ${overviewTaskRunSummary.count}`
        )
      }
    ],
    [
      overviewAgentAverageDurationMs,
      overviewAgentRunCount,
      overviewAgentTotalDurationMs,
      overviewRequirementRunSummary.count,
      overviewTaskRunSummary.count,
      projectTasks.length,
      requirementProcessingCount,
      requirements.length,
      t,
      taskProcessingCount
    ]
  )

  return (
    <div className={cn('flex h-screen bg-white text-foreground', isSidebarResizing && 'select-none')}>
      <aside
        className={cn(
          'flex h-full shrink-0 flex-col bg-[#f8f9fb]',
          !(isSidebarResizing || freezeSidebarTransition) && 'transition-[width] duration-200'
        )}
        style={{ width: sidebarWidth }}
      >
        <div className="drag-region h-7 shrink-0" />
        <div className="px-4 pb-2 pt-3">
          <div className="flex h-7 items-center gap-1.5 text-slate-400">
            <button
              type="button"
              className={cn(
                'no-drag inline-flex h-6 shrink-0 items-center rounded-md',
                sidebarCollapsed ? 'cursor-pointer' : 'cursor-default'
              )}
              onClick={() => {
                if (sidebarCollapsed) {
                  setSidebarCollapsed(false)
                }
              }}
              aria-label={sidebarCollapsed ? t('展开侧边栏', 'Expand sidebar') : 'Senior'}
              title={sidebarCollapsed ? t('展开侧边栏', 'Expand sidebar') : 'Senior'}
            >
              <img src={seniorLogo} alt="Senior" className="h-5 w-[65px] shrink-0 object-contain" />
            </button>
            {!sidebarCollapsed ? (
              <button
                type="button"
                className="no-drag ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-white hover:text-slate-700"
                onClick={() => setSidebarCollapsed(true)}
                aria-label={t('收起侧边栏', 'Collapse sidebar')}
                title={t('收起侧边栏', 'Collapse sidebar')}
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          <div className="mt-5 space-y-1">
            <button
              type="button"
              onClick={openCreateRequirementDialog}
              className={cn(
                'no-drag flex h-10 w-full items-center rounded-xl px-3 text-sm text-slate-700 hover:bg-white',
                sidebarCollapsed ? 'justify-center' : 'gap-2.5'
              )}
              disabled={loading || projects.length === 0}
            >
              <PenLine className="h-4 w-4 shrink-0" />
              {!sidebarCollapsed ? <span>{t('提需求', 'Create Requirement')}</span> : null}
            </button>
            <button
              type="button"
              className={cn(
                'no-drag flex h-10 w-full items-center rounded-xl px-3 text-sm text-slate-700 hover:bg-white',
                sidebarCollapsed ? 'justify-center' : 'gap-2.5'
              )}
              onClick={openCreateTaskDialog}
              disabled={loading || projects.length === 0}
            >
              <Clock3 className="h-4 w-4 shrink-0" />
              {!sidebarCollapsed ? <span>{t('派任务', 'Create Task')}</span> : null}
            </button>
            <button
              type="button"
              className={cn(
                'no-drag flex h-10 w-full items-center rounded-xl px-3 text-sm',
                sidebarCollapsed ? 'justify-center' : 'gap-2.5',
                isOverviewTabActive ? 'bg-slate-100 text-slate-900' : 'text-slate-700 hover:bg-white'
              )}
              aria-pressed={isOverviewTabActive}
              onClick={() => setActiveMainTab('overview')}
            >
              <LayoutGrid className="h-4 w-4 shrink-0" />
              {!sidebarCollapsed ? <span>{t('总览', 'Overview')}</span> : null}
            </button>
          </div>
        </div>

        <div className={cn('flex min-h-0 flex-1 flex-col pb-4 pt-2', sidebarCollapsed ? 'px-2' : 'px-4')}>
          <div className="mb-2 flex items-center">
            {!sidebarCollapsed ? <p className="text-lg text-slate-400">{t('项目', 'Projects')}</p> : null}
            <div className={cn('flex items-center gap-1 text-slate-500', sidebarCollapsed ? 'mx-auto' : 'ml-auto')}>
              <button
                type="button"
                className="no-drag inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-white hover:text-slate-700"
                aria-label={t('新增项目', 'Add project')}
                onClick={() => void addProject()}
                disabled={loading}
                title={canOpenDirectoryDialog ? t('选择本地目录', 'Select local directory') : t('当前环境不支持目录选择器', 'Directory picker is unavailable in this environment')}
              >
                {loading ? <span className="text-xs">…</span> : <FolderPlus className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col space-y-1 overflow-y-auto">
            {projects.length === 0 ? (
              <p className={cn('rounded-lg border border-dashed border-slate-300 py-2 text-xs text-slate-500', sidebarCollapsed ? 'px-2 text-center' : 'px-3')}>
                {t('暂无项目', 'No projects')}
              </p>
            ) : (
              projects.map((project) => {
                const selected = selectedProjectId === project.id
                const label = getProjectLabel(project.path)
                return (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => {
                      selectProject(project.id)
                      setActiveMainTab('workspace')
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      setProjectContextMenu({
                        projectPath: project.path,
                        x: event.clientX,
                        y: event.clientY
                      })
                    }}
                    className={cn(
                      'no-drag flex w-full items-center rounded-lg px-3 py-2 text-left transition-colors',
                      sidebarCollapsed ? 'justify-center' : 'gap-2',
                      selected ? 'bg-white text-slate-900' : 'text-slate-500 hover:bg-white'
                    )}
                    title={project.path}
                  >
                    <FolderOpen className="h-4 w-4 shrink-0" />
                    {!sidebarCollapsed ? <span className="truncate text-sm">{label}</span> : null}
                  </button>
                )
              })
            )}
          </div>

          {projectContextMenu ? (
            <div
              className="fixed z-[70] min-w-[170px] rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl"
              style={{ left: projectContextMenu.x, top: projectContextMenu.y }}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className="flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100"
                onClick={() => void onRevealProjectInFinder(projectContextMenu.projectPath)}
              >
                {t('在Finder中查看', 'Reveal in Finder')}
              </button>
            </div>
          ) : null}

          <div className="mt-3">
            <button
              type="button"
              className={cn(
                'no-drag flex h-10 w-full items-center rounded-xl px-3 text-sm',
                sidebarCollapsed ? 'justify-center' : 'gap-2.5',
                activeMainTab === 'settings' ? 'bg-slate-100 text-slate-900' : 'text-slate-700 hover:bg-white'
              )}
              onClick={() => setActiveMainTab('settings')}
            >
              <Settings2 className="h-4 w-4 shrink-0" />
              {!sidebarCollapsed ? <span>{t('设置', 'Settings')}</span> : null}
            </button>
          </div>
        </div>
      </aside>
      <div
        role="separator"
        aria-label={t('调整侧边栏宽度', 'Adjust sidebar width')}
        aria-orientation="vertical"
        className={cn(
          'no-drag group relative h-full shrink-0 bg-[#f8f9fb]',
          sidebarCollapsed ? 'cursor-default' : 'cursor-col-resize',
          'w-[6px]'
        )}
        onPointerDown={onSidebarResizeStart}
      >
        <span
          className={cn(
            'pointer-events-none absolute inset-y-0 right-0 w-px transition-colors',
            isSidebarResizing ? 'bg-sky-400' : 'bg-slate-200 group-hover:bg-slate-300'
          )}
        />
      </div>

      <main className="relative flex h-full min-w-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col px-3 pb-4 pt-2 sm:px-4 md:px-6 md:pb-6">
          <div className="drag-region mb-1 h-6 shrink-0" />
          <header className="flex flex-wrap items-center justify-between gap-2">
            {activeMainTab === 'overview' || activeMainTab === 'settings' ? (
              <div className="flex w-full items-center" />
            ) : (
              <>
                <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1">
                  <button
                    type="button"
                    onClick={() => setActiveMainTab('collector')}
                    className={cn(
                      'rounded-md px-3 py-1.5 text-sm font-medium',
                      activeMainTab === 'collector' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    )}
                  >
                    {t('需求采集器', 'Requirement Collector')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveMainTab('workspace')
                      setActiveListType('requirement')
                    }}
                    className={cn(
                      'rounded-md px-3 py-1.5 text-sm font-medium',
                      activeMainTab === 'workspace' && activeListType === 'requirement'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    )}
                  >
                    {t('需求清单', 'Requirement List')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveMainTab('workspace')
                      setActiveListType('task')
                    }}
                    className={cn(
                      'rounded-md px-3 py-1.5 text-sm font-medium',
                      activeMainTab === 'workspace' && activeListType === 'task'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    )}
                  >
                    {t('任务清单', 'Task List')}
                  </button>
                </div>

                <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                  {showRequirementActions ? (
                    <>
                      <Button
                        size="sm"
                        className="h-8 rounded-lg bg-slate-900 px-3 text-xs text-white hover:bg-slate-800"
                        onClick={openCreateRequirementDialog}
                        disabled={loading || projects.length === 0}
                      >
                        {t('提需求', 'Create Requirement')}
                      </Button>
                    </>
                  ) : null}
                  {showTaskActions ? (
                    <Button
                      size="sm"
                      className="h-8 rounded-lg bg-slate-900 px-3 text-xs text-white hover:bg-slate-800"
                      onClick={openCreateTaskDialog}
                      disabled={loading || projects.length === 0}
                    >
                      {t('派任务', 'Create Task')}
                    </Button>
                  ) : null}
                </div>
              </>
            )}

            {isCreateRequirementDialogOpen ? (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
                <div className="w-full max-w-xl rounded-lg border border-slate-200 bg-white p-4 shadow-xl">
                  <div className="mb-3 flex items-center">
                    <h3 className="text-sm font-semibold text-slate-900">{t('提需求', 'Create Requirement')}</h3>
                  </div>

                  <div className="space-y-3">
                    <div className="space-y-1">
                      <p className="text-xs text-slate-500">{t('所属项目', 'Project')}</p>
                      <div className="relative">
                        <Select
                          value={createRequirementProjectId !== null ? String(createRequirementProjectId) : ''}
                          onValueChange={(value) => setCreateRequirementProjectId(Number(value))}
                          className="h-9 w-full appearance-none rounded-md border-slate-200 pr-9 text-sm"
                          disabled={loading || projects.length === 0}
                        >
                          {projects.length > 0 ? (
                            projects.map((project) => (
                              <SelectItem key={project.id} value={String(project.id)}>
                                {getProjectLabel(project.path)}
                              </SelectItem>
                            ))
                          ) : (
                            <SelectItem value="" disabled>
                              {t('暂无项目', 'No projects')}
                            </SelectItem>
                          )}
                        </Select>
                        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-slate-500">{t('需求描述', 'Requirement Description')}</p>
                      <Textarea
                        rows={6}
                        value={newRequirementContent}
                        onChange={(event) => setNewRequirementContent(event.target.value)}
                        placeholder={t('请输入需求描述', 'Please enter requirement description')}
                        disabled={loading}
                      />
                    </div>

                  </div>

                  <div className="mt-4 flex items-center justify-end gap-2">
                    <Button variant="outline" onClick={closeCreateRequirementDialog} disabled={loading}>
                      {t('取消', 'Cancel')}
                    </Button>
                    <Button onClick={() => void onCreateRequirementOnly()} disabled={!canSubmitRequirement}>
                      {t('确认', 'Confirm')}
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            {isCreateTaskDialogOpen ? (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
                <div className="w-full max-w-xl rounded-lg border border-slate-200 bg-white p-4 shadow-xl">
                  <div className="mb-3 flex items-center">
                    <h3 className="text-sm font-semibold text-slate-900">{t('派任务', 'Create Task')}</h3>
                  </div>

                  <div className="space-y-3">
                    <div className="space-y-1">
                      <p className="text-xs text-slate-500">{t('所属项目', 'Project')}</p>
                      <div className="relative">
                        <Select
                          value={createTaskProjectId !== null ? String(createTaskProjectId) : ''}
                          onValueChange={(value) => setCreateTaskProjectId(Number(value))}
                          className="h-9 w-full appearance-none rounded-md border-slate-200 pr-9 text-sm"
                          disabled={loading || projects.length === 0}
                        >
                          {projects.length > 0 ? (
                            projects.map((project) => (
                              <SelectItem key={project.id} value={String(project.id)}>
                                {getProjectLabel(project.path)}
                              </SelectItem>
                            ))
                          ) : (
                            <SelectItem value="" disabled>
                              {t('暂无项目', 'No projects')}
                            </SelectItem>
                          )}
                        </Select>
                        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-slate-500">{t('任务描述', 'Task Description')}</p>
                      <Textarea
                        rows={6}
                        value={newTaskContent}
                        onChange={(event) => setNewTaskContent(event.target.value)}
                        placeholder={t('请输入任务描述', 'Please enter task description')}
                        disabled={loading}
                      />
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-end gap-2">
                    <Button variant="outline" onClick={closeCreateTaskDialog} disabled={loading}>
                      {t('取消', 'Cancel')}
                    </Button>
                    <Button onClick={() => void onCreateTaskOnly()} disabled={!canSubmitTask}>
                      {t('确认', 'Confirm')}
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            {artifactModalOpen ? (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
                <div className="flex h-[82vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
                  <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/80 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{artifactModalFileName || t('产物详情', 'Artifact Details')}</p>
                      <p className="text-xs text-slate-500">{t('任务产物预览', 'Task Artifact Preview')}</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={closeArtifactModal}>
                      {t('关闭', 'Close')}
                    </Button>
                  </div>

                  <div className="min-h-0 flex-1 overflow-auto bg-white p-4">
                    {artifactModalLoading ? (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">{t('加载中...', 'Loading...')}</div>
                    ) : artifactModalError ? (
                      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{artifactModalError}</div>
                    ) : artifactModalFileName.endsWith('.md') ? (
                      <div className="space-y-3">{renderMarkdown(artifactModalContent)}</div>
                    ) : artifactModalFileName.endsWith('.json') ? (
                      (() => {
                        try {
                          const parsed = JSON.parse(artifactModalContent || '{}') as unknown
                          const fields = flattenJsonFields(parsed)
                          return (
                            <div className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-3">
                              {fields.map((field) => (
                                <div key={field.path} className="flex flex-wrap items-start gap-2 text-sm">
                                  <span className="rounded bg-slate-200/80 px-1.5 py-0.5 font-mono text-xs text-slate-700">{field.path}</span>
                                  <span className="min-w-0 whitespace-pre-wrap break-words text-slate-800">{field.value}</span>
                                </div>
                              ))}
                            </div>
                          )
                        } catch {
                          return (
                            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                              {t('JSON 解析失败，以下为原始内容：', 'JSON parse failed, raw content below:')}
                              <pre className="mt-2 max-h-[58vh] overflow-auto whitespace-pre-wrap break-words text-xs text-amber-900">{artifactModalContent || t('(空内容)', '(empty)')}</pre>
                            </div>
                          )
                        }
                      })()
                    ) : (
                      <pre className="max-h-[64vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800">
                        {artifactModalContent || t('(空内容)', '(empty)')}
                      </pre>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            {taskStageTraceModal.open ? (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
                <div className="flex h-[82vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
                  <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/80 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{taskStageTraceModal.stageLabel || t('节点详情', 'Node Details')}</p>
                      <p className="text-xs text-slate-500">{t('Agent 多轮工具调用消息', 'Agent multi-round tool call messages')}</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={closeTaskStageTraceModal}>
                      {t('关闭', 'Close')}
                    </Button>
                  </div>

                  <div
                    ref={requirementStageTraceMessagesContainerRef}
                    className={cn(
                      'min-h-0 flex-1 space-y-3 overflow-y-auto bg-[radial-gradient(circle_at_top,_rgba(241,245,249,0.8),_rgba(248,250,252,0.95)_42%,_rgba(255,255,255,1)_100%)] p-4',
                      taskTraceIsWaitingHumanMode ? 'pb-1' : null
                    )}
                  >
                    {taskStageTraceModal.loading && !shouldShowTaskTraceToolWaitingDots ? (
                      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500">{t('加载中...', 'Loading...')}</div>
                    ) : taskStageTraceModal.error ? (
                      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{taskStageTraceModal.error}</div>
                    ) : taskStageTraceDisplayItems.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-sm text-slate-500">{t('暂无可展示消息', 'No messages to display')}</div>
                    ) : (
                      (() => {
                        let toolPairIndex = 0
                        return taskStageTraceDisplayItems.map((item) => {
                        if (item.kind === 'paired_tool' && item.toolUse) {
                          toolPairIndex += 1
                          const useMsg = item.toolUse
                          const isTodoWriteTool = (useMsg.toolName?.trim().toLowerCase() ?? '') === 'todowrite'
                          const todoItems = isTodoWriteTool ? parseTodoWriteItems(useMsg) : []
                          const resultMsg = item.toolResult
                          const isLoading = !resultMsg
                          const isFailed = Boolean(resultMsg && (resultMsg.isError || resultMsg.role === 'system'))
                          return (
                            <div key={item.id} className="flex justify-start">
                              <div className="grid w-full max-w-[72%] grid-cols-[minmax(0,1.45fr)_minmax(154px,0.62fr)] gap-2">
                                <div className="min-w-0">
                                  <button
                                    type="button"
                                    className={cn(
                                      'w-full rounded-2xl border px-3.5 py-2.5 text-left text-sm shadow-sm transition',
                                      isTodoWriteTool
                                        ? 'border-sky-200 bg-sky-50 text-sky-900 hover:bg-sky-100'
                                        : 'border-indigo-200 bg-indigo-50 text-indigo-900 hover:bg-indigo-100'
                                    )}
                                    onClick={() =>
                                      openTaskTraceDetailModal({
                                        title: `Tool #${toolPairIndex}${useMsg.toolName ? ` · ${useMsg.toolName}` : ''}`,
                                        subtitle: 'tool_use',
                                        content: useMsg.content || '(empty)'
                                      })
                                    }
                                  >
                                    <div className="mb-2 flex items-center gap-1.5 whitespace-nowrap">
                                      <span
                                        className={cn(
                                          'rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-[0.06em]',
                                          isTodoWriteTool ? 'bg-sky-100 text-sky-800' : 'bg-indigo-100 text-indigo-800'
                                        )}
                                      >
                                        {`Tool #${toolPairIndex}`}
                                      </span>
                                      <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-slate-700">
                                        {useMsg.toolName || 'tool'}
                                      </span>
                                    </div>
                                    {isTodoWriteTool && todoItems.length > 0 ? (
                                      <div className="space-y-1.5">
                                        {todoItems.map((todo, todoIndex) => {
                                          const meta = getTodoStatusMeta(todo.status)
                                          return (
                                            <div
                                              key={`${item.id}-todo-${todoIndex}`}
                                              className={cn('flex items-start gap-2 rounded-lg border px-2 py-1.5', meta.rowClassName)}
                                            >
                                              <span className={cn('mt-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium', meta.badgeClassName)}>
                                                {meta.label}
                                              </span>
                                              <span className="min-w-0 flex-1 break-words text-xs leading-5">{todo.content}</span>
                                            </div>
                                          )
                                        })}
                                      </div>
                                    ) : (
                                      <p className="whitespace-nowrap overflow-hidden text-ellipsis">{summarizeToolUse(useMsg)}</p>
                                    )}
                                  </button>
                                </div>
                                <div className="min-w-0">
                                  <button
                                    type="button"
                                    className={cn(
                                      'w-full rounded-2xl border px-3.5 py-2.5 text-left text-sm shadow-sm transition',
                                      isLoading
                                        ? 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
                                        : isFailed
                                          ? 'border-red-200 bg-red-50 text-red-800 hover:bg-red-100'
                                        : 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                                    )}
                                    onClick={() =>
                                      openTaskTraceDetailModal({
                                        title: `Tool #${toolPairIndex} Result`,
                                        subtitle: isLoading ? 'tool_result (pending)' : 'tool_result',
                                        content: resultMsg?.content || 'No tool_result yet. This tool call is still running.'
                                      })
                                    }
                                  >
                                    <div className="mb-2 flex flex-wrap items-center gap-1.5">
                                      <span
                                        className={cn(
                                          'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]',
                                          isLoading
                                            ? 'bg-amber-100 text-amber-800'
                                            : isFailed
                                              ? 'bg-red-100 text-red-800'
                                              : 'bg-emerald-100 text-emerald-800'
                                        )}
                                      >
                                        {isLoading ? 'Running' : isFailed ? 'Failed' : 'Success'}
                                      </span>
                                    </div>
                                    {isLoading ? (
                                      <div className="inline-flex items-center gap-2 whitespace-nowrap overflow-hidden text-ellipsis">
                                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                        <span>{summarizeToolResult(resultMsg)}</span>
                                      </div>
                                    ) : (
                                      <p className="whitespace-nowrap overflow-hidden text-ellipsis">{summarizeToolResult(resultMsg)}</p>
                                    )}
                                  </button>
                                </div>
                              </div>
                            </div>
                          )
                        }

                        const message = item.message!
                        const messageTypeLabel = getTaskTraceTypeLabel(message.messageType)
                        const hideTextTypeTagForHumanRole =
                          (message.role === 'user' || message.role === 'assistant') && messageTypeLabel === 'text'
                        return (
                          <div key={item.id} className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}>
                            <div
                              className={cn(
                                'max-w-[92%] whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-2xl px-3.5 py-2.5 text-sm leading-6 shadow-sm',
                                message.role === 'user'
                                  ? 'border border-sky-200 bg-sky-50 text-sky-900'
                                  : message.role === 'assistant'
                                    ? 'border border-slate-200 bg-white text-slate-800'
                                    : message.role === 'tool'
                                      ? 'border border-indigo-200 bg-indigo-50 text-indigo-900'
                                      : 'border border-amber-200 bg-amber-50 text-amber-800'
                              )}
                            >
                              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                                <span
                                  className={cn(
                                    'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]',
                                    message.role === 'user'
                                      ? 'bg-sky-100 text-sky-800'
                                      : message.role === 'assistant'
                                        ? 'bg-slate-100 text-slate-700'
                                        : message.role === 'tool'
                                          ? 'bg-indigo-100 text-indigo-800'
                                          : 'bg-amber-100 text-amber-800'
                                  )}
                                >
                                  {getTaskTraceRoleLabel(message.role)}
                                </span>
                                {hideTextTypeTagForHumanRole ? null : (
                                  <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-slate-700">
                                    {messageTypeLabel}
                                  </span>
                                )}
                              </div>
                              {message.role === 'assistant' ? (
                                <div className="space-y-2">{renderMarkdown(message.content)}</div>
                              ) : (
                                message.content
                              )}
                            </div>
                          </div>
                        )
                      })
                      })()
                    )}
                    {shouldShowTaskTraceToolWaitingDots ? (
                      <div className="flex justify-start">
                        <div className="inline-flex items-center px-1 py-1">
                          <div className="dot-scale-loader" aria-label={t('工具调用中', 'Tool call running')}>
                            <span />
                            <span />
                            <span />
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  {taskTraceIsWaitingHumanMode ? (
                    <div className="border-t border-amber-200 bg-amber-50/40 px-4 py-3">
                      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        {t('发送补充信息时任务会保持等待人工状态，只有点击“确认进入下一阶段”才会继续流转。', 'Sending supplemental information keeps the task in waiting-human status. Only clicking "Confirm Next Stage" will continue the flow.')}
                      </div>
                      {taskHumanConversationError ? (
                        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{taskHumanConversationError}</div>
                      ) : null}
                      <div className="mt-2 space-y-2">
                        <Textarea
                          rows={3}
                          ref={requirementHumanInputRef}
                          value={taskHumanInput}
                          onChange={(event) => setTaskHumanInput(event.target.value)}
                          placeholder={t('输入补充说明，Agent 会在当前执行节点继续修正产物。', 'Enter supplemental instructions. Agent will keep refining artifacts in the current stage.')}
                          disabled={loading || taskHumanConversationLoading}
                        />
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8"
                            onClick={() => void onSendTaskHumanConversation()}
                            disabled={loading || taskHumanConversationLoading || !taskHumanInput.trim()}
                          >
                            {t('发送补充', 'Send Supplement')}
                          </Button>
                          <Button
                            size="sm"
                            className="h-8"
                            onClick={() => void onConfirmTaskHuman()}
                            disabled={loading || taskHumanConversationLoading}
                          >
                            {t('确认进入下一阶段', 'Confirm Next Stage')}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {requirementStageTraceModal.open ? (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
                <div className="flex h-[82vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
                  <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/80 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{requirementStageTraceModal.stageLabel || t('节点详情', 'Node Details')}</p>
                      <p className="text-xs text-slate-500">{t('Agent 多轮工具调用消息', 'Agent multi-round tool call messages')}</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={closeRequirementStageTraceModal}>
                      {t('关闭', 'Close')}
                    </Button>
                  </div>

                  <div
                    ref={taskStageTraceMessagesContainerRef}
                    className={cn(
                      'min-h-0 flex-1 space-y-3 overflow-y-auto bg-[radial-gradient(circle_at_top,_rgba(241,245,249,0.8),_rgba(248,250,252,0.95)_42%,_rgba(255,255,255,1)_100%)] p-4',
                      requirementTraceIsWaitingHumanMode ? 'pb-1' : null
                    )}
                  >
                    {requirementStageTraceModal.loading && !shouldShowRequirementTraceToolWaitingDots ? (
                      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500">{t('加载中...', 'Loading...')}</div>
                    ) : requirementStageTraceModal.error ? (
                      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{requirementStageTraceModal.error}</div>
                    ) : requirementStageTraceDisplayItems.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-sm text-slate-500">{t('暂无可展示消息', 'No messages to display')}</div>
                    ) : (
                      (() => {
                        let toolPairIndex = 0
                        return requirementStageTraceDisplayItems.map((item) => {
                        if (item.kind === 'paired_tool' && item.toolUse) {
                          toolPairIndex += 1
                          const useMsg = item.toolUse
                          const isTodoWriteTool = (useMsg.toolName?.trim().toLowerCase() ?? '') === 'todowrite'
                          const todoItems = isTodoWriteTool ? parseTodoWriteItems(useMsg) : []
                          const resultMsg = item.toolResult
                          const isLoading = !resultMsg
                          const isFailed = Boolean(resultMsg && (resultMsg.isError || resultMsg.role === 'system'))
                          return (
                            <div key={item.id} className="flex justify-start">
                              <div className="grid w-full max-w-[72%] grid-cols-[minmax(0,1.45fr)_minmax(154px,0.62fr)] gap-2">
                                <div className="min-w-0">
                                  <button
                                    type="button"
                                    className={cn(
                                      'w-full rounded-2xl border px-3.5 py-2.5 text-left text-sm shadow-sm transition',
                                      isTodoWriteTool
                                        ? 'border-sky-200 bg-sky-50 text-sky-900 hover:bg-sky-100'
                                        : 'border-indigo-200 bg-indigo-50 text-indigo-900 hover:bg-indigo-100'
                                    )}
                                    onClick={() =>
                                      openTaskTraceDetailModal({
                                        title: `Tool #${toolPairIndex}${useMsg.toolName ? ` · ${useMsg.toolName}` : ''}`,
                                        subtitle: 'tool_use',
                                        content: useMsg.content || '(empty)'
                                      })
                                    }
                                  >
                                    <div className="mb-2 flex items-center gap-1.5 whitespace-nowrap">
                                      <span
                                        className={cn(
                                          'rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-[0.06em]',
                                          isTodoWriteTool ? 'bg-sky-100 text-sky-800' : 'bg-indigo-100 text-indigo-800'
                                        )}
                                      >
                                        {`Tool #${toolPairIndex}`}
                                      </span>
                                      <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-slate-700">
                                        {useMsg.toolName || 'tool'}
                                      </span>
                                    </div>
                                    {isTodoWriteTool && todoItems.length > 0 ? (
                                      <div className="space-y-1.5">
                                        {todoItems.map((todo, todoIndex) => {
                                          const meta = getTodoStatusMeta(todo.status)
                                          return (
                                            <div
                                              key={`${item.id}-todo-${todoIndex}`}
                                              className={cn('flex items-start gap-2 rounded-lg border px-2 py-1.5', meta.rowClassName)}
                                            >
                                              <span className={cn('mt-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium', meta.badgeClassName)}>
                                                {meta.label}
                                              </span>
                                              <span className="min-w-0 flex-1 break-words text-xs leading-5">{todo.content}</span>
                                            </div>
                                          )
                                        })}
                                      </div>
                                    ) : (
                                      <p className="whitespace-nowrap overflow-hidden text-ellipsis">{summarizeToolUse(useMsg)}</p>
                                    )}
                                  </button>
                                </div>
                                <div className="min-w-0">
                                  <button
                                    type="button"
                                    className={cn(
                                      'w-full rounded-2xl border px-3.5 py-2.5 text-left text-sm shadow-sm transition',
                                      isLoading
                                        ? 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
                                        : isFailed
                                          ? 'border-red-200 bg-red-50 text-red-800 hover:bg-red-100'
                                        : 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                                    )}
                                    onClick={() =>
                                      openTaskTraceDetailModal({
                                        title: `Tool #${toolPairIndex} Result`,
                                        subtitle: isLoading ? 'tool_result (pending)' : 'tool_result',
                                        content: resultMsg?.content || 'No tool_result yet. This tool call is still running.'
                                      })
                                    }
                                  >
                                    <div className="mb-2 flex flex-wrap items-center gap-1.5">
                                      <span
                                        className={cn(
                                          'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]',
                                          isLoading
                                            ? 'bg-amber-100 text-amber-800'
                                            : isFailed
                                              ? 'bg-red-100 text-red-800'
                                              : 'bg-emerald-100 text-emerald-800'
                                        )}
                                      >
                                        {isLoading ? 'Running' : isFailed ? 'Failed' : 'Success'}
                                      </span>
                                    </div>
                                    {isLoading ? (
                                      <div className="inline-flex items-center gap-2 whitespace-nowrap overflow-hidden text-ellipsis">
                                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                        <span>{summarizeToolResult(resultMsg)}</span>
                                      </div>
                                    ) : (
                                      <p className="whitespace-nowrap overflow-hidden text-ellipsis">{summarizeToolResult(resultMsg)}</p>
                                    )}
                                  </button>
                                </div>
                              </div>
                            </div>
                          )
                        }

                        const message = item.message!
                        const messageTypeLabel = getTaskTraceTypeLabel(message.messageType)
                        const hideTextTypeTagForHumanRole =
                          (message.role === 'user' || message.role === 'assistant') && messageTypeLabel === 'text'
                        return (
                          <div key={item.id} className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}>
                            <div
                              className={cn(
                                'max-w-[92%] whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-2xl px-3.5 py-2.5 text-sm leading-6 shadow-sm',
                                message.role === 'user'
                                  ? 'border border-sky-200 bg-sky-50 text-sky-900'
                                  : message.role === 'assistant'
                                    ? 'border border-slate-200 bg-white text-slate-800'
                                    : message.role === 'tool'
                                      ? 'border border-indigo-200 bg-indigo-50 text-indigo-900'
                                      : 'border border-amber-200 bg-amber-50 text-amber-800'
                              )}
                            >
                              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                                <span
                                  className={cn(
                                    'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]',
                                    message.role === 'user'
                                      ? 'bg-sky-100 text-sky-800'
                                      : message.role === 'assistant'
                                        ? 'bg-slate-100 text-slate-700'
                                        : message.role === 'tool'
                                          ? 'bg-indigo-100 text-indigo-800'
                                          : 'bg-amber-100 text-amber-800'
                                  )}
                                >
                                  {getTaskTraceRoleLabel(message.role)}
                                </span>
                                {hideTextTypeTagForHumanRole ? null : (
                                  <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-slate-700">
                                    {messageTypeLabel}
                                  </span>
                                )}
                              </div>
                              {message.role === 'assistant' ? (
                                <div className="space-y-2">{renderMarkdown(message.content)}</div>
                              ) : (
                                message.content
                              )}
                            </div>
                          </div>
                        )
                      })
                      })()
                    )}
                    {shouldShowRequirementTraceToolWaitingDots ? (
                      <div className="flex justify-start">
                        <div className="inline-flex items-center px-1 py-1">
                          <div className="dot-scale-loader" aria-label={t('工具调用中', 'Tool call running')}>
                            <span />
                            <span />
                            <span />
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {requirementTraceIsWaitingHumanMode ? (
                    <div className="border-t border-amber-200 bg-amber-50/40 px-4 py-3">
                      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        {t('发送补充信息时需求会保持等待人工状态，只有点击“确认进入下一阶段”才会继续流转。', 'Sending supplemental information keeps the requirement in waiting-human status. Only clicking "Confirm Next Stage" will continue the flow.')}
                      </div>
                      {requirementHumanConversationError ? (
                        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{requirementHumanConversationError}</div>
                      ) : null}
                      <div className="mt-2 space-y-2">
                        <Textarea
                          rows={3}
                          ref={taskHumanInputRef}
                          value={requirementHumanInput}
                          onChange={(event) => setRequirementHumanInput(event.target.value)}
                          placeholder={t('输入补充说明，Agent 会在当前执行节点继续修正产物。', 'Enter supplemental instructions. Agent will keep refining artifacts in the current stage.')}
                          disabled={loading || requirementHumanConversationLoading}
                        />
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8"
                            onClick={() => void onSendRequirementHumanConversation()}
                            disabled={loading || requirementHumanConversationLoading || !requirementHumanInput.trim()}
                          >
                            {t('发送补充', 'Send Supplement')}
                          </Button>
                          <Button
                            size="sm"
                            className="h-8"
                            onClick={() => void onConfirmRequirementHuman()}
                            disabled={loading || requirementHumanConversationLoading}
                          >
                            {t('确认进入下一阶段', 'Confirm Next Stage')}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {taskTraceDetailModal.open ? (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4">
                <div className="flex h-[72vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
                  <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/80 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{taskTraceDetailModal.title}</p>
                      <p className="text-xs text-slate-500">{taskTraceDetailModal.subtitle}</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={closeTaskTraceDetailModal}>
                      {t('关闭', 'Close')}
                    </Button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto p-4">
                    {(() => {
                      const raw = taskTraceDetailModal.content || ''
                      const parsed = parseJsonFromMixedText(raw)
                      if (parsed && typeof parsed === 'object') {
                        const record = parsed as Record<string, unknown>
                        const todoGroups: Array<{ title: string; items: TodoWriteItem[] }> = [
                          { title: 'Todos', items: extractTodoWriteItems(record.todos) },
                          { title: 'New Todos', items: extractTodoWriteItems(record.newTodos) },
                          { title: 'Old Todos', items: extractTodoWriteItems(record.oldTodos) }
                        ].filter((group) => group.items.length > 0)

                        if (todoGroups.length > 0) {
                          return (
                            <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                              {todoGroups.map((group) => (
                                <div key={group.title} className="space-y-1.5">
                                  <p className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">{group.title}</p>
                                  <div className="space-y-1.5">
                                    {group.items.map((todo, index) => {
                                      const meta = getTodoStatusMeta(todo.status)
                                      return (
                                        <div key={`${group.title}-${index}`} className={cn('flex items-start gap-2 rounded-lg border px-2.5 py-2', meta.rowClassName)}>
                                          <span className={cn('mt-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium', meta.badgeClassName)}>
                                            {meta.label}
                                          </span>
                                          <span className="min-w-0 flex-1 break-words text-xs leading-5">{todo.content}</span>
                                        </div>
                                      )
                                    })}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )
                        }

                        const fields = flattenJsonFields(parsed)
                        return (
                          <div className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-3">
                            {fields.map((field) => (
                              <div key={field.path} className="flex flex-wrap items-start gap-2 text-sm">
                                <span className="rounded bg-slate-200/80 px-1.5 py-0.5 font-mono text-xs text-slate-700">{field.path}</span>
                                <span className="min-w-0 whitespace-pre-wrap break-words text-slate-800">{field.value}</span>
                              </div>
                            ))}
                          </div>
                        )
                      }

                      return (
                        <pre className="min-h-full whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800">
                          {raw || t('(empty)', '(empty)')}
                        </pre>
                      )
                    })()}
                  </div>
                </div>
              </div>
            ) : null}

            {clarifyRequirementItem ? (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
                <div className="flex h-[80vh] w-full max-w-3xl flex-col rounded-lg border border-slate-200 bg-white shadow-xl">
                  <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">{isClarifyDialogReadonly ? t('查看详情', 'View Details') : t('人工对齐', 'Human Alignment')}</h3>
                      <p className="mt-0.5 text-xs text-slate-500">{t('需求', 'Requirement')} #{clarifyRequirementItem.id} · {clarifyRequirementItem.title}</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={closeClarifyDialog} disabled={!isClarifyDialogReadonly && loading}>
                      {t('关闭', 'Close')}
                    </Button>
                  </div>

                  <div
                    ref={clarifyMessagesContainerRef}
                    className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[radial-gradient(circle_at_top,_rgba(241,245,249,0.75),_rgba(248,250,252,0.92)_42%,_rgba(255,255,255,0.98)_100%)] p-4"
                  >
                    {shouldShowSessionLoading ? (
                      <div className="flex h-full min-h-[160px] items-center justify-center">
                        <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 shadow-sm">
                          <LoaderCircle className="h-4 w-4 animate-spin text-blue-600" />
                          {t('正在通过 Session ID 召回对话...', 'Restoring conversation via Session ID...')}
                        </div>
                      </div>
                    ) : (
                      <>
                        {clarifyMessages.map((message) => (
                          <div
                            key={message.id}
                            className={cn('flex items-end gap-2.5', message.role === 'user' ? 'justify-end' : 'justify-start')}
                          >
                            {message.role === 'user' ? null : (
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-blue-100 bg-gradient-to-br from-blue-50 to-cyan-50 text-blue-600 shadow-sm">
                                <Bot className="h-4 w-4" />
                              </div>
                            )}
                            <div
                              className={cn(
                                'max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-6 shadow-sm',
                                message.role === 'user'
                                  ? 'border border-sky-200 bg-sky-50 text-sky-900 shadow-[0_8px_20px_-14px_rgba(14,116,144,0.35)]'
                                  : message.role === 'assistant'
                                    ? 'border border-slate-200/90 bg-white/95 text-slate-800 backdrop-blur'
                                    : 'border border-amber-200 bg-amber-50 text-amber-700'
                              )}
                            >
                              {renderConversationMessageContent(message)}
                            </div>
                            {message.role === 'user' ? (
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-sky-200 bg-sky-50 text-sky-700 shadow-sm">
                                <UserRound className="h-4 w-4" />
                              </div>
                            ) : null}
                          </div>
                        ))}
                        {shouldShowThinkingIndicator ? (
                          <div className="flex items-end gap-2.5 justify-start">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-blue-100 bg-gradient-to-br from-blue-50 to-cyan-50 text-blue-600 shadow-sm">
                              <Bot className="h-4 w-4" />
                            </div>
                            <div className="inline-flex items-center gap-2 rounded-2xl border border-slate-200/90 bg-white/95 px-3.5 py-2.5 text-sm text-slate-700 shadow-sm">
                              <LoaderCircle className="h-4 w-4 animate-spin text-blue-600" />
                              {t('Agent 思考中...', 'Agent is thinking...')}
                            </div>
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>

                  {isClarifyDialogReadonly ? null : (
                    <div className="border-t border-slate-200 bg-white p-4">
                      {isClarifyQueued ? (
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm text-emerald-700">{t('需求已澄清并入队。', 'Requirement has been clarified and queued.')}</p>
                          <Button onClick={closeClarifyDialog}>{t('需求已入队', 'Requirement Queued')}</Button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <Textarea
                            rows={3}
                            value={clarifyInput}
                            onChange={(event) => setClarifyInput(event.target.value)}
                            placeholder={t('请输入补充信息，发送后将继续由 Agent 判断是否已澄清。', 'Please enter supplemental information. After sending, Agent will continue checking whether clarification is complete.')}
                            disabled={loading}
                          />
                          <div className="flex justify-end">
                            <Button onClick={() => void onSendClarify()} disabled={!canSendClarify}>
                              {loading ? t('处理中...', 'Processing...') : t('发送', 'Send')}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : null}

          </header>

          {activeMainTab === 'overview' || activeMainTab === 'settings' ? null : (
            <div className="mx-auto mt-6 grid w-full max-w-6xl grid-cols-3 gap-3 md:mt-8">
              {DISCOVERY_CARDS.map((card) => {
              const isRequirementProcessorRunner = card.id === REQUIREMENT_PROCESSOR_RUNNER_ID
              const isTaskExecutorRunner = card.id === TASK_EXECUTOR_RUNNER_ID
              const isRunning = isRequirementProcessorRunner
                ? autoProcessorRunning
                : isTaskExecutorRunner
                  ? taskAutoProcessorRunning
                  : runnerEnabledById[card.id]
              const isToggleDisabled = isRequirementProcessorRunner
                ? !canToggleAutoProcessor
                : isTaskExecutorRunner
                  ? !canToggleTaskAutoProcessor
                  : false
              const isToggleLoading = isRequirementProcessorRunner
                ? autoProcessorLoading
                : isTaskExecutorRunner
                  ? taskAutoProcessorLoading
                  : false
              const runnerStatsText = isRequirementProcessorRunner
                ? t(`已处理：${requirementProcessedCount}个，处理中：${requirementProcessingCount}个`, `Processed: ${requirementProcessedCount}, Running: ${requirementProcessingCount}`)
                : isTaskExecutorRunner
                  ? t(`已执行：${taskProcessedCount}个，执行中：${taskProcessingCount}个`, `Executed: ${taskProcessedCount}, Running: ${taskProcessingCount}`)
                  : ''
              const runnerDurationText = isRequirementProcessorRunner
                ? requirementRunnerDurationText
                : isTaskExecutorRunner
                  ? taskRunnerDurationText
                  : ''
              return (
                <div
                  key={card.id}
                  className={cn(
                    'group relative flex min-h-[132px] min-w-0 flex-col rounded-[18px] border px-4 py-4 text-left transition',
                    isRunning
                      ? 'border-slate-200 bg-white shadow-[0_8px_24px_-16px_rgba(16,185,129,0.7)]'
                      : 'border-slate-200 bg-white shadow-[0_1px_0_rgba(15,23,42,0.04)] hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_10px_24px_-16px_rgba(15,23,42,0.35)]'
                  )}
                >
                  {isRunning ? (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 rounded-[18px] ring-1 ring-slate-200/80 ring-inset animate-pulse"
                    />
                  ) : null}
                  <button
                    type="button"
                    aria-pressed={isRunning}
                    aria-label={`${language === 'en-US' ? card.titleEn : card.titleZh} ${isRunning ? 'running' : 'stopped'}`}
                    disabled={isToggleDisabled}
                    onClick={(event) => {
                      event.stopPropagation()
                      if (isRequirementProcessorRunner) {
                        if (!canToggleAutoProcessor) {
                          return
                        }
                        void toggleAutoProcessor()
                        return
                      }
                      if (isTaskExecutorRunner) {
                        if (!canToggleTaskAutoProcessor) {
                          return
                        }
                        void toggleTaskProcessor()
                        return
                      }
                      setRunnerEnabledById((prev) => ({ ...prev, [card.id]: !prev[card.id] }))
                    }}
                    className={cn(
                      'absolute right-3 top-3 flex h-5 w-9 items-center rounded-full p-0.5 transition',
                      isToggleDisabled ? 'cursor-not-allowed opacity-50' : '',
                      isRunning ? 'bg-emerald-500' : 'bg-slate-300'
                    )}
                  >
                    <span
                      className={cn(
                        'h-4 w-4 rounded-full bg-white shadow-sm transition',
                        isRunning ? 'translate-x-4' : 'translate-x-0',
                        isToggleLoading ? 'animate-pulse' : ''
                      )}
                    />
                  </button>
                  <span className="text-lg leading-none">{card.icon}</span>
                  <h2 className="mt-3 truncate pr-11 text-sm font-semibold tracking-tight text-slate-900">
                    {language === 'en-US' ? card.titleEn : card.titleZh}
                  </h2>
                  <p className={cn('mt-1.5 inline-flex items-center gap-1.5 text-xs font-semibold leading-4', isRunning ? 'text-emerald-700' : 'text-slate-500')}>
                    <span
                      className={cn(
                        'h-1.5 w-1.5 rounded-full',
                        isRunning ? 'bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.18)] animate-pulse' : 'bg-slate-400'
                      )}
                    />
                    {isRunning ? t('running', 'running') : t('stopped', 'stopped')}
                  </p>
                  {isRunning && runnerStatsText ? (
                    <p className="mt-1 text-[11px] leading-4 text-slate-500">{runnerStatsText}</p>
                  ) : null}
                  {isRunning && runnerDurationText ? (
                    <p className="mt-1 text-[11px] leading-4 text-slate-500">{t('已运行', 'Running for')}: {runnerDurationText}</p>
                  ) : null}
                </div>
              )
            })}
              {error ? <p className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-600">{error}</p> : null}
            </div>
          )}

          <div className="mx-auto mt-4 min-h-0 w-full max-w-6xl flex-1">
            {activeMainTab === 'overview' ? (
              <div className="flex h-full flex-col p-1">
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-slate-900">{t('需求处理Runner总览', 'Requirement Processor Runner Overview')}</h3>
                  <p className="mt-1 text-xs text-slate-500">{t('该页展示需求与任务运行规模，以及 Agent 处理时长统计。', 'This page shows requirement/task execution scale and Agent duration metrics.')}</p>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {overviewCards.map((card) => (
                    <div
                      key={card.id}
                      className="group relative flex min-h-[132px] min-w-0 flex-col rounded-[18px] border border-slate-200 bg-white px-4 py-4 text-left shadow-[0_1px_0_rgba(15,23,42,0.04)] transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_10px_24px_-16px_rgba(15,23,42,0.35)]"
                    >
                      <h2 className="truncate text-sm font-semibold tracking-tight text-slate-900">{card.title}</h2>
                      <p className="mt-3 text-[28px] font-semibold leading-8 tracking-tight text-slate-900">{card.value}</p>
                      <p className="mt-2 text-xs leading-4 text-slate-500">{card.subtitle}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : activeMainTab === 'settings' ? (
              <div className="flex h-full items-start justify-center rounded-lg border border-slate-200 bg-white p-6">
                <div className="w-full max-w-2xl space-y-6">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">{t('设置', 'Settings')}</h3>
                    <p className="mt-1 text-sm text-slate-500">{t('在这里配置应用显示语言。', 'Configure app display language here.')}</p>
                  </div>
                  <div className="space-y-3 rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 via-white to-slate-50/70 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
                    <p className="text-xs font-medium tracking-wide text-slate-600">{t('显示语言', 'Display Language')}</p>
                    <div className="max-w-sm space-y-2">
                      <div className="relative">
                        <Select
                          value={language}
                          onValueChange={(value) => {
                            if (value === 'zh-CN' || value === 'en-US') {
                              setLanguage(value)
                            }
                          }}
                          className="h-11 w-full appearance-none rounded-lg border-slate-300 bg-white pr-10 text-sm text-slate-800 shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition-all hover:border-slate-400 focus-visible:ring-sky-500 focus-visible:ring-offset-0"
                        >
                          <SelectItem value="zh-CN">{t('简体中文', '简体中文')}</SelectItem>
                          <SelectItem value="en-US">English</SelectItem>
                        </Select>
                        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                      </div>
                      <p className="text-[11px] text-slate-500">
                        {language === 'zh-CN' ? t('当前选择：简体中文', 'Current: Simplified Chinese') : t('当前选择：English', 'Current: English')}
                      </p>
                    </div>
                    <p className="text-xs leading-5 text-slate-500">
                      {t('语言设置会保存在本地，下次打开应用自动生效。', 'Language preference is stored locally and applied automatically next time.')}
                    </p>
                  </div>
                  <div className="space-y-3 rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 via-white to-slate-50/70 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
                    <p className="text-xs font-medium tracking-wide text-slate-600">{t('Agent SDK', 'Agent SDK')}</p>
                    <div className="max-w-sm space-y-2">
                      <div className="relative">
                        <Select
                          value={agentSdkType}
                          disabled={agentSdkLoading}
                          onValueChange={(value) => {
                            void handleAgentSdkChange(value)
                          }}
                          className="h-11 w-full appearance-none rounded-lg border-slate-300 bg-white pr-10 text-sm text-slate-800 shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition-all hover:border-slate-400 focus-visible:ring-sky-500 focus-visible:ring-offset-0 disabled:opacity-60"
                        >
                          <SelectItem value="claude">Claude Agent SDK</SelectItem>
                          <SelectItem value="codex">Codex SDK</SelectItem>
                        </Select>
                        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                      </div>
                      <p className="text-[11px] text-slate-500">
                        {agentSdkType === 'claude'
                          ? t('当前选择：Claude Agent SDK', 'Current: Claude Agent SDK')
                          : t('当前选择：Codex SDK', 'Current: Codex SDK')}
                      </p>
                      {agentSdkError ? <p className="text-[11px] text-red-600">{agentSdkError}</p> : null}
                    </div>
                    <p className="text-xs leading-5 text-slate-500">
                      {t(
                        '切换后仅对下一次新任务/新会话生效，不会中断当前运行；Codex 配置异常时会直接报错提示。',
                        'Changes apply to the next new task/session only and do not interrupt running flows; Codex failures are reported explicitly.'
                      )}
                    </p>
                  </div>
                </div>
              </div>
            ) : activeMainTab === 'collector' ? (
              <div className="flex h-full items-center justify-center rounded-lg border border-slate-200 bg-white">
                <p className="text-sm text-slate-500">{t('需求采集器页面（暂未开放）', 'Requirement Collector page (coming soon)')}</p>
              </div>
            ) : (
              <div className="flex h-full flex-col rounded-lg border border-slate-200 bg-white">
                <div className="border-b border-slate-200 px-3 py-2.5">
                  {activeListType === 'requirement' ? (
                    <Tabs value={requirementStatusFilter} onValueChange={(value) => setStatusFilter(value as RequirementStatusFilter)}>
                      <TabsList className="h-9 rounded-md bg-slate-100">
                        {STATUS_TABS.map((status) => (
                          <TabsTrigger key={status} value={status} className="h-7 gap-1.5 rounded-md px-2.5 text-xs text-slate-600 data-[state=active]:text-slate-900">
                            <span>
                              {getRequirementStatusFilterLabel(status)}
                              {requirementCountByStatus[status] > 0 ? ` ${requirementCountByStatus[status]}` : ''}
                            </span>
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </Tabs>
                  ) : (
                    <Tabs value={taskStatusFilter} onValueChange={(value) => setTaskFilter(value as TaskStatusFilter)}>
                      <TabsList className="h-9 rounded-md bg-slate-100">
                        {TASK_STATUS_OPTIONS.map((status) => (
                          <TabsTrigger key={status} value={status} className="h-7 gap-1.5 rounded-md px-2.5 text-xs text-slate-600 data-[state=active]:text-slate-900">
                            <span>
                              {getTaskStatusFilterLabel(status)}
                              {taskCountByStatus[status] > 0 ? ` ${taskCountByStatus[status]}` : ''}
                            </span>
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </Tabs>
                  )}
                </div>

                <div className="min-h-0 flex-1 overflow-auto">
                  <Table className="min-w-[760px]">
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="w-[38%] min-w-[220px] pr-5">{t('标题', 'Title')}</TableHead>
                        <TableHead className="relative w-[14%] min-w-[88px] pl-5 before:absolute before:bottom-2 before:left-0 before:top-2 before:w-px before:bg-slate-200/80">
                          {t('来源类型', 'Source Type')}
                        </TableHead>
                        <TableHead className="relative w-[16%] min-w-[120px] pl-5 before:absolute before:bottom-2 before:left-0 before:top-2 before:w-px before:bg-slate-200/80">
                          {t('状态', 'Status')}
                        </TableHead>
                        <TableHead className="w-[12%] min-w-[88px]">{t('ID', 'ID')}</TableHead>
                        <TableHead className="w-[20%] min-w-[160px]">{t('操作', 'Action')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeListType === 'requirement' ? (
                        pagedRequirements.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={5} className="py-12 text-center text-sm text-slate-500">
                              {t('当前条件下暂无需求', 'No requirements under current filters')}
                            </TableCell>
                          </TableRow>
                        ) : (
                          pagedRequirements.map((requirement) => {
                            const active = selectedRequirement?.id === requirement.id
                            const isClarifying = requirement.waitingContext === 'prd_review_gate'
                            const isProcessing =
                              requirement.status === 'evaluating' || requirement.status === 'prd_designing' || requirement.status === 'prd_reviewing'
                            return (
                              <TableRow
                                key={requirement.id}
                                onClick={() => openRequirementDetail(requirement.id)}
                                className={cn('cursor-pointer', active ? 'bg-slate-50' : '')}
                                data-state={active ? 'selected' : 'inactive'}
                              >
                                <TableCell className="pr-5">
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold text-slate-900">{requirement.title}</p>
                                  </div>
                                </TableCell>
                                <TableCell className="relative whitespace-nowrap pl-5 text-xs text-slate-700 before:absolute before:bottom-2 before:left-0 before:top-2 before:w-px before:bg-slate-100">
                                  {requirement.source || t('未填写', 'Not provided')}
                                </TableCell>
                                <TableCell className="relative pl-5 before:absolute before:bottom-2 before:left-0 before:top-2 before:w-px before:bg-slate-100">
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      'h-7 whitespace-nowrap rounded-full px-2.5 text-xs font-medium leading-none',
                                      getStatusBadgeClass(requirement.status)
                                    )}
                                  >
                                    <span className="mr-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-current" />
                                    {getRequirementStatusLabel(requirement.status)}
                                  </Badge>
                                </TableCell>
                                <TableCell className="whitespace-nowrap text-xs text-slate-700">{requirement.id}</TableCell>
                                <TableCell>
                                  <Button
                                    variant={isClarifying || isProcessing ? 'outline' : 'ghost'}
                                    size="sm"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      if (isClarifying) {
                                        void openRequirementHumanConversation(requirement.id)
                                        return
                                      }
                                      if (isProcessing) {
                                        void openRequirementLatestStageTraceFromList(requirement.id)
                                      }
                                    }}
                                    className={cn(
                                      'h-7 whitespace-nowrap text-xs',
                                      isClarifying
                                        ? 'rounded-full border-red-200 bg-red-50 px-2.5 text-red-700 hover:bg-red-100 hover:text-red-700'
                                        : isProcessing
                                          ? 'rounded-full border-blue-200 bg-blue-50 px-2.5 text-blue-700 hover:bg-blue-100 hover:text-blue-700'
                                        : 'px-2 text-slate-600 hover:bg-slate-100'
                                      )}
                                  >
                                    {isClarifying ? t('人工处理', 'Human handling') : isProcessing ? t('查看详情', 'View Details') : t('指派评审', 'Assign Reviewer')}
                                  </Button>
                                </TableCell>
                              </TableRow>
                            )
                          })
                        )
                      ) : pagedTasks.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="py-12 text-center text-sm text-slate-500">
                            {t('当前条件下暂无任务', 'No tasks under current filters')}
                          </TableCell>
                        </TableRow>
                      ) : (
                        pagedTasks.map((task) => (
                          <TableRow
                            key={task.id}
                            className={cn('cursor-pointer', activeTaskId === task.id ? 'bg-slate-50' : '')}
                            data-state={activeTaskId === task.id ? 'selected' : 'inactive'}
                            onClick={() => openTaskDetail(task.id)}
                          >
                            <TableCell className="pr-5">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-slate-900">{task.title}</p>
                              </div>
                            </TableCell>
                            <TableCell className="relative whitespace-nowrap pl-5 text-xs text-slate-700 before:absolute before:bottom-2 before:left-0 before:top-2 before:w-px before:bg-slate-100">
                              {t('任务', 'Task')}
                            </TableCell>
                            <TableCell className="relative pl-5 before:absolute before:bottom-2 before:left-0 before:top-2 before:w-px before:bg-slate-100">
                              <Badge
                                variant="outline"
                                className={cn('h-7 whitespace-nowrap rounded-full px-2.5 text-xs font-medium leading-none', getStatusBadgeClass(task.status))}
                              >
                                <span className="mr-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-current" />
                                {getTaskStatusLabel(task.status)}
                              </Badge>
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs text-slate-700">{task.id}</TableCell>
                            <TableCell>
                              <span className="text-xs text-slate-500">{t('点击查看', 'Click to view')}</span>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-3 py-2 text-xs text-slate-500">
                  <p>{t('已选择', 'Selected')} 0 / {totalRows}</p>

                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-2">
                      <span>{t('每页行数', 'Rows per page')}</span>
                      <Select
                        value={String(rowsPerPage)}
                        onValueChange={(value) => setRowsPerPage(Number(value))}
                        name="rowsPerPage"
                        aria-label={t('每页行数', 'Rows per page')}
                        className="h-8 w-[78px] rounded-md border-slate-200 text-xs"
                      >
                        {ROWS_PER_PAGE_OPTIONS.map((size) => (
                          <SelectItem key={size} value={String(size)}>
                            {size}
                          </SelectItem>
                        ))}
                      </Select>
                    </div>

                    <p className="whitespace-nowrap">
                      {currentStart}-{currentEnd} / {totalRows}
                    </p>

                    <div className="flex items-center gap-1 whitespace-nowrap">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-slate-600"
                        onClick={() => setCurrentPage(1)}
                        disabled={currentPage === 1}
                      >
                        «
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-slate-600"
                        onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                        disabled={currentPage === 1}
                      >
                        ‹
                      </Button>
                      <span className="px-1 text-xs text-slate-600">
                        {t('第', 'Page')} {currentPage} {t('页，共', 'of')} {totalPages}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-slate-600"
                        onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                        disabled={currentPage >= totalPages}
                      >
                        ›
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-slate-600"
                        onClick={() => setCurrentPage(totalPages)}
                        disabled={currentPage >= totalPages}
                      >
                        »
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {isDetailOpen && useCompactDetail ? (
          <button
            type="button"
            aria-label={t('关闭详情面板', 'Close detail panel')}
            className="absolute inset-0 z-10 bg-slate-900/10"
            onClick={() => setIsDetailVisible(false)}
          />
        ) : null}
        <aside
          className={cn(
            'absolute inset-y-0 right-0 z-20 h-full border-l border-slate-200 bg-slate-50 transition-all duration-200',
            useCompactDetail ? 'w-full p-2 sm:p-3' : 'p-4',
            isDetailOpen ? 'translate-x-0 opacity-100 shadow-2xl' : 'translate-x-full opacity-0 pointer-events-none'
          )}
          style={
            useCompactDetail
              ? { maxWidth: `min(${DETAIL_PANEL_WIDTH}px, calc(100% - 12px))` }
              : { width: DETAIL_PANEL_WIDTH }
          }
        >
          <div className="h-full overflow-y-auto rounded-xl bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-900">{t('详情', 'Details')}</p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2"
                  onClick={(event) => {
                    event.stopPropagation()
                    setIsDetailVisible(false)
                    setActiveTaskId(null)
                    closeArtifactModal()
                  }}
                >
                  {t('隐藏', 'Hide')}
                </Button>
              </div>


              {isTaskDetailMode && selectedTask ? (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <p className="text-xs text-slate-500">{t('任务标题', 'Task Title')}</p>
                    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">{selectedTask.title}</div>
                  </div>

                  <div className="space-y-1">
                    <p className="text-xs text-slate-500">{t('当前状态', 'Current Status')}</p>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={cn('h-7 whitespace-nowrap rounded-full px-2.5 text-xs font-medium leading-none', getStatusBadgeClass(selectedTask.status))}
                      >
                        <span className="mr-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-current" />
                        {getTaskStatusLabel(selectedTask.status)}
                      </Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        className={cn(
                          'h-7 rounded-md bg-white px-2.5 text-xs hover:bg-slate-50',
                          latestTaskFlowCard?.resultStatus === 'waiting_human'
                            ? 'border-amber-200 text-amber-700 hover:bg-amber-50'
                            : 'border-slate-200 text-slate-700'
                        )}
                        onClick={() => {
                          if (!selectedTask || !latestTaskFlowCard) {
                            return
                          }

                          if (latestTaskFlowCard.resultStatus === 'waiting_human') {
                            openTaskHumanConversation(selectedTask.id)
                            return
                          }

                          onOpenTaskStageTraceModal(latestTaskFlowCard)
                        }}
                        disabled={!latestTaskFlowCard}
                      >
                        {latestTaskFlowCard?.resultStatus === 'waiting_human' ? t('人工处理', 'Human handling') : t('查看详情', 'View details')}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <p className="text-xs text-slate-500">{t('任务来源', 'Task Source')}</p>
                    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">
                      {selectedTask.requirementId ? `${t('需求', 'Requirement')} #${selectedTask.requirementId}` : t('派发任务', 'Dispatched Task')}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <p className="text-xs text-slate-500">{t('状态流转', 'Status Flow')}</p>
                    <StageFlowList
                      cards={taskFlowStageCards}
                      onViewDetail={(cardId, resultStatus) => {
                        const card = selectedTaskFlowCards.find((item) => item.id === cardId)
                        if (!card) {
                          return
                        }

                        if (resultStatus === 'waiting_human' && selectedTask) {
                          openTaskHumanConversation(selectedTask.id)
                          return
                        }

                        void onOpenTaskStageTraceModal(card)
                      }}
                      renderExtra={(cardId) => {
                        const card = selectedTaskFlowCards.find((item) => item.id === cardId)
                        if (!card || card.artifactFiles.length === 0) {
                          return null
                        }

                        return (
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <p className="text-xs text-slate-600">{t('交付产物', 'Artifacts')}:</p>
                            {card.artifactFiles.map((artifact) => (
                              <button
                                key={`${card.id}-${artifact.fileName}`}
                                type="button"
                                className="inline-flex items-center rounded-md bg-sky-50 px-2 py-1 text-left text-xs text-sky-700 ring-1 ring-inset ring-sky-200 transition hover:bg-sky-100"
                                onClick={() => void onPreviewTaskArtifact(selectedTask.id, artifact.fileName)}
                              >
                                {artifact.fileName}
                              </button>
                            ))}
                          </div>
                        )
                      }}
                    />
                  </div>

                </div>
              ) : selectedRequirement ? (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <p className="text-xs text-slate-500">{t('标题', 'Title')}</p>
                    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">{selectedRequirement.title}</div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs text-slate-500">{t('状态', 'Status')}</p>
                    <div className="flex flex-wrap gap-2">
                      <Badge
                        variant="outline"
                        className={cn(
                          'h-7 whitespace-nowrap rounded-full px-2.5 text-xs font-medium leading-none',
                          getStatusBadgeClass(selectedRequirement.status)
                        )}
                      >
                        <span className="mr-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-current" />
                        {getRequirementStatusLabel(selectedRequirement.status)}
                      </Badge>
                      {selectedRequirement.waitingContext === 'prd_review_gate' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void openRequirementHumanConversation(selectedRequirement.id)}
                          className="h-7 whitespace-nowrap rounded-full border-red-200 bg-red-50 px-2.5 text-xs text-red-700 hover:bg-red-100 hover:text-red-700"
                        >
                          {t('人工处理', 'Human handling')}
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 rounded-md border-slate-200 bg-white px-2.5 text-xs text-slate-700 hover:bg-slate-50"
                        onClick={() => latestRequirementFlowCard && openConversationDetailDialog(selectedRequirement.id)}
                        disabled={!latestRequirementFlowCard}
                      >
                        {t('查看详情', 'View Details')}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <p className="text-xs text-slate-500">{t('需求来源', 'Requirement Source')}</p>
                    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">{selectedRequirement.source || t('未填写', 'Not provided')}</div>
                  </div>

                  {selectedRequirement?.standardizedData &&
                  (selectedRequirement.status === 'queued' || selectedRequirement.status === 'canceled') ? (
                    <div className="space-y-2">
                      <p className="text-xs text-slate-500">{t('标准化结果', 'Standardized Result')}</p>
                      <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
                        {selectedRequirement.standardizedData.type === 'accept' || selectedRequirement.standardizedData.type === 'prd' ? (
                          (() => {
                            const parsed =
                              selectedRequirement.standardizedData.type === 'accept'
                                ? parseStandardizedAcceptContent(selectedRequirement.standardizedData.standardized)
                                : null
                            return (
                              <div className="space-y-2">
                                <div className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-emerald-700 shadow-sm">
                                  <span className="mr-2 inline-block h-2 w-2 rounded-full bg-emerald-500" />
                                  {selectedRequirement.standardizedData.type === 'prd' ? 'prd' : 'accept'}
                                </div>
                                <div className="space-y-1.5 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{t('标题', 'Title')}</p>
                                  <p className="whitespace-pre-wrap break-words text-sm font-medium leading-6 text-slate-900">
                                    {selectedRequirement.standardizedData.type === 'prd'
                                      ? selectedRequirement.title
                                      : parsed?.title || selectedRequirement.standardizedData.standardized}
                                  </p>
                                </div>
                                <div className="space-y-1.5 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{t('内容', 'Content')}</p>
                                  <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5">
                                    <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-800">
                                      {selectedRequirement.standardizedData.type === 'prd'
                                        ? selectedRequirement.standardizedData.prd
                                        : parsed?.content || selectedRequirement.standardizedData.standardized}
                                    </p>
                                  </div>
                                </div>
                                {selectedRequirement.standardizedData.type === 'prd' ? (
                                  <div className="space-y-1.5 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{t('子任务', 'Subtasks')}</p>
                                    <pre className="overflow-auto whitespace-pre-wrap text-xs leading-5 text-slate-700">
                                      {JSON.stringify(selectedRequirement.standardizedData.subTasks, null, 2)}
                                    </pre>
                                  </div>
                                ) : null}
                              </div>
                            )
                          })()
                        ) : null}
                        {selectedRequirement.standardizedData.type === 'review' ? (
                          <div className="space-y-2">
                            <div>
                              <p className="mb-1 text-xs text-slate-500">{t('评审结果', 'Review Result')}</p>
                              <p className="text-sm text-slate-900">{selectedRequirement.standardizedData.result}</p>
                            </div>
                            <div>
                              <p className="mb-1 text-xs text-slate-500">{t('评审结论', 'Review Summary')}</p>
                              <p className="whitespace-pre-wrap break-words text-sm text-slate-900">{selectedRequirement.standardizedData.summary}</p>
                            </div>
                          </div>
                        ) : null}
                        {selectedRequirement.standardizedData.type === 'evaluation' ? (
                          <div className="space-y-2">
                            <div>
                              <p className="mb-1 text-xs text-slate-500">{t('评估结果', 'Evaluation Result')}</p>
                              <p className="text-sm text-slate-900">
                                {selectedRequirement.standardizedData.result === 'reasonable' ? t('合理', 'Reasonable') : t('不合理', 'Unreasonable')}
                              </p>
                            </div>
                            <div>
                              <p className="mb-1 text-xs text-slate-500">{t('评估结论', 'Evaluation Summary')}</p>
                              <p className="whitespace-pre-wrap break-words text-sm text-slate-900">{selectedRequirement.standardizedData.summary}</p>
                            </div>
                          </div>
                        ) : null}
                        {selectedRequirement.standardizedData.type === 'clarify' ? (
                          <div className="space-y-2">
                            <div>
                              <p className="mb-1 text-xs text-slate-500">{t('类型', 'Type')}</p>
                              <p className="text-sm text-slate-900">{t('待澄清', 'Need Clarification')}</p>
                            </div>
                            <div>
                              <p className="mb-1 text-xs text-slate-500">{t('追问问题', 'Follow-up Question')}</p>
                              <p className="whitespace-pre-wrap break-words text-sm text-slate-900">{selectedRequirement.standardizedData.question}</p>
                            </div>
                          </div>
                        ) : null}
                        {selectedRequirement.standardizedData.type === 'skip' ? (
                          <div className="space-y-2">
                            <div>
                              <p className="mb-1 text-xs text-slate-500">{t('类型', 'Type')}</p>
                              <p className="text-sm text-slate-900">{t('跳过', 'Skip')}</p>
                            </div>
                            <div>
                              <p className="mb-1 text-xs text-slate-500">{t('原因', 'Reason')}</p>
                              <p className="whitespace-pre-wrap break-words text-sm text-slate-900">{selectedRequirement.standardizedData.reason}</p>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  <div className="space-y-3">
                    <p className="text-xs text-slate-500">{t('状态流转', 'Status Flow')}</p>
                    <StageFlowList
                      cards={requirementFlowStageCards}
                      onViewDetail={(cardId) => {
                        const card = selectedRequirementFlowCards.find((item) => item.id === cardId)
                        if (!card) {
                          return
                        }

                        onOpenRequirementStageTraceModal(card)
                      }}
                      renderExtra={(cardId) => {
                        const card = selectedRequirementFlowCards.find((item) => item.id === cardId)
                        if (!card || card.artifactFiles.length === 0) {
                          return null
                        }

                        return (
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <p className="text-xs text-slate-600">{t('交付产物', 'Artifacts')}:</p>
                            {card.artifactFiles.map((artifact) => (
                              <button
                                key={`${card.id}-${artifact.fileName}`}
                                type="button"
                                className="inline-flex items-center rounded-md bg-sky-50 px-2 py-1 text-left text-xs text-sky-700 ring-1 ring-inset ring-sky-200 transition hover:bg-sky-100"
                                onClick={() => void onPreviewRequirementArtifact(selectedRequirement.id, artifact.fileName)}
                              >
                                {artifact.fileName}
                              </button>
                            ))}
                          </div>
                        )
                      }}
                    />
                  </div>

                  <Separator />

                  <div className="space-y-3">
                    <p className="text-xs text-slate-500">{t('任务列表', 'Task List')}</p>
                    {tasksForSelectedRequirement.length === 0 ? (
                      <p className="rounded-md border border-dashed p-3 text-sm text-slate-500">{t('当前需求暂无任务', 'No tasks under this requirement')}</p>
                    ) : (
                      <div className="overflow-hidden rounded-md border border-slate-200">
                        <Table>
                          <TableHeader>
                            <TableRow className="hover:bg-transparent">
                              <TableHead className="w-[70%]">{t('任务标题', 'Task Title')}</TableHead>
                              <TableHead className="w-[30%]">{t('状态', 'Status')}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {tasksForSelectedRequirement.map((task) => (
                              <TableRow key={task.id} className="hover:bg-transparent">
                                <TableCell className="text-sm text-slate-900">{task.title}</TableCell>
                                <TableCell>
                                  <Badge
                                    variant="outline"
                                    className={cn('h-7 whitespace-nowrap rounded-full px-2.5 text-xs font-medium leading-none', getStatusBadgeClass(task.status))}
                                  >
                                    <span className="mr-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-current" />
                                    {getTaskStatusLabel(task.status)}
                                  </Badge>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <p className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500">{t('请选择一条需求查看详情', 'Please select a requirement to view details')}</p>
              )}
            </div>
        </aside>
      </main>
    </div>
  )
}

export default function App() {
  const state = useProjectState()

  return (
    <Workspace
      projects={state.projects}
      requirements={state.requirements}
      filteredRequirements={state.filteredRequirements}
      filteredTasks={state.filteredTasks}
      projectTasks={state.projectTasks}
      selectedProjectId={state.selectedProjectId}
      selectedRequirement={state.selectedRequirement}
      activeListType={state.activeListType}
      requirementStatusFilter={state.requirementStatusFilter}
      taskStatusFilter={state.taskStatusFilter}
      tasksForSelectedRequirement={state.tasksForSelectedRequirement}
      loading={state.loading}
      error={state.error}
      addProject={state.addProject}
      selectProject={state.selectProject}
      setActiveListType={state.setActiveListType}
      setStatusFilter={state.setStatusFilter}
      setTaskFilter={state.setTaskFilter}
      selectRequirement={state.selectRequirement}
      createRequirementPending={state.createRequirementPending}
      createTaskItem={state.createTaskItem}
      clarifyRequirement={state.clarifyRequirement}
      loadRequirementConversation={state.loadRequirementConversation}
      getClarifyMessages={state.getClarifyMessages}
      clearClarifyMessages={state.clearClarifyMessages}
      saveRequirement={state.saveRequirement}
      applyTaskCommand={state.applyTaskCommand}
      loadTaskHumanConversation={state.loadTaskHumanConversation}
      sendTaskHumanConversation={state.sendTaskHumanConversation}
      autoProcessorRunning={state.autoProcessorRunning}
      autoProcessorStartedAt={state.autoProcessorStartedAt}
      autoProcessorLoading={state.autoProcessorLoading}
      toggleAutoProcessor={state.toggleAutoProcessor}
      taskAutoProcessorRunning={state.taskAutoProcessorRunning}
      taskAutoProcessorStartedAt={state.taskAutoProcessorStartedAt}
      taskAutoProcessorLoading={state.taskAutoProcessorLoading}
      toggleTaskProcessor={state.toggleTaskProcessor}
    />
  )
}
