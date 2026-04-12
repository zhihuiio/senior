import { getDb } from './db'
import { getRequirementById } from './requirement-repo'
import { getTaskById, insertTask, listTasksByProject, listTasksByRequirement, listTasksGlobal, updateTask } from './task-repo'
import { finishTaskStageRun, hasOpenTaskStageRun, hasWaitingHumanTaskStageRun, listTaskStageRuns, startTaskStageRun } from './task-stage-run-repo'
import type { Task, TaskStatus, TaskTransitionAction, TaskHumanCommand, TaskWaitingContext, TaskStageRun } from '../shared/types'

const VALID_TASK_STATUS: TaskStatus[] = ['idle', 'arch_designing', 'tech_reviewing', 'coding', 'qa_reviewing', 'deploying', 'done', 'waiting_human']

const RUNNING_TASK_STATUS_SET = new Set<TaskStatus>(['arch_designing', 'tech_reviewing', 'coding', 'qa_reviewing', 'deploying'])

const ACTIVE_WAITING_STAGE_SET = new Set<TaskStatus>(['arch_designing', 'coding', 'tech_reviewing', 'qa_reviewing'])

const TASK_TRANSITIONS: Record<TaskStatus, Partial<Record<TaskTransitionAction, TaskStatus>>> = {
  idle: { pick_next: 'arch_designing' },
  arch_designing: { arch_done: 'tech_reviewing' },
  tech_reviewing: { review_pass: 'coding' },
  waiting_human: {},
  coding: { coding_done: 'qa_reviewing' },
  qa_reviewing: { qa_pass: 'deploying' },
  deploying: { deploy_done: 'done' },
  done: {}
}

export class TaskServiceError extends Error {
  constructor(
    public readonly code: 'INVALID_INPUT' | 'DB_ERROR' | 'NOT_FOUND' | 'STATUS_INVALID' | 'ACTION_INVALID' | 'TRANSITION_INVALID',
    message: string
  ) {
    super(message)
  }
}

function ensureProjectExists(projectId: number): void {
  const db = getDb()
  const row = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId) as { id: number } | undefined
  if (!row) {
    throw new TaskServiceError('NOT_FOUND', '项目不存在')
  }
}

function ensureRequirementExists(requirementId: number): void {
  const requirement = getRequirementById(requirementId)
  if (!requirement) {
    throw new TaskServiceError('NOT_FOUND', '需求不存在')
  }
}

function ensureTaskExists(taskId: number): Task {
  const task = getTaskById(taskId)
  if (!task) {
    throw new TaskServiceError('NOT_FOUND', '任务不存在')
  }

  return task
}

function normalizeStatus(status: string): TaskStatus {
  if (!VALID_TASK_STATUS.includes(status as TaskStatus)) {
    throw new TaskServiceError('STATUS_INVALID', '任务状态非法')
  }

  return status as TaskStatus
}

function normalizeAction(action: string): TaskTransitionAction {
  const allowed: TaskTransitionAction[] = [
    'pick_next',
    'arch_done',
    'review_pass',
    'review_fail',
    'coding_done',
    'qa_pass',
    'qa_fail',
    'deploy_done'
  ]

  if (!allowed.includes(action as TaskTransitionAction)) {
    throw new TaskServiceError('ACTION_INVALID', '任务动作非法')
  }

  return action as TaskTransitionAction
}

function normalizeHumanCommand(command: string): TaskHumanCommand {
  const allowed: TaskHumanCommand[] = ['force_pass', 'cancel', 'revise']

  if (!allowed.includes(command as TaskHumanCommand)) {
    throw new TaskServiceError('ACTION_INVALID', '人工命令非法')
  }

  return command as TaskHumanCommand
}

function resolveTransition(current: TaskStatus, action: TaskTransitionAction): TaskStatus {
  const next = TASK_TRANSITIONS[current][action]
  if (!next) {
    throw new TaskServiceError('TRANSITION_INVALID', `状态流转非法: ${current} -> ${action}`)
  }

  return next
}

