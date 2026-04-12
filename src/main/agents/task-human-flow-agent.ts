import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk'
import type { Task, TaskAgentTraceMessage } from '../../shared/types'
import { parseAgentConversations, parseTaskTraceMessages, parseTaskTraceMessagesFromSessionList, stringifyAgentConversations } from '../agent-message-utils'
import { readArtifactIfExists, resolveTaskArtifactDir, writeArtifact } from '../task-artifact-service'
import { getTaskDetail, isTaskWaitingHumanStatus, resolveCurrentStageArtifactFileName, resolveLatestStageArtifactFileName } from '../task-service'
import {
  buildArchDesignUserPrompt,
  buildCodingUserPrompt,
  TASK_ARCH_DESIGN_AGENT_SYSTEM_PROMPT,
  TASK_CODING_AGENT_SYSTEM_PROMPT
} from './prompts'
import { AgentRunnerError, runAgentQuery } from './agent-runner'
import { getDb } from '../db'
import { getProject } from '../project-service'
import { updateTaskStageRunAgentSessionId, updateTaskStageRunAgentTrace } from '../task-stage-run-repo'
import { emitTaskStageTraceChanged } from '../task-stage-trace-events'

interface TaskHumanConversationReadResult {
  task: Task
  messages: TaskAgentTraceMessage[]
}

interface TaskHumanConversationReplyResult {
  task: Task
  messages: TaskAgentTraceMessage[]
}

interface TaskHumanAgentResult {
  resultText: string
  conversations: unknown[]
  sessionId: string | null
}

interface TaskHumanAgentProgress {
  conversations: unknown[]
  sessionId: string | null
}

function resolveTaskProjectPath(task: Task): string {
  const project = getProject(task.projectId)
  if (!project) {
    throw new Error('任务关联项目不存在')
  }
  return project.path
}

