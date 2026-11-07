import { effectiveStatus, productionSummary, type TaskNode } from './production'

export const PLAN_STATUSES = {
  not_started: 'Onboarding not started yet',
  in_progress: 'In progress',
  locked: 'Plan locked',
} as const

export const PRODUCTION_STATUSES = {
  waiting: 'Waiting',
  client: 'Waiting on client',
  review: 'Reviewing plan',
  calibration: 'Making calibrations',
  ads: 'Making ads',
  check: 'Internal review',
  custom: 'Custom task',
  done: 'Done',
} as const

export type PlanStatus = keyof typeof PLAN_STATUSES
export type ProductionStatus = keyof typeof PRODUCTION_STATUSES
export type ProjectRow = {
  slug: string
  name: string
  planStatus: PlanStatus
  productionStatus: ProductionStatus
  productionLabel: string
  dueDate: string | null
}
export type ProjectFilters = { query: string; planStatus: PlanStatus | ''; productionStatus: ProductionStatus | ''; overdueOnly: boolean }
export type ProjectSort = { key: 'name' | 'planStatus' | 'productionStatus' | 'dueDate'; direction: 'asc' | 'desc' }

/** Keep the existing first-unfinished-task status, including rolled-up subtasks. */
export function projectRow(plan: { slug: string; version: number; state: unknown }, name: string, tasks: TaskNode[]): ProjectRow {
  const { next, total } = productionSummary(tasks)
  let productionStatus: ProductionStatus = 'waiting'
  if (total && !next) productionStatus = 'done'
  else if (next) {
    if (effectiveStatus(next) === 'waiting_client') productionStatus = 'client'
    else if (next.kind === 'review') productionStatus = 'review'
    else if (next.kind === 'samples' || next.kind.startsWith('calibration')) productionStatus = 'calibration'
    else if (next.kind === 'statics' || next.kind === 'motion') productionStatus = 'ads'
    else if (next.kind === 'check') productionStatus = 'check'
    else productionStatus = 'custom'
  }
  const locked = !!plan.state && typeof plan.state === 'object' && 'status' in plan.state && plan.state.status === 'locked'
  return {
    slug: plan.slug,
    name,
    planStatus: locked ? 'locked' : plan.version ? 'in_progress' : 'not_started',
    productionStatus,
    productionLabel: productionStatus === 'custom' ? next!.title : PRODUCTION_STATUSES[productionStatus],
    dueDate: next?.due_date ?? null,
  }
}

const normalize = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
const compareText = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true })
export const isProjectOverdue = (project: ProjectRow, today: string) => !!project.dueDate && project.dueDate < today

/** Pure filtering/sorting; never mutate server props. Undated projects stay last in either direction. */
export function filterProjects(projects: ProjectRow[], filters: ProjectFilters, sort: ProjectSort, today: string): ProjectRow[] {
  const query = normalize(filters.query)
  return projects.filter(project =>
    (!query || normalize(project.name).includes(query)) &&
    (!filters.planStatus || project.planStatus === filters.planStatus) &&
    (!filters.productionStatus || project.productionStatus === filters.productionStatus) &&
    (!filters.overdueOnly || isProjectOverdue(project, today)),
  ).sort((a, b) => {
    let compared = 0
    if (sort.key === 'dueDate') {
      if (!a.dueDate && b.dueDate) return 1
      if (a.dueDate && !b.dueDate) return -1
      compared = compareText(a.dueDate ?? '', b.dueDate ?? '')
    } else if (sort.key === 'planStatus') compared = Object.keys(PLAN_STATUSES).indexOf(a.planStatus) - Object.keys(PLAN_STATUSES).indexOf(b.planStatus)
    else if (sort.key === 'productionStatus') compared = Object.keys(PRODUCTION_STATUSES).indexOf(a.productionStatus) - Object.keys(PRODUCTION_STATUSES).indexOf(b.productionStatus) || compareText(a.productionLabel, b.productionLabel)
    else compared = compareText(a.name, b.name)
    return (sort.direction === 'asc' ? compared : -compared) || compareText(a.name, b.name) || compareText(a.slug, b.slug)
  })
}