function persistTask(task: Task): Task {
  try {
    const updated = updateTask({
      id: task.id,
      title: task.title,
      content: task.content,
      status: task.status,
      techReviewRejectCount: task.techReviewRejectCount,
      qaRejectCount: task.qaRejectCount,
      waitingContext: task.waitingContext,
      humanRevisionNote: task.humanRevisionNote
    })

    if (!updated) {
      throw new TaskServiceError('NOT_FOUND', '任务不存在')
    }

    return updated
  } catch (error) {
    if (error instanceof TaskServiceError) {
      throw error
    }

    throw new TaskServiceError('DB_ERROR', error instanceof Error ? error.message : '更新任务失败')
  }
}

function isTrackableStage(status: TaskStatus): boolean {
  return RUNNING_TASK_STATUS_SET.has(status)
}

function resolveWaitingContextByStageStatus(taskId: number, status: TaskStatus): TaskWaitingContext | null {
  if (status === 'arch_designing' && hasWaitingHumanTaskStageRun({ taskId, stageKey: 'arch_designing' })) {
    return 'arch_design_gate'
  }

  if (status === 'tech_reviewing' && hasWaitingHumanTaskStageRun({ taskId, stageKey: 'tech_reviewing' })) {
    return 'arch_design_gate'
  }

  if (status === 'coding' && hasWaitingHumanTaskStageRun({ taskId, stageKey: 'coding' })) {
    return 'coding_gate'
  }

  if (status === 'qa_reviewing' && hasWaitingHumanTaskStageRun({ taskId, stageKey: 'qa_reviewing' })) {
    return 'coding_gate'
  }

  return null
}

function resolveWaitingContextByTaskStatus(task: Task): TaskWaitingContext | null {
  if (task.waitingContext === 'arch_design_gate') {
    return 'arch_design_gate'
  }

  if (task.waitingContext === 'coding_gate') {
    return 'coding_gate'
  }

  if (task.status === 'waiting_human') {
    if (task.waitingContext === 'tech_review_gate') {
      return 'arch_design_gate'
    }

    if (task.waitingContext === 'qa_gate') {
      return 'coding_gate'
    }
  }

  if (task.status === 'waiting_human') {
    const fromQa = resolveWaitingContextByStageStatus(task.id, 'qa_reviewing')
    if (fromQa) {
      return fromQa
    }

    const fromTech = resolveWaitingContextByStageStatus(task.id, 'tech_reviewing')
    if (fromTech) {
      return fromTech
    }

    const fromCoding = resolveWaitingContextByStageStatus(task.id, 'coding')
    if (fromCoding) {
      return fromCoding
    }

    const fromArch = resolveWaitingContextByStageStatus(task.id, 'arch_designing')
    if (fromArch) {
      return fromArch
    }

    return 'arch_design_gate'
  }

  if (!ACTIVE_WAITING_STAGE_SET.has(task.status)) {
    return null
  }

  return resolveWaitingContextByStageStatus(task.id, task.status)
}

function isTaskWaitingHuman(task: Task): boolean {
  return Boolean(resolveWaitingContextByTaskStatus(task))
}

function markTaskStageWaitingHuman(task: Task, failureReason: string): void {
  const stageStatus = getTaskEngineStatus(task)
  if (!ACTIVE_WAITING_STAGE_SET.has(stageStatus)) {
    return
  }

  const reason = failureReason.trim()
  finishTaskStageRun({
    taskId: task.id,
    stageKey: stageStatus,
    resultStatus: 'waiting_human',
    failureReason: reason,
    artifactFileName: resolveCurrentStageArtifactFileName(task.id, stageStatus)
  })
}

function clearTaskStageWaitingHuman(task: Task): void {
  const stageStatus = getTaskEngineStatus(task)
  if (!ACTIVE_WAITING_STAGE_SET.has(stageStatus)) {
    return
  }

  const waiting = hasWaitingHumanTaskStageRun({
    taskId: task.id,
    stageKey: stageStatus
  })

  if (!waiting) {
    return
  }

  finishTaskStageRun({
    taskId: task.id,
    stageKey: stageStatus,
    resultStatus: 'succeeded',
    artifactFileName: resolveCurrentStageArtifactFileName(task.id, stageStatus)
  })
}