function findWaitingStageRun(taskId: number): { id: number; stageKey: Task['status']; agentProcess: string; agentSessionId: string | null } | null {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT id, stage_key, agent_process, agent_session_id
       FROM stage_runs
       WHERE entity_type = 'task' AND entity_id = ? AND result_status = 'waiting_human' AND end_at IS NULL
       ORDER BY start_at DESC, id DESC
       LIMIT 1`
    )
    .get(taskId) as
    | {
        id: number
        stage_key: Task['status']
        agent_process: string
        agent_session_id: string | null
      }
    | undefined

  if (!row?.id) {
    return null
  }

  return {
    id: row.id,
    stageKey: row.stage_key,
    agentProcess: row.agent_process ?? '',
    agentSessionId: row.agent_session_id ?? null
  }
}

function ensureWaitingTask(taskId: number): { task: Task; stageRunId: number; stageKey: Task['status']; stageSessionId: string | null; stageHistory: unknown[] } {
  const task = getTaskDetail(taskId)
  if (!isTaskWaitingHumanStatus(task)) {
    throw new Error('当前任务不在等待人工状态')
  }

  const waitingRun = findWaitingStageRun(task.id)
  if (!waitingRun) {
    throw new Error('未找到等待人工的节点运行记录')
  }

  return {
    task,
    stageRunId: waitingRun.id,
    stageKey: waitingRun.stageKey,
    stageSessionId: waitingRun.agentSessionId,
    stageHistory: parseAgentConversations(waitingRun.agentProcess)
  }
}

async function parseTaskMessagesFromSession(sessionId: string): Promise<TaskAgentTraceMessage[]> {
  const list = await getSessionMessages(sessionId)
  return parseTaskTraceMessagesFromSessionList(list)
}

async function readLatestStageArtifact(taskId: number, artifactDir: string, stageKey: Task['status']): Promise<string | null> {
  const fileName = resolveLatestStageArtifactFileName(taskId, stageKey)
  if (!fileName) {
    return null
  }

  return readArtifactIfExists(artifactDir, fileName)
}

async function writeCurrentStageArtifact(taskId: number, stageKey: Task['status'], content: string): Promise<void> {
  const artifactDir = await resolveTaskArtifactDir(taskId)
  const fileName = resolveCurrentStageArtifactFileName(taskId, stageKey)
  if (!fileName) {
    throw new Error('无法解析当前阶段产物文件名')
  }

  await writeArtifact(artifactDir, fileName, content)
}

function normalizeHumanAgentResult(resultText: string): string {
  const text = resultText.trim()
  if (!text) {
    return '暂无输出。'
  }

  return text.replace(/^pass\s*[:：-]?\s*/i, '').trim()
}

function createWaitingStageProgressHandler(input: {
  stageRunId: number
  taskId: number
  stageKey: Task['status']
}): (progress: TaskHumanAgentProgress) => void {
  let sessionPersisted = false
  let lastBroadcastConversationCount = 0
  let lastPersistedConversationCount = 0

  return (progress: TaskHumanAgentProgress) => {
    const sessionId = progress.sessionId?.trim() || null
    const conversationCount = progress.conversations.length

    try {
      if (sessionId && !sessionPersisted) {
        updateTaskStageRunAgentSessionId({
          stageRunId: input.stageRunId,
          agentSessionId: sessionId
        })
        sessionPersisted = true
      }

      if (conversationCount > lastPersistedConversationCount) {
        updateTaskStageRunAgentTrace({
          stageRunId: input.stageRunId,
          agentProcess: stringifyAgentConversations(progress.conversations),
          ...(sessionId ? { agentSessionId: sessionId } : {})
        })
        lastPersistedConversationCount = conversationCount
      }

      if (conversationCount <= lastBroadcastConversationCount) {
        return
      }

      lastBroadcastConversationCount = conversationCount
      emitTaskStageTraceChanged({
        taskId: input.taskId,
        stageRunId: input.stageRunId,
        stageKey: input.stageKey
      })
    } catch {
      // ignore trace persistence error
    }
  }
}

async function runTaskHumanAgent(input: {
  stageKey: Task['status']
  task: Task
  resumeSessionId?: string
  artifactDir: string
  note: string
  stageRunId: number
  cwd: string
}): Promise<TaskHumanAgentResult> {
  const stage = input.stageKey
  if (stage !== 'arch_designing' && stage !== 'coding') {
    throw new Error('当前等待节点不支持人工多轮对话')
  }

  const artifactDir = input.artifactDir
  const task = input.task
  const note = input.note
  const progressHandler = createWaitingStageProgressHandler({
    stageRunId: input.stageRunId,
    taskId: task.id,
    stageKey: stage
  })

  const prompt =
    stage === 'arch_designing'
      ? buildArchDesignUserPrompt(task, await readLatestStageArtifact(task.id, artifactDir, 'tech_reviewing'), note)
      : buildCodingUserPrompt(
          task,
          await readLatestStageArtifact(task.id, artifactDir, 'arch_designing'),
          await readLatestStageArtifact(task.id, artifactDir, 'tech_reviewing'),
          await readLatestStageArtifact(task.id, artifactDir, 'qa_reviewing'),
          note
        )

  const systemPrompt = stage === 'arch_designing' ? TASK_ARCH_DESIGN_AGENT_SYSTEM_PROMPT : TASK_CODING_AGENT_SYSTEM_PROMPT

  try {
    const runnerResult = await runAgentQuery({
      systemPrompt,
      prompt,
      cwd: input.cwd,
      resumeSessionId: input.resumeSessionId,
      errorMessage: '人工会话执行失败',
      noResultMessage: '人工会话未收到结果',
      onProgress: (progress) => {
        progressHandler({
          conversations: progress.conversations,
          sessionId: progress.sessionId
        })
      }
    })

    return {
      resultText: runnerResult.resultText,
      conversations: runnerResult.conversations,
      sessionId: runnerResult.sessionId
    }
  } catch (error) {
    if (error instanceof AgentRunnerError) {
      throw new Error(error.message)
    }

    throw error
  }
}

function persistWaitingStageTrace(stageRunId: number, conversations: unknown[], sessionId: string | null): void {
  try {
    const context = findWaitingStageRunById(stageRunId)
    if (!context) {
      return
    }
    updateTaskStageRunAgentTrace({
      stageRunId,
      agentProcess: stringifyAgentConversations(conversations),
      agentSessionId: sessionId
    })
    emitTaskStageTraceChanged({
      taskId: context.entityId,
      stageRunId,
      stageKey: context.stageKey
    })
  } catch {
    // ignore trace persistence error
  }
}

function findWaitingStageRunById(stageRunId: number): { entityId: number; stageKey: Task['status'] } | null {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT entity_id, stage_key
       FROM stage_runs
       WHERE id = ? AND entity_type = 'task'
       LIMIT 1`
    )
    .get(stageRunId) as
    | {
        entity_id: number
        stage_key: Task['status']
      }
    | undefined

  if (!row) {
    return null
  }

  return {
    entityId: row.entity_id,
    stageKey: row.stage_key
  }
}

