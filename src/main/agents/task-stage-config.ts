import type { TaskStatus } from '../../shared/types'

export type OrchestratableTaskStatus = 'arch_designing' | 'tech_reviewing' | 'coding' | 'qa_reviewing' | 'deploying'

export const ORCHESTRATABLE_TASK_STATUSES: OrchestratableTaskStatus[] = [
  'arch_designing',
  'tech_reviewing',
  'coding',
  'qa_reviewing',
  'deploying'
]

export const STAGE_FALLBACK_ARTIFACT_FILE_NAME: Record<OrchestratableTaskStatus, string> = {
  arch_designing: 'arch_design.md',
  tech_reviewing: 'tech_review.json',
  coding: 'code.md',
  qa_reviewing: 'qa.json',
  deploying: 'deploy.md'
}

export function isOrchestratableTaskStatus(status: TaskStatus): status is OrchestratableTaskStatus {
  return ORCHESTRATABLE_TASK_STATUSES.includes(status as OrchestratableTaskStatus)
}