function normalizeTaskRuntime(task: Task): Task {
  const waitingContext = resolveWaitingContextByTaskStatus(task)

  if (!waitingContext) {
    if (task.waitingContext === null || task.waitingContext === 'tech_review_gate' || task.waitingContext === 'qa_gate') {
      return task
    }

    return {
      ...task,
      waitingContext: null
    }
  }

  if (task.waitingContext === waitingContext) {
    return task
  }

  return {
    ...task,
    waitingContext
  }
}

function toTaskView(task: Task): Task {
  if (task.status === 'waiting_human') {
    const normalizedEngineStatus = getTaskEngineStatus(task)
    return {
      ...task,
      status: normalizedEngineStatus
    }
  }

  const waitingContext = resolveWaitingContextByTaskStatus(task)

  if (waitingContext && task.waitingContext !== waitingContext) {
    return {
      ...task,
      waitingContext
    }
  }

  return task
}

function getTaskEngineStatus(task: Task): TaskStatus {
  if (task.status === 'waiting_human') {
    if (task.waitingContext === 'coding_gate' || task.waitingContext === 'qa_gate') {
      return 'coding'
    }
    return 'arch_designing'
  }
  return task.status
}

function ensureTaskByIdForEngine(taskId: number): Task {
  const task = ensureTaskExists(taskId)
  const runtimeTask = normalizeTaskRuntime(task)

  if (runtimeTask.waitingContext === task.waitingContext) {
    return runtimeTask
  }

  return persistTask(runtimeTask)
}

function getTasksByProjectForEngine(projectId: number): Task[] {
  if (!Number.isInteger(projectId) || projectId <= 0) {
    throw new TaskServiceError('INVALID_INPUT', 'projectId 非法')
  }

  ensureProjectExists(projectId)

  try {
    return listTasksByProject(projectId).map((task) => {
      const runtimeTask = normalizeTaskRuntime(task)
      if (runtimeTask.waitingContext === task.waitingContext) {
        return runtimeTask
      }

      return persistTask(runtimeTask)
    })
  } catch (error) {
    throw new TaskServiceError('DB_ERROR', error instanceof Error ? error.message : '读取任务失败')
  }
}

function deriveStageArtifactBaseName(status: TaskStatus): string | null {
  if (status === 'arch_designing') {
    return 'arch_design.md'
  }

  if (status === 'tech_reviewing') {
    return 'tech_review.json'
  }

  if (status === 'coding') {
    return 'code.md'
  }

  if (status === 'qa_reviewing') {
    return 'qa.json'
  }

  if (status === 'deploying') {
    return 'deploy.md'
  }

  return null
}

export function buildStageArtifactFileName(status: TaskStatus, round: number): string | null {
  const baseName = deriveStageArtifactBaseName(status)
  if (!baseName) {
    return null
  }

  if (round <= 1) {
    return baseName
  }

  const dotIndex = baseName.lastIndexOf('.')
  if (dotIndex <= 0) {
    return `${baseName}_v${round}`
  }

  const name = baseName.slice(0, dotIndex)
  const ext = baseName.slice(dotIndex)
  return `${name}_v${round}${ext}`
}

export function resolveCurrentStageArtifactFileName(taskId: number, status: TaskStatus): string | null {
  const runs = listTaskStageRuns(taskId)
  const current = [...runs]
    .reverse()
    .find((run) => run.stageKey === status && run.endAt === null)

  if (!current) {
    return deriveStageArtifactBaseName(status)
  }

  return buildStageArtifactFileName(status, current.round)
}

export function resolveLatestStageArtifactFileName(taskId: number, status: TaskStatus): string | null {
  const runs = listTaskStageRuns(taskId)
  const latest = [...runs]
    .reverse()
    .find((run) => run.stageKey === status && run.artifactFileNames.length > 0)

  if (!latest) {
    return deriveStageArtifactBaseName(status)
  }

  return latest.artifactFileNames[latest.artifactFileNames.length - 1] ?? null
}