function buildUserTraceMessage(note: string): TaskAgentTraceMessage {
  return {
    id: `human-${Date.now()}`,
    role: 'user',
    content: note
  }
}

function mergeMessages(history: TaskAgentTraceMessage[], fallbackUserMessage: TaskAgentTraceMessage): TaskAgentTraceMessage[] {
  if (history.length > 0) {
    return history
  }

  return [fallbackUserMessage]
}

export async function getTaskHumanConversation(taskId: number): Promise<TaskHumanConversationReadResult> {
  if (!Number.isInteger(taskId) || taskId <= 0) {
    throw new Error('taskId 非法')
  }

  const context = ensureWaitingTask(taskId)
  const { task, stageRunId, stageSessionId, stageHistory } = context

  if (stageSessionId) {
    try {
      const messages = await parseTaskMessagesFromSession(stageSessionId)
      if (messages.length > 0) {
        return {
          task,
          messages
        }
      }
    } catch {
      // fallback to persisted history
    }
  }

  const dbMessages = parseTaskTraceMessages(stageHistory)
  return {
    task,
    messages: dbMessages
  }
}

export async function replyTaskHumanConversation(input: { taskId: number; message: string }): Promise<TaskHumanConversationReplyResult> {
  if (!Number.isInteger(input.taskId) || input.taskId <= 0) {
    throw new Error('taskId 非法')
  }

  const note = input.message.trim()
  if (!note) {
    throw new Error('消息不能为空')
  }

  const context = ensureWaitingTask(input.taskId)
  const { task, stageRunId, stageKey, stageSessionId, stageHistory } = context
  const cwd = resolveTaskProjectPath(task)
  const artifactDir = await resolveTaskArtifactDir(task.id)
  const agentResult = await runTaskHumanAgent({
    stageKey,
    task,
    resumeSessionId: stageSessionId ?? undefined,
    artifactDir,
    note,
    stageRunId,
    cwd
  })

  const mergedConversations = [...stageHistory, ...agentResult.conversations]
  persistWaitingStageTrace(stageRunId, mergedConversations, agentResult.sessionId)

  await writeCurrentStageArtifact(task.id, stageKey, normalizeHumanAgentResult(agentResult.resultText))

  let messages: TaskAgentTraceMessage[] = []
  if (agentResult.sessionId) {
    try {
      messages = await parseTaskMessagesFromSession(agentResult.sessionId)
    } catch {
      // fallback below
    }
  }

  if (messages.length === 0) {
    const parsed = parseTaskTraceMessages(mergedConversations)
    messages = mergeMessages(parsed, buildUserTraceMessage(note))
  }

  return {
    task: getTaskDetail(task.id),
    messages
  }
}
