import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  Project,
  Requirement,
  RequirementConversationMessage,
  RequirementStatus,
  RequirementTransitionAction,
  Task,
  TaskAgentTraceMessage,
  TaskStatus,
  TaskTransitionAction,
  TaskHumanCommand,
  TaskWaitingContext
} from '../../shared/types'
import { createProject, fetchProjects } from '../services/project-service'
import { pickText } from '../i18n'
import {
  applyRequirementAction,
  createRequirement,
  getRequirementAutoProcessorStatus,
  getRequirementConversation,
  listRequirementsByProject,
  processRequirement,
  replyRequirementConversation,
  startRequirementAutoProcessor,
  stopRequirementAutoProcessor,
  updateRequirementDetail
} from '../services/requirement-service'
import {
  applyTaskAction,
  applyTaskHumanCommand,
  createTask,
  getTaskAutoProcessorStatus,
  getTaskHumanConversation,
  listTasksByProject,
  listTasksByRequirement,
  orchestrateTask,
  replyTaskHumanConversation,
  startTaskAutoProcessor,
  stopTaskAutoProcessor,
  updateTaskDetail
} from '../services/task-service'

export interface RequirementDraft {
  id: number
  title: string
  content: string
  status: RequirementStatus
  source: string
}

export interface TaskDraft {
  id: number
  title: string
  content: string
  status: TaskStatus
}

export interface TaskHumanConversationData {
  task: Task
  waitingContext: TaskWaitingContext
  messages: TaskAgentTraceMessage[]
}

export type RequirementStatusFilter = 'pending' | 'processing' | 'queued' | 'canceled'

export type TaskStatusFilter = 'idle' | 'running' | 'waiting_human' | 'done'

const RUNNING_TASK_STATUSES: TaskStatus[] = ['arch_designing', 'tech_reviewing', 'coding', 'qa_reviewing', 'deploying']

function isTaskWaitingHuman(task: Task): boolean {
  return task.waitingContext === 'arch_design_gate' || task.waitingContext === 'coding_gate'
}

function getTaskDisplayStatus(task: Task): TaskStatus {
  return task.status
}

function getTaskDisplayWaitingContext(task: Task): Task['waitingContext'] {
  return task.waitingContext
}

function normalizeTaskView(task: Task): Task {
  return {
    ...task,
    status: getTaskDisplayStatus(task),
    waitingContext: getTaskDisplayWaitingContext(task)
  }
}

function normalizeTaskListView(tasks: Task[]): Task[] {
  return tasks.map((task) => normalizeTaskView(task))
}

function matchesRequirementStatusFilter(status: RequirementStatus, filter: RequirementStatusFilter): boolean {
  if (filter === 'processing') {
    return status === 'evaluating' || status === 'prd_designing' || status === 'prd_reviewing'
  }

  if (filter === 'queued') {
    return status === 'queued'
  }

  if (filter === 'canceled') {
    return status === 'canceled'
  }

  return status === 'pending'
}

function hydrateProjectData(input: {
  projectId: number
  requirements: Requirement[]
  projectTasksRaw: Task[]
  requirementStatusFilter: RequirementStatusFilter
  setRequirements: React.Dispatch<React.SetStateAction<Requirement[]>>
  setTasksByProjectId: React.Dispatch<React.SetStateAction<Record<number, Task[]>>>
  setTasksByRequirementId: React.Dispatch<React.SetStateAction<Record<number, Task[]>>>
  setSelectedRequirementId: React.Dispatch<React.SetStateAction<number | null>>
}) {
  const projectTasks = normalizeTaskListView(input.projectTasksRaw)
  input.setRequirements(input.requirements)
  input.setTasksByProjectId((prev) => ({
    ...prev,
    [input.projectId]: projectTasks
  }))
  input.setTasksByRequirementId((prev) => {
    const next: Record<number, Task[]> = {}
    for (const requirement of input.requirements) {
      next[requirement.id] = prev[requirement.id] ?? []
    }
    return next
  })
  input.setSelectedRequirementId((prev) => {
    if (prev) {
      const current = input.requirements.find((requirement) => requirement.id === prev)
      if (current && matchesRequirementStatusFilter(current.status, input.requirementStatusFilter)) {
        return prev
      }
    }

    const first =
      input.requirements.find((requirement) => matchesRequirementStatusFilter(requirement.status, input.requirementStatusFilter)) ??
      input.requirements[0]
    return first ? first.id : null
  })
}