export function resolveLegacyStageArtifactFileName(status: TaskStatus): string | null {
  return deriveStageArtifactBaseName(status)
}

function updateTaskStatusWithStageRun(task: Task, nextStatus: TaskStatus): Task {
  const currentStatus = getTaskEngineStatus(task)
  if (currentStatus === nextStatus) {
    return task
  }

  if (isTrackableStage(currentStatus)) {
    finishTaskStageRun({
      taskId: task.id,
      stageKey: currentStatus,
      resultStatus: 'succeeded',
      artifactFileName: resolveCurrentStageArtifactFileName(task.id, currentStatus)
    })
  }

  const updated = persistTask({
    ...task,
    status: nextStatus
  })

  if (isTrackableStage(nextStatus)) {
    const hasOpen = hasOpenTaskStageRun({
      taskId: updated.id,
      stageKey: nextStatus
    })
    if (!hasOpen) {
      startTaskStageRun({
        taskId: updated.id,
        stageKey: nextStatus
      })
    }
  }

  return updated
}

function updateTaskByAction(task: Task, action: TaskTransitionAction): Task {
  if (isTaskWaitingHuman(task)) {
    throw new TaskServiceError('TRANSITION_INVALID', `状态流转非法: ${task.status} -> ${action}`)
  }

  if (action === 'review_fail') {
    const engineStatus = getTaskEngineStatus(task)
    if (engineStatus !== 'tech_reviewing') {
      throw new TaskServiceError('TRANSITION_INVALID', `状态流转非法: ${task.status} -> ${action}`)
    }

    const techReviewRejectCount = task.techReviewRejectCount + 1
    const shouldWait = techReviewRejectCount > 3
    const nextTask = persistTask({
      ...task,
      status: engineStatus,
      techReviewRejectCount,
      waitingContext: shouldWait ? 'tech_review_gate' : null,
      humanRevisionNote: ''
    })

    finishTaskStageRun({
      taskId: nextTask.id,
      stageKey: 'tech_reviewing',
      resultStatus: 'failed',
      failureReason: '技术评审未通过',
      artifactFileName: resolveCurrentStageArtifactFileName(nextTask.id, 'tech_reviewing')
    })

    return updateTaskStatusWithStageRun(nextTask, 'arch_designing')
  }

  if (action === 'qa_fail') {
    const engineStatus = getTaskEngineStatus(task)
    if (engineStatus !== 'qa_reviewing') {
      throw new TaskServiceError('TRANSITION_INVALID', `状态流转非法: ${task.status} -> ${action}`)
    }

    const qaRejectCount = task.qaRejectCount + 1
    const shouldWait = qaRejectCount > 3
    const nextTask = persistTask({
      ...task,
      status: engineStatus,
      qaRejectCount,
      waitingContext: shouldWait ? 'qa_gate' : null,
      humanRevisionNote: ''
    })

    finishTaskStageRun({
      taskId: nextTask.id,
      stageKey: 'qa_reviewing',
      resultStatus: 'failed',
      failureReason: 'QA/CR 评审未通过',
      artifactFileName: resolveCurrentStageArtifactFileName(nextTask.id, 'qa_reviewing')
    })

    return updateTaskStatusWithStageRun(nextTask, 'coding')
  }

  const status = resolveTransition(getTaskEngineStatus(task), action)
  const normalizedTask = persistTask({
    ...task,
    status: getTaskEngineStatus(task),
    waitingContext: null,
    humanRevisionNote: ''
  })
  clearTaskStageWaitingHuman(normalizedTask)

  return updateTaskStatusWithStageRun(normalizedTask, status)
}

