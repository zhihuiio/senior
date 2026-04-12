import { getDb } from './db'
import { getRequirementById, insertRequirement, listRequirementsByProject, listRequirementsGlobal, updateRequirement } from './requirement-repo'
import type { Requirement, RequirementStandardizedData, RequirementStatus, RequirementTransitionAction } from '../shared/types'

const VALID_REQUIREMENT_STATUS: RequirementStatus[] = ['pending', 'evaluating', 'prd_designing', 'prd_reviewing', 'queued', 'canceled']

const REQUIREMENT_TRANSITIONS: Record<RequirementStatus, Partial<Record<RequirementTransitionAction, RequirementStatus>>> = {
  pending: { grab: 'evaluating' },
  evaluating: {
    evaluate_pass: 'prd_designing',
    evaluate_fail: 'canceled',
    error: 'pending',
    timeout: 'pending'
  },
  prd_designing: {
    design_done: 'prd_reviewing',
    error: 'pending',
    timeout: 'pending'
  },
  prd_reviewing: {
    review_pass: 'queued',
    review_fail: 'prd_designing',
    error: 'prd_designing',
    timeout: 'prd_designing'
  },
  queued: {},
  canceled: {}
}

export class RequirementServiceError extends Error {
  constructor(public readonly code: 'INVALID_INPUT' | 'DB_ERROR' | 'NOT_FOUND' | 'STATUS_INVALID' | 'ACTION_INVALID' | 'TRANSITION_INVALID', message: string) {
    super(message)
  }
}

function ensureProjectExists(projectId: number): void {
  const db = getDb()
  const row = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId) as { id: number } | undefined
  if (!row) {
    throw new RequirementServiceError('NOT_FOUND', '项目不存在')
  }
}

function ensureRequirementExists(requirementId: number): Requirement {
  const requirement = getRequirementById(requirementId)
  if (!requirement) {
    throw new RequirementServiceError('NOT_FOUND', '需求不存在')
  }

  return requirement
}

function normalizeStatus(status: string): RequirementStatus {
  if (!VALID_REQUIREMENT_STATUS.includes(status as RequirementStatus)) {
    throw new RequirementServiceError('STATUS_INVALID', '需求状态非法')
  }

  return status as RequirementStatus
}

function normalizeAction(action: string): RequirementTransitionAction {
  const allowed: RequirementTransitionAction[] = [
    'grab',
    'evaluate_pass',
    'evaluate_fail',
    'design_done',
    'review_pass',
    'review_fail',
    'error',
    'timeout',
    // legacy actions accepted and mapped below
    'accept',
    'clarify',
    'human_reply',
    'skip',
    'retry'
  ]
  if (!allowed.includes(action as RequirementTransitionAction)) {
    throw new RequirementServiceError('ACTION_INVALID', '需求动作非法')
  }

  return action as RequirementTransitionAction
}

function mapLegacyAction(action: RequirementTransitionAction): RequirementTransitionAction {
  if (action === 'accept') {
    return 'review_pass'
  }
  if (action === 'clarify' || action === 'human_reply' || action === 'retry') {
    return 'grab'
  }
  if (action === 'skip') {
    return 'evaluate_fail'
  }

  return action
}

function resolveTransition(current: RequirementStatus, action: RequirementTransitionAction): RequirementStatus {
  const next = REQUIREMENT_TRANSITIONS[current][action]
  if (!next) {
    throw new RequirementServiceError('TRANSITION_INVALID', `状态流转非法: ${current} -> ${action}`)
  }

  return next
}

function persistRequirement(requirement: Requirement): Requirement {
  try {
    const updated = updateRequirement({
      id: requirement.id,
      title: requirement.title,
      content: requirement.content,
      status: requirement.status,
      source: requirement.source,
      standardizedData: requirement.standardizedData,
      prdReviewRejectCount: requirement.prdReviewRejectCount,
      waitingContext: requirement.waitingContext,
      humanRevisionNote: requirement.humanRevisionNote,
      agentProcess: requirement.agentProcess,
      agentSessionId: requirement.agentSessionId
    })

    if (!updated) {
      throw new RequirementServiceError('NOT_FOUND', '需求不存在')
    }

    return updated
  } catch (error) {
    if (error instanceof RequirementServiceError) {
      throw error
    }

    throw new RequirementServiceError('DB_ERROR', error instanceof Error ? error.message : '更新需求失败')
  }
}