export function useProjectState() {
  const [projects, setProjects] = useState<Project[]>([])
  const [requirements, setRequirements] = useState<Requirement[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null)
  const [selectedRequirementId, setSelectedRequirementId] = useState<number | null>(null)
  const [activeListType, setActiveListType] = useState<'requirement' | 'task'>('requirement')
  const [requirementStatusFilter, setRequirementStatusFilter] = useState<RequirementStatusFilter>('pending')
  const [taskStatusFilter, setTaskStatusFilter] = useState<TaskStatusFilter>('idle')
  const [tasksByRequirementId, setTasksByRequirementId] = useState<Record<number, Task[]>>({})
  const [tasksByProjectId, setTasksByProjectId] = useState<Record<number, Task[]>>({})
  const [autoProcessorRunning, setAutoProcessorRunning] = useState(false)
  const [autoProcessorStartedAt, setAutoProcessorStartedAt] = useState<number | null>(null)
  const [autoProcessorLoading, setAutoProcessorLoading] = useState(false)
  const [taskAutoProcessorRunning, setTaskAutoProcessorRunning] = useState(false)
  const [taskAutoProcessorStartedAt, setTaskAutoProcessorStartedAt] = useState<number | null>(null)
  const [taskAutoProcessorLoading, setTaskAutoProcessorLoading] = useState(false)
  const [clarifyMessagesByRequirementId, setClarifyMessagesByRequirementId] = useState<Record<number, RequirementConversationMessage[]>>({})
  const selectedProjectIdRef = useRef<number | null>(null)

  useEffect(() => {
    selectedProjectIdRef.current = selectedProjectId
  }, [selectedProjectId])

  const loadProjects = useCallback(async () => {
    try {
      const list = await fetchProjects()
      setProjects(list)
      setError('')

      setSelectedProjectId((prev) => {
        if (prev && list.some((project) => project.id === prev)) {
          return prev
        }

        return list.length > 0 ? list[0].id : null
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : pickText('读取项目失败', 'Failed to load projects'))
    }
  }, [])

  const loadRequirements = useCallback(
    async (projectId: number) => {
      const [list, projectTasksRaw] = await Promise.all([listRequirementsByProject(projectId), listTasksByProject(projectId)])
      if (selectedProjectIdRef.current !== projectId) {
        return
      }

      hydrateProjectData({
        projectId,
        requirements: list,
        projectTasksRaw,
        requirementStatusFilter,
        setRequirements,
        setTasksByProjectId,
        setTasksByRequirementId,
        setSelectedRequirementId
      })
      setError('')
    },
    [requirementStatusFilter]
  )

  const loadTasksByRequirement = useCallback(async (requirementId: number) => {
    const tasks = await listTasksByRequirement(requirementId)
    setTasksByRequirementId((prev) => ({
      ...prev,
      [requirementId]: normalizeTaskListView(tasks)
    }))
  }, [])

  const syncAutoProcessorStatus = useCallback(async () => {
    try {
      const data = await getRequirementAutoProcessorStatus()
      setAutoProcessorRunning(data.running)
      setAutoProcessorStartedAt(data.startedAt)
    } catch (e) {
      setError(e instanceof Error ? e.message : pickText('读取自动处理状态失败', 'Failed to load auto-processor status'))
    }
  }, [])

  const startAutoProcessor = useCallback(async () => {
    setAutoProcessorLoading(true)
    setError('')

    try {
      const data = await startRequirementAutoProcessor()
      setAutoProcessorRunning(data.running)
      setAutoProcessorStartedAt(data.startedAt)
      if (selectedProjectId) {
        await loadRequirements(selectedProjectId)
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : pickText('启动自动处理失败', 'Failed to start auto-processor')
      setError(message)
      throw new Error(message)
    } finally {
      setAutoProcessorLoading(false)
    }
  }, [loadRequirements, selectedProjectId])

  const stopAutoProcessor = useCallback(async () => {
    setAutoProcessorLoading(true)
    setError('')

    try {
      const data = await stopRequirementAutoProcessor()
      setAutoProcessorRunning(data.running)
      setAutoProcessorStartedAt(data.startedAt)

      if (selectedProjectId) {
        await loadRequirements(selectedProjectId)
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : pickText('关闭自动处理失败', 'Failed to stop auto-processor')
      setError(message)
      throw new Error(message)
    } finally {
      setAutoProcessorLoading(false)
    }
  }, [loadRequirements, selectedProjectId])

  const toggleAutoProcessor = useCallback(async () => {
    if (autoProcessorRunning) {
      await stopAutoProcessor()
      return
    }

    await startAutoProcessor()
  }, [autoProcessorRunning, startAutoProcessor, stopAutoProcessor])

  const syncTaskAutoProcessorStatus = useCallback(async () => {
    try {
      const data = await getTaskAutoProcessorStatus()
      setTaskAutoProcessorRunning(data.running)
      setTaskAutoProcessorStartedAt(data.startedAt)
    } catch (e) {
      setError(e instanceof Error ? e.message : pickText('读取任务自动处理状态失败', 'Failed to load task auto-processor status'))
    }
  }, [])

  const startTaskProcessor = useCallback(async () => {
    setTaskAutoProcessorLoading(true)
    setError('')

    try {
      const data = await startTaskAutoProcessor()
      setTaskAutoProcessorRunning(data.running)
      setTaskAutoProcessorStartedAt(data.startedAt)
      if (selectedProjectId) {
        await loadRequirements(selectedProjectId)
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : pickText('启动任务自动处理失败', 'Failed to start task auto-processor')
      setError(message)
      throw new Error(message)
    } finally {
      setTaskAutoProcessorLoading(false)
    }
  }, [loadRequirements, selectedProjectId])

  const stopTaskProcessor = useCallback(async () => {
    setTaskAutoProcessorLoading(true)
    setError('')

    try {
      const data = await stopTaskAutoProcessor()
      setTaskAutoProcessorRunning(data.running)
      setTaskAutoProcessorStartedAt(data.startedAt)

      if (selectedProjectId) {
        await loadRequirements(selectedProjectId)
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : pickText('关闭任务自动处理失败', 'Failed to stop task auto-processor')
      setError(message)
      throw new Error(message)
    } finally {
      setTaskAutoProcessorLoading(false)
    }
  }, [loadRequirements, selectedProjectId])

  const toggleTaskProcessor = useCallback(async () => {
    if (taskAutoProcessorRunning) {
      await stopTaskProcessor()
      return
    }

    await startTaskProcessor()
  }, [startTaskProcessor, stopTaskProcessor, taskAutoProcessorRunning])

  useEffect(() => {
    void loadProjects()
    void syncAutoProcessorStatus()
    void syncTaskAutoProcessorStatus()
  }, [loadProjects, syncAutoProcessorStatus, syncTaskAutoProcessorStatus])

  useEffect(() => {
    if (!selectedProjectId) {
      setRequirements([])
      setSelectedRequirementId(null)
      setTasksByRequirementId({})
      setTasksByProjectId({})
      return
    }

    let cancelled = false

    const run = async () => {
      try {
        const [list, projectTasksRaw] = await Promise.all([listRequirementsByProject(selectedProjectId), listTasksByProject(selectedProjectId)])
        if (cancelled) {
          return
        }

        hydrateProjectData({
          projectId: selectedProjectId,
          requirements: list,
          projectTasksRaw,
          requirementStatusFilter,
          setRequirements,
          setTasksByProjectId,
          setTasksByRequirementId,
          setSelectedRequirementId
        })
        setError('')
      } catch (e) {
        if (cancelled) {
          return
        }

        setError(e instanceof Error ? e.message : pickText('读取需求失败', 'Failed to load requirements'))
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [selectedProjectId, requirementStatusFilter])

  useEffect(() => {
    if (!window.api || typeof window.api.onRequirementStatusChanged !== 'function') {
      return
    }

    let inFlight = false
    let pending = false

    const refresh = () => {
      if (!selectedProjectId) {
        return
      }

      if (inFlight) {
        pending = true
        return
      }

      inFlight = true
      void loadRequirements(selectedProjectId)
        .catch(() => {
          // ignore push-refresh errors; user interactions will surface meaningful errors
        })
        .finally(() => {
          inFlight = false
          if (pending) {
            pending = false
            refresh()
          }
        })
    }

    const unsubscribe = window.api.onRequirementStatusChanged((event) => {
      if (!selectedProjectId || event.projectId !== selectedProjectId) {
        return
      }

      refresh()
    })

    return () => {
      unsubscribe()
    }
  }, [selectedProjectId, loadRequirements])

  useEffect(() => {
    if (!window.api || typeof window.api.onTaskStatusChanged !== 'function') {
      return
    }

    let inFlight = false
    let pending = false

    const refresh = () => {
      if (!selectedProjectId) {
        return
      }

      if (inFlight) {
        pending = true
        return
      }

      inFlight = true
      void loadRequirements(selectedProjectId)
        .catch(() => {
          // ignore push-refresh errors; user interactions will surface meaningful errors
        })
        .finally(() => {
          inFlight = false
          if (pending) {
            pending = false
            refresh()
          }
        })
    }

    const unsubscribe = window.api.onTaskStatusChanged((event) => {
      if (!selectedProjectId || event.projectId !== selectedProjectId) {
        return
      }

      refresh()
    })

    return () => {
      unsubscribe()
    }
  }, [selectedProjectId, loadRequirements])

  useEffect(() => {
    if (!selectedRequirementId) {
      return
    }

    void loadTasksByRequirement(selectedRequirementId).catch(() => {
      setTasksByRequirementId((prev) => ({
        ...prev,
        [selectedRequirementId]: prev[selectedRequirementId] ?? []
      }))
    })
  }, [selectedRequirementId, loadTasksByRequirement])

  const addProject = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      let selectedPath: string | null = null

      if (window.api && typeof window.api.selectDirectory === 'function') {
        selectedPath = await window.api.selectDirectory()
      } else {
        throw new Error(pickText('系统目录选择器不可用，请重启应用', 'System directory picker is unavailable. Please restart the app.'))
      }

      if (!selectedPath) {
        return
      }

      const project = await createProject({ path: selectedPath })
      setProjects((prev) => [project, ...prev])
      setSelectedProjectId(project.id)
    } catch (e) {
      const message = e instanceof Error ? e.message : pickText('创建项目失败', 'Failed to create project')
      setError(message)
      throw new Error(message)
    } finally {
      setLoading(false)
    }
  }, [])

  const selectProject = useCallback((projectId: number) => {
    setSelectedProjectId(projectId)
    setSelectedRequirementId(null)
  }, [])

  const setStatusFilter = useCallback((status: RequirementStatusFilter) => {
    setRequirementStatusFilter(status)
  }, [])

  const setTaskFilter = useCallback((status: TaskStatusFilter) => {
    setTaskStatusFilter(status)
  }, [])

  const selectRequirement = useCallback((requirementId: number) => {
    setSelectedRequirementId(requirementId)
  }, [])

  const replaceTaskInState = useCallback(
    (task: Task) => {
      if (task.requirementId !== null) {
        setTasksByRequirementId((prev) => {
          const requirementId = task.requirementId as number
          const list = prev[requirementId] ?? []
          const exists = list.some((item) => item.id === task.id)
          return {
            ...prev,
            [requirementId]: exists ? list.map((item) => (item.id === task.id ? task : item)) : [task, ...list]
          }
        })
      }

      if (selectedProjectId && task.projectId === selectedProjectId) {
        setTasksByProjectId((prev) => {
          const list = prev[selectedProjectId] ?? []
          const exists = list.some((item) => item.id === task.id)
          return {
            ...prev,
            [selectedProjectId]: exists ? list.map((item) => (item.id === task.id ? task : item)) : [task, ...list]
          }
        })
      }
    },
    [selectedProjectId]
  )

  const createTaskItem = useCallback(
    async (projectId: number, title: string, content?: string, requirementId?: number | null) => {
      const normalized = title.trim()
      if (!normalized) {
        throw new Error(pickText('任务标题不能为空', 'Task title cannot be empty'))
      }

      setLoading(true)
      setError('')

      try {
        const task = await createTask({
          projectId,
          requirementId: requirementId ?? null,
          title: normalized,
          content: content?.trim() ?? ''
        })

        replaceTaskInState(normalizeTaskView(task))
      } catch (e) {
        const message = e instanceof Error ? e.message : pickText('创建任务失败', 'Failed to create task')
        setError(message)
        throw new Error(message)
      } finally {
        setLoading(false)
      }
    },
    [replaceTaskInState]
  )

  const saveTask = useCallback(
    async (draft: TaskDraft) => {
      setLoading(true)
      setError('')

      try {
        const task = await updateTaskDetail({
          id: draft.id,
          title: draft.title,
          content: draft.content,
          status: draft.status
        })

        replaceTaskInState(normalizeTaskView(task))
      } catch (e) {
        const message = e instanceof Error ? e.message : pickText('保存任务失败', 'Failed to save task')
        setError(message)
        throw new Error(message)
      } finally {
        setLoading(false)
      }
    },
    [replaceTaskInState]
  )

  const applyTaskTransition = useCallback(
    async (taskId: number, action: TaskTransitionAction) => {
      setLoading(true)
      setError('')

      try {
        const task = await applyTaskAction({ id: taskId, action })
        const normalizedTask = normalizeTaskView(task)
        replaceTaskInState(normalizedTask)
        return normalizedTask
      } catch (e) {
        const message = e instanceof Error ? e.message : pickText('更新任务状态失败', 'Failed to update task status')
        setError(message)
        throw new Error(message)
      } finally {
        setLoading(false)
      }
    },
    [replaceTaskInState]
  )

  const runTaskOrchestrator = useCallback(
    async (taskId: number) => {
      setLoading(true)
      setError('')

      try {
        const task = await orchestrateTask(taskId)
        const normalizedTask = normalizeTaskView(task)
        replaceTaskInState(normalizedTask)
        return normalizedTask
      } catch (e) {
        const message = e instanceof Error ? e.message : pickText('执行任务编排失败', 'Failed to orchestrate task')
        setError(message)
        throw new Error(message)
      } finally {
        setLoading(false)
      }
    },
    [replaceTaskInState]
  )

  const applyTaskCommand = useCallback(
    async (taskId: number, command: TaskHumanCommand, note?: string) => {
      setLoading(true)
      setError('')

      try {
        const task = await applyTaskHumanCommand({ id: taskId, command, note })
        const normalizedTask = normalizeTaskView(task)
        replaceTaskInState(normalizedTask)

        if (command === 'force_pass') {
          const continued = await orchestrateTask(task.id)
          const normalizedContinued = normalizeTaskView(continued)
          replaceTaskInState(normalizedContinued)
          return normalizedContinued
        }

        return normalizedTask
      } catch (e) {
        const message = e instanceof Error ? e.message : pickText('执行人工命令失败', 'Failed to execute human command')
        setError(message)
        throw new Error(message)
      } finally {
        setLoading(false)
      }
    },
    [replaceTaskInState]
  )

  const loadTaskHumanConversation = useCallback(async (taskId: number): Promise<TaskHumanConversationData> => {
    setLoading(true)
    setError('')

    try {
      const data = await getTaskHumanConversation({ taskId })
      replaceTaskInState(normalizeTaskView(data.task))
      return {
        ...data,
        task: normalizeTaskView(data.task)
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : pickText('读取人工会话失败', 'Failed to load human conversation')
      setError(message)
      throw new Error(message)
    } finally {
      setLoading(false)
    }
  }, [replaceTaskInState])

  const sendTaskHumanConversation = useCallback(
    async (taskId: number, message: string): Promise<TaskHumanConversationData> => {
      setLoading(true)
      setError('')

      try {
        const data = await replyTaskHumanConversation({ taskId, message })
        replaceTaskInState(normalizeTaskView(data.task))
        return {
          ...data,
          task: normalizeTaskView(data.task)
        }
      } catch (e) {
        const text = e instanceof Error ? e.message : pickText('人工会话回复失败', 'Failed to reply in human conversation')
        setError(text)
        throw new Error(text)
      } finally {
        setLoading(false)
      }
    },
    [replaceTaskInState]
  )

  const getAllowedTaskActions = useCallback((status: TaskStatus): TaskTransitionAction[] => {
    if (status === 'idle') {
      return ['pick_next']
    }

    if (status === 'arch_designing') {
      return ['arch_done']
    }

    if (status === 'tech_reviewing') {
      return ['review_pass', 'review_fail']
    }

    if (status === 'coding') {
      return ['coding_done']
    }

    if (status === 'qa_reviewing') {
      return ['qa_pass', 'qa_fail']
    }

    if (status === 'deploying') {
      return ['deploy_done']
    }

    return []
  }, [])

  const canApplyTaskTransition = useCallback(
    (status: TaskStatus, action: TaskTransitionAction) => {
      return getAllowedTaskActions(status).includes(action)
    },
    [getAllowedTaskActions]
  )

  const getAllowedTaskHumanCommands = useCallback((task: Task): TaskHumanCommand[] => {
    if (!isTaskWaitingHuman(task)) {
      return []
    }

    return ['force_pass', 'cancel', 'revise']
  }, [])

  const canApplyTaskHumanCommand = useCallback(
    (task: Task, command: TaskHumanCommand) => {
      return getAllowedTaskHumanCommands(task).includes(command)
    },
    [getAllowedTaskHumanCommands]
  )

  const createRequirementItem = useCallback(
    async (title: string, content?: string, source?: string, projectId?: number): Promise<Requirement> => {
      const targetProjectId = projectId ?? selectedProjectId
      if (!targetProjectId) {
        throw new Error(pickText('请先选择项目', 'Please select a project first'))
      }

      const normalized = title.trim()
      if (!normalized) {
        throw new Error(pickText('需求标题不能为空', 'Requirement title cannot be empty'))
      }

      setLoading(true)
      setError('')

      try {
        const requirement = await createRequirement({
          projectId: targetProjectId,
          title: normalized,
          content: content?.trim() ?? '',
          source: source?.trim() ?? ''
        })

        if (targetProjectId === selectedProjectId) {
          setRequirements((prev) => [requirement, ...prev])
          setTasksByRequirementId((prev) => ({
            ...prev,
            [requirement.id]: []
          }))
          setSelectedRequirementId(requirement.id)
        }

        return requirement
      } catch (e) {
        const message = e instanceof Error ? e.message : pickText('创建需求失败', 'Failed to create requirement')
        setError(message)
        throw new Error(message)
      } finally {
        setLoading(false)
      }
    },
    [selectedProjectId]
  )

  const createRequirementPending = useCallback(
    async (title: string, content: string, source?: string, projectId?: number) => {
      return createRequirementItem(title, content, source, projectId)
    },
    [createRequirementItem]
  )

  const processRequirementItem = useCallback(async (requirementId: number, type: string, source: string) => {
    setLoading(true)
    setError('')

    try {
      const outcome = await processRequirement({
        requirementId,
        type,
        source
      })

      const requirement = outcome.requirement
      setRequirements((prev) => prev.map((item) => (item.id === requirement.id ? requirement : item)))
      setSelectedRequirementId(requirement.id)
      return outcome
    } catch (e) {
      const message = e instanceof Error ? e.message : pickText('处理需求失败', 'Failed to process requirement')
      setError(message)
      throw new Error(message)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadRequirementConversation = useCallback(async (
    requirementId: number,
    sessionId?: string,
    options?: { background?: boolean }
  ) => {
    const shouldManageGlobalLoading = !options?.background
    if (shouldManageGlobalLoading) {
      setLoading(true)
      setError('')
    }

    try {
      const data = await getRequirementConversation(requirementId, { sessionId })
      setClarifyMessagesByRequirementId((prev) => ({
        ...prev,
        [requirementId]: data.messages
      }))
      setRequirements((prev) => prev.map((item) => (item.id === data.requirement.id ? data.requirement : item)))
      return data
    } catch (e) {
      const message = e instanceof Error ? e.message : pickText('读取会话失败', 'Failed to load conversation')
      if (shouldManageGlobalLoading) {
        setError(message)
      }
      throw new Error(message)
    } finally {
      if (shouldManageGlobalLoading) {
        setLoading(false)
      }
    }
  }, [])

  const clarifyRequirement = useCallback(
    async (requirementId: number, message: string) => {
      const normalized = message.trim()
      if (!normalized) {
        throw new Error(pickText('澄清消息不能为空', 'Clarification message cannot be empty'))
      }

      const optimisticUserMessageId = `optimistic-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

      setClarifyMessagesByRequirementId((prev) => {
        const current = prev[requirementId] ?? []
        return {
          ...prev,
          [requirementId]: [
            ...current,
            {
              id: optimisticUserMessageId,
              role: 'user',
              content: normalized
            }
          ]
        }
      })

      setLoading(true)
      setError('')

      try {
        const data = await replyRequirementConversation(requirementId, normalized)
        setRequirements((prev) => prev.map((item) => (item.id === data.requirement.id ? data.requirement : item)))
        setSelectedRequirementId(data.requirement.id)
        setClarifyMessagesByRequirementId((prev) => ({
          ...prev,
          [requirementId]: data.messages
        }))

        return data
      } catch (e) {
        const messageText = e instanceof Error ? e.message : pickText('澄清需求失败', 'Failed to clarify requirement')
        setClarifyMessagesByRequirementId((prev) => {
          const current = prev[requirementId] ?? []
          return {
            ...prev,
            [requirementId]: current.filter((item) => item.id !== optimisticUserMessageId)
          }
        })
        setError(messageText)
        throw new Error(messageText)
      } finally {
        setLoading(false)
      }
    },
    []
  )

  const getClarifyMessages = useCallback(
    (requirementId: number) => {
      return clarifyMessagesByRequirementId[requirementId] ?? []
    },
    [clarifyMessagesByRequirementId]
  )

  const clearClarifyMessages = useCallback((requirementId: number) => {
    setClarifyMessagesByRequirementId((prev) => {
      if (!(requirementId in prev)) {
        return prev
      }

      const next = { ...prev }
      delete next[requirementId]
      return next
    })
  }, [])

  const createAndProcessRequirement = useCallback(
    async (title: string, content: string, type: string, source: string) => {
      const requirement = await createRequirementItem(title, content, source)

      const processingRequirement = await applyRequirementAction({
        id: requirement.id,
        action: 'grab'
      })

      setRequirements((prev) => prev.map((item) => (item.id === processingRequirement.id ? processingRequirement : item)))
      setSelectedRequirementId(processingRequirement.id)

      return processRequirementItem(processingRequirement.id, type, source)
    },
    [createRequirementItem, processRequirementItem]
  )

  const createRequirementWithMode = useCallback(
    async (input: { title: string; content: string; mode: 'create_only' | 'create_and_process'; type: string; source: string }) => {
      if (input.mode === 'create_and_process') {
        return createAndProcessRequirement(input.title, input.content, input.type, input.source)
      }

      return createRequirementPending(input.title, input.content, input.source)
    },
    [createAndProcessRequirement, createRequirementPending]
  )

  const saveRequirement = useCallback(
    async (draft: RequirementDraft) => {
      const current = requirements.find((item) => item.id === draft.id)
      if (!current) {
        throw new Error(pickText('需求不存在', 'Requirement not found'))
      }

      setLoading(true)
      setError('')

      try {
        const requirement = await updateRequirementDetail({
          id: draft.id,
          title: draft.title,
          content: draft.content,
          status: current.status,
          source: draft.source
        })

        setRequirements((prev) => prev.map((item) => (item.id === requirement.id ? requirement : item)))
        setSelectedRequirementId(requirement.id)
      } catch (e) {
        const message = e instanceof Error ? e.message : pickText('保存需求失败', 'Failed to save requirement')
        setError(message)
        throw new Error(message)
      } finally {
        setLoading(false)
      }
    },
    [requirements]
  )

  const applyRequirementTransition = useCallback(async (requirementId: number, action: RequirementTransitionAction) => {
    setLoading(true)
    setError('')

    try {
      const requirement = await applyRequirementAction({
        id: requirementId,
        action
      })

      setRequirements((prev) => prev.map((item) => (item.id === requirement.id ? requirement : item)))
      setSelectedRequirementId(requirement.id)
    } catch (e) {
      const message = e instanceof Error ? e.message : pickText('更新需求状态失败', 'Failed to update requirement status')
      setError(message)
      throw new Error(message)
    } finally {
      setLoading(false)
    }
  }, [])

  const canApplyRequirementTransition = useCallback((status: RequirementStatus, action: RequirementTransitionAction) => {
    if (status === 'pending') {
      return action === 'grab'
    }

    if (status === 'evaluating') {
      return action === 'evaluate_pass' || action === 'evaluate_fail' || action === 'error' || action === 'timeout'
    }

    if (status === 'prd_designing') {
      return action === 'design_done' || action === 'error' || action === 'timeout'
    }

    if (status === 'prd_reviewing') {
      return action === 'review_pass' || action === 'review_fail' || action === 'error' || action === 'timeout'
    }

    return false
  }, [])

  const getAllowedRequirementActions = useCallback((status: RequirementStatus): RequirementTransitionAction[] => {
    if (status === 'pending') {
      return ['grab']
    }

    if (status === 'evaluating') {
      return ['evaluate_pass', 'evaluate_fail', 'error', 'timeout']
    }

    if (status === 'prd_designing') {
      return ['design_done', 'error', 'timeout']
    }

    if (status === 'prd_reviewing') {
      return ['review_pass', 'review_fail', 'error', 'timeout']
    }

    return []
  }, [])

  const filteredRequirements = useMemo(
    () => requirements.filter((requirement) => matchesRequirementStatusFilter(requirement.status, requirementStatusFilter)),
    [requirements, requirementStatusFilter]
  )

  const projectTasks = useMemo(() => {
    if (!selectedProjectId) {
      return []
    }

    return tasksByProjectId[selectedProjectId] ?? []
  }, [tasksByProjectId, selectedProjectId])

  const filteredTasks = useMemo(() => {
    if (taskStatusFilter === 'idle' || taskStatusFilter === 'done') {
      return projectTasks.filter((task) => getTaskDisplayStatus(task) === taskStatusFilter)
    }

    if (taskStatusFilter === 'waiting_human') {
      return projectTasks.filter((task) => isTaskWaitingHuman(task))
    }

    return projectTasks.filter((task) => RUNNING_TASK_STATUSES.includes(getTaskDisplayStatus(task)))
  }, [projectTasks, taskStatusFilter])

  const selectedRequirement = useMemo(
    () => requirements.find((requirement) => requirement.id === selectedRequirementId) ?? null,
    [requirements, selectedRequirementId]
  )

  const tasksForSelectedRequirement = useMemo(() => {
    if (!selectedRequirementId) {
      return []
    }

    return tasksByRequirementId[selectedRequirementId] ?? []
  }, [tasksByRequirementId, selectedRequirementId])

  return {
    projects,
    requirements,
    filteredRequirements,
    filteredTasks,
    projectTasks,
    selectedProjectId,
    selectedRequirementId,
    selectedRequirement,
    activeListType,
    requirementStatusFilter,
    taskStatusFilter,
    tasksByRequirementId,
    tasksForSelectedRequirement,
    loading,
    error,
    autoProcessorRunning,
    autoProcessorStartedAt,
    autoProcessorLoading,
    taskAutoProcessorRunning,
    taskAutoProcessorStartedAt,
    taskAutoProcessorLoading,
    addProject,
    selectProject,
    setActiveListType,
    setStatusFilter,
    setTaskFilter,
    selectRequirement,
    createRequirementItem,
    createRequirementPending,
    createAndProcessRequirement,
    createRequirementWithMode,
    clarifyRequirement,
    loadRequirementConversation,
    getClarifyMessages,
    clearClarifyMessages,
    saveRequirement,
    applyRequirementTransition,
    canApplyRequirementTransition,
    getAllowedRequirementActions,
    createTaskItem,
    saveTask,
    applyTaskTransition,
    applyTaskCommand,
    loadTaskHumanConversation,
    sendTaskHumanConversation,
    runTaskOrchestrator,
    canApplyTaskTransition,
    canApplyTaskHumanCommand,
    getAllowedTaskActions,
    getAllowedTaskHumanCommands,
    startAutoProcessor,
    stopAutoProcessor,
    toggleAutoProcessor,
    startTaskProcessor,
    stopTaskProcessor,
    toggleTaskProcessor,
    syncAutoProcessorStatus,
    syncTaskAutoProcessorStatus,
    loadTasksByRequirement,
    reloadProjects: loadProjects,
    reloadRequirements: loadRequirements
  }
}