function mapLegacyStatusToAction(current: TaskStatus, target: TaskStatus, waitingContext: TaskWaitingContext | null): TaskTransitionAction | null {
  if (current === target) {
    return null
  }

  if ((current === 'tech_reviewing' || (current === 'waiting_human' && waitingContext === 'tech_review_gate')) && (target === 'arch_designing' || target === 'waiting_human')) {
    return 'review_fail'
  }

  if (
    (current === 'qa_reviewing' || (current === 'waiting_human' && (waitingContext === 'qa_gate' || waitingContext === 'coding_gate'))) &&
    (target === 'coding' || target === 'waiting_human')
  ) {
    return 'qa_fail'
  }

  const currentForTransition =
    current === 'waiting_human'
      ? waitingContext === 'qa_gate' || waitingContext === 'coding_gate'
        ? 'qa_reviewing'
        : 'tech_reviewing'
      : current
  const entries = Object.entries(TASK_TRANSITIONS[currentForTransition]) as Array<[TaskTransitionAction, TaskStatus]>
  const match = entries.find(([, next]) => next === target)
  if (!match) {
    throw new TaskServiceError('TRANSITION_INVALID', `状态流转非法: ${current} -> ${target}`)
  }

  return match[0]
}

export function createTask(input: {
  projectId: number
  requirementId?: number | null
  title: string
  content?: string
}): Task {
  if (!Number.isInteger(input.projectId) || input.projectId <= 0) {
    throw new TaskServiceError('INVALID_INPUT', 'projectId 非法')
  }

  const title = input.title.trim()
  if (!title) {
    throw new TaskServiceError('INVALID_INPUT', '任务标题不能为空')
  }

  ensureProjectExists(input.projectId)

  const requirementId = input.requirementId ?? null
  if (requirementId !== null) {
    if (!Number.isInteger(requirementId) || requirementId <= 0) {
      throw new TaskServiceError('INVALID_INPUT', 'requirementId 非法')
    }
    ensureRequirementExists(requirementId)
  }

  try {
    return insertTask({
      projectId: input.projectId,
      requirementId,
      title,
      content: input.content?.trim() ?? '',
      status: 'idle',
      techReviewRejectCount: 0,
      qaRejectCount: 0,
      waitingContext: null,
      humanRevisionNote: ''
    })
  } catch (error) {
    throw new TaskServiceError('DB_ERROR', error instanceof Error ? error.message : '创建任务失败')
  }
}

export function getTaskDetail(taskId: number): Task {
  if (!Number.isInteger(taskId) || taskId <= 0) {
    throw new TaskServiceError('INVALID_INPUT', 'taskId 非法')
  }

  return toTaskView(ensureTaskByIdForEngine(taskId))
}

export function getTasksByRequirement(requirementId: number): Task[] {
  if (!Number.isInteger(requirementId) || requirementId <= 0) {
    throw new TaskServiceError('INVALID_INPUT', 'requirementId 非法')
  }

  ensureRequirementExists(requirementId)

  try {
    return listTasksByRequirement(requirementId).map((task) => {
      const normalized = normalizeTaskRuntime(task)
      if (normalized.waitingContext === task.waitingContext) {
        return toTaskView(normalized)
      }

      return toTaskView(persistTask(normalized))
    })
  } catch (error) {
    throw new TaskServiceError('DB_ERROR', error instanceof Error ? error.message : '读取任务失败')
  }
}

export function getTasksByProject(projectId: number): Task[] {
  return getTasksByProjectForEngine(projectId).map((task) => toTaskView(task))
}

export function getTasksGlobal(): Task[] {
  try {
    return listTasksGlobal().map((task) => {
      const runtimeTask = normalizeTaskRuntime(task)
      if (runtimeTask.waitingContext === task.waitingContext) {
        return toTaskView(runtimeTask)
      }

      return toTaskView(persistTask(runtimeTask))
    })
  } catch (error) {
    throw new TaskServiceError('DB_ERROR', error instanceof Error ? error.message : '读取任务失败')
  }
}