function updateByAction(requirement: Requirement, action: RequirementTransitionAction): Requirement {
  const normalizedAction = mapLegacyAction(action)
  const current = requirement.status

  if (normalizedAction === 'review_fail') {
    if (current !== 'prd_reviewing') {
      throw new RequirementServiceError('TRANSITION_INVALID', `状态流转非法: ${current} -> ${normalizedAction}`)
    }

    const nextRejectCount = requirement.prdReviewRejectCount + 1
    const shouldWait = nextRejectCount > 3
    const updated = persistRequirement({
      ...requirement,
      status: current,
      prdReviewRejectCount: nextRejectCount,
      waitingContext: shouldWait ? 'prd_review_gate' : null
    })

    return persistRequirement({
      ...updated,
      status: 'prd_designing'
    })
  }

  if (normalizedAction === 'grab') {
    if (current === 'pending') {
      return persistRequirement({
        ...requirement,
        status: 'evaluating',
        waitingContext: null
      })
    }
    if (current === 'evaluating') {
      return persistRequirement({
        ...requirement,
        status: 'evaluating',
        waitingContext: null
      })
    }
    throw new RequirementServiceError('TRANSITION_INVALID', `状态流转非法: ${current} -> ${normalizedAction}`)
  }

  const nextStatus = resolveTransition(current, normalizedAction)
  return persistRequirement({
    ...requirement,
    status: nextStatus,
    waitingContext: null,
    humanRevisionNote: ''
  })
}

function mapLegacyStatusToAction(current: RequirementStatus, target: RequirementStatus): RequirementTransitionAction | null {
  if (current === target) {
    return null
  }

  const entries = Object.entries(REQUIREMENT_TRANSITIONS[current]) as Array<[RequirementTransitionAction, RequirementStatus]>
  const match = entries.find(([, next]) => next === target)

  if (!match) {
    throw new RequirementServiceError('TRANSITION_INVALID', `状态流转非法: ${current} -> ${target}`)
  }

  return match[0]
}

export function createRequirement(input: {
  projectId: number
  title: string
  content?: string
  source?: string
}): Requirement {
  if (!Number.isInteger(input.projectId) || input.projectId <= 0) {
    throw new RequirementServiceError('INVALID_INPUT', 'projectId 非法')
  }

  const title = input.title.trim()
  if (!title) {
    throw new RequirementServiceError('INVALID_INPUT', '需求标题不能为空')
  }

  ensureProjectExists(input.projectId)

  try {
    return insertRequirement({
      projectId: input.projectId,
      title,
      content: input.content?.trim() ?? '',
      status: 'pending',
      source: input.source?.trim() ?? '',
      standardizedData: null,
      prdReviewRejectCount: 0,
      waitingContext: null,
      humanRevisionNote: '',
      agentProcess: '',
      agentSessionId: null
    })
  } catch (error) {
    throw new RequirementServiceError('DB_ERROR', error instanceof Error ? error.message : '创建需求失败')
  }
}

export function getRequirementsByProject(projectId: number): Requirement[] {
  if (!Number.isInteger(projectId) || projectId <= 0) {
    throw new RequirementServiceError('INVALID_INPUT', 'projectId 非法')
  }

  ensureProjectExists(projectId)

  try {
    return listRequirementsByProject(projectId)
  } catch (error) {
    throw new RequirementServiceError('DB_ERROR', error instanceof Error ? error.message : '读取需求失败')
  }
}

export function getRequirementsGlobal(): Requirement[] {
  try {
    return listRequirementsGlobal()
  } catch (error) {
    throw new RequirementServiceError('DB_ERROR', error instanceof Error ? error.message : '读取需求失败')
  }
}

export function updateRequirementDetail(input: {
  id: number
  title: string
  content?: string
  status: string
  source?: string
  standardizedData?: RequirementStandardizedData | null
  agentProcess?: string
  agentSessionId?: string | null
}): Requirement {
  if (!Number.isInteger(input.id) || input.id <= 0) {
    throw new RequirementServiceError('INVALID_INPUT', 'requirementId 非法')
  }

  const title = input.title.trim()
  if (!title) {
    throw new RequirementServiceError('INVALID_INPUT', '需求标题不能为空')
  }

  const targetStatus = normalizeStatus(input.status)
  const current = ensureRequirementExists(input.id)
  const action = mapLegacyStatusToAction(current.status, targetStatus)

  const draft = persistRequirement({
    ...current,
    title,
    content: input.content?.trim() ?? '',
    source: input.source?.trim() ?? current.source,
    standardizedData: input.standardizedData ?? current.standardizedData,
    agentProcess: input.agentProcess ?? current.agentProcess,
    agentSessionId: input.agentSessionId ?? current.agentSessionId
  })

  if (!action) {
    return draft
  }

  return updateByAction(draft, action)
}

export function applyRequirementAction(input: {
  id: number
  action: string
}): Requirement {
  if (!Number.isInteger(input.id) || input.id <= 0) {
    throw new RequirementServiceError('INVALID_INPUT', 'requirementId 非法')
  }

  const action = normalizeAction(input.action)
  const current = ensureRequirementExists(input.id)
  return updateByAction(current, action)
}

export function getAllowedActions(status: RequirementStatus): RequirementTransitionAction[] {
  return Object.keys(REQUIREMENT_TRANSITIONS[status]) as RequirementTransitionAction[]
}

export function canApplyRequirementAction(status: RequirementStatus, action: RequirementTransitionAction): boolean {
  return Boolean(REQUIREMENT_TRANSITIONS[status][mapLegacyAction(action)])
}