export function updateTaskDetail(input: {
  id: number
  title: string
  content?: string
  status: string
}): Task {
  if (!Number.isInteger(input.id) || input.id <= 0) {
    throw new TaskServiceError('INVALID_INPUT', 'taskId 非法')
  }

  const title = input.title.trim()
  if (!title) {
    throw new TaskServiceError('INVALID_INPUT', '任务标题不能为空')
  }

  const status = normalizeStatus(input.status)
  const task = ensureTaskByIdForEngine(input.id)

  const action = mapLegacyStatusToAction(task.status, status, resolveWaitingContextByTaskStatus(task))
  const draft = persistTask({
    ...task,
    title,
    content: input.content?.trim() ?? ''
  })

  if (!action) {
    return toTaskView(draft)
  }

  return toTaskView(updateTaskByAction(draft, action))
}

export function applyTaskAction(input: {
  id: number
  action: string
}): Task {
  if (!Number.isInteger(input.id) || input.id <= 0) {
    throw new TaskServiceError('INVALID_INPUT', 'taskId 非法')
  }

  const action = normalizeAction(input.action)
  const task = ensureTaskByIdForEngine(input.id)
  return toTaskView(updateTaskByAction(task, action))
}

function resolveHumanCommandTarget(task: Task, command: TaskHumanCommand): { status: TaskStatus; waitingContext: TaskWaitingContext | null } {
  const waitingContext = resolveWaitingContextByTaskStatus(task)
  if (!waitingContext) {
    throw new TaskServiceError('TRANSITION_INVALID', '当前状态不支持人工命令')
  }

  if (command === 'cancel') {
    return { status: 'idle', waitingContext: null }
  }

  if (command === 'force_pass') {
    if (waitingContext === 'tech_review_gate' || waitingContext === 'arch_design_gate') {
      return { status: 'tech_reviewing', waitingContext: null }
    }
    return { status: 'qa_reviewing', waitingContext: null }
  }

  return { status: task.status, waitingContext }
}

export function applyTaskHumanCommand(input: {
  id: number
  command: string
  note?: string
}): Task {
  if (!Number.isInteger(input.id) || input.id <= 0) {
    throw new TaskServiceError('INVALID_INPUT', 'taskId 非法')
  }

  const command = normalizeHumanCommand(input.command)
  const task = ensureTaskByIdForEngine(input.id)
  const waitingContext = resolveWaitingContextByTaskStatus(task)
  if (!waitingContext) {
    throw new TaskServiceError('TRANSITION_INVALID', '当前状态不支持人工命令')
  }

  if (command === 'revise') {
    const note = input.note?.trim() ?? ''
    if (!note) {
      throw new TaskServiceError('INVALID_INPUT', '人工备注不能为空')
    }

    const history = task.humanRevisionNote.trim()
    const nextNote = history ? `${history}\n人工补充: ${note}` : `人工补充: ${note}`
    const updated = persistTask({
      ...task,
      status: getTaskEngineStatus(task),
      waitingContext,
      humanRevisionNote: nextNote
    })

    return toTaskView(updated)
  }

  const target = resolveHumanCommandTarget(task, command)
  const shouldResetCounters = command === 'cancel'

  clearTaskStageWaitingHuman(task)

  const nextTask = persistTask({
    ...task,
    status: getTaskEngineStatus(task),
    waitingContext: target.waitingContext,
    techReviewRejectCount: shouldResetCounters ? 0 : task.techReviewRejectCount,
    qaRejectCount: shouldResetCounters ? 0 : task.qaRejectCount,
    humanRevisionNote: ''
  })

  return toTaskView(updateTaskStatusWithStageRun(nextTask, target.status))
}

export function markTaskCodingWaitingHuman(input: { id: number; reason: string }): Task {
  if (!Number.isInteger(input.id) || input.id <= 0) {
    throw new TaskServiceError('INVALID_INPUT', 'taskId 非法')
  }

  const reason = input.reason.trim()
  if (!reason) {
    throw new TaskServiceError('INVALID_INPUT', '等待原因不能为空')
  }

  const task = ensureTaskByIdForEngine(input.id)
  const engineStatus = getTaskEngineStatus(task)
  if (engineStatus !== 'coding') {
    throw new TaskServiceError('TRANSITION_INVALID', '当前任务不在编码阶段，无法进入人工处理')
  }

  const normalizedTask = persistTask({
    ...task,
    status: engineStatus,
    waitingContext: 'coding_gate',
    humanRevisionNote: ''
  })

  markTaskStageWaitingHuman(normalizedTask, reason)
  return toTaskView(normalizedTask)
}

export function finalizeTaskStageWaitingHumanIfNeeded(taskId: number, stageKey: TaskStatus): Task | null {
  if (!Number.isInteger(taskId) || taskId <= 0) {
    throw new TaskServiceError('INVALID_INPUT', 'taskId 非法')
  }

  const task = ensureTaskByIdForEngine(taskId)
  const normalizedStage = getTaskEngineStatus(task)
  if (normalizedStage !== stageKey) {
    return null
  }

  const reasonByContext: Partial<Record<TaskWaitingContext, string>> = {
    tech_review_gate: '技术评审未通过，等待人工处理',
    qa_gate: 'QA/CR 评审未通过，等待人工处理'
  }
  const reason = task.waitingContext ? reasonByContext[task.waitingContext] : undefined
  if (!reason) {
    return null
  }

  const waitingContext = task.waitingContext === 'tech_review_gate' ? 'arch_design_gate' : 'coding_gate'
  const waitingTask = persistTask({
    ...task,
    status: normalizedStage,
    waitingContext,
    humanRevisionNote: ''
  })

  markTaskStageWaitingHuman(waitingTask, reason)
  return toTaskView(waitingTask)
}

export function getAllowedTaskActions(status: TaskStatus): TaskTransitionAction[] {
  if (status === 'waiting_human') {
    return []
  }

  if (status === 'tech_reviewing') {
    return ['review_pass', 'review_fail']
  }

  if (status === 'qa_reviewing') {
    return ['qa_pass', 'qa_fail']
  }

  return Object.keys(TASK_TRANSITIONS[status]) as TaskTransitionAction[]
}

export function canApplyTaskAction(status: TaskStatus, action: TaskTransitionAction): boolean {
  if (status === 'waiting_human') {
    return false
  }

  if (status === 'tech_reviewing' && action === 'review_fail') {
    return true
  }

  if (status === 'qa_reviewing' && action === 'qa_fail') {
    return true
  }

  return Boolean(TASK_TRANSITIONS[status][action])
}

export function getAllowedTaskHumanCommands(task: Task): TaskHumanCommand[] {
  if (!isTaskWaitingHuman(task)) {
    return []
  }

  return ['force_pass', 'cancel', 'revise']
}

export function getTaskStageRuns(taskId: number): TaskStageRun[] {
  if (!Number.isInteger(taskId) || taskId <= 0) {
    throw new TaskServiceError('INVALID_INPUT', 'taskId 非法')
  }

  ensureTaskExists(taskId)

  try {
    return listTaskStageRuns(taskId)
  } catch (error) {
    throw new TaskServiceError('DB_ERROR', error instanceof Error ? error.message : '读取任务阶段运行记录失败')
  }
}

export function isTaskWaitingHumanStatus(task: Task): boolean {
  return isTaskWaitingHuman(task)
}

export function getTaskWaitingContext(task: Task): TaskWaitingContext | null {
  return resolveWaitingContextByTaskStatus(task)
}

export function ensureTaskCurrentStageRun(taskId: number): void {
  if (!Number.isInteger(taskId) || taskId <= 0) {
    throw new TaskServiceError('INVALID_INPUT', 'taskId 非法')
  }

  const task = ensureTaskByIdForEngine(taskId)
  const status = getTaskEngineStatus(task)
  if (!isTrackableStage(status)) {
    return
  }

  const hasOpen = hasOpenTaskStageRun({
    taskId: task.id,
    stageKey: status
  })
  if (hasOpen) {
    return
  }

  try {
    startTaskStageRun({
      taskId: task.id,
      stageKey: status
    })
  } catch (error) {
    throw new TaskServiceError('DB_ERROR', error instanceof Error ? error.message : '创建当前阶段运行记录失败')
  }
}
