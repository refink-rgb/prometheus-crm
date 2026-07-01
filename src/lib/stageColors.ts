import type { Stage } from './types'

export type { Stage } from './types'
export { STAGE_LABELS, STAGE_ORDER } from './types'

import { STAGE_ORDER } from './types'

export const STAGE_PCT: Record<Stage, number> = {
  brief:           0,
  in_progress:     25,
  internal_review: 50,
  client_review:   65,
  live:            85,
  done:            100,
}

export const STAGE_COLORS = {
  brief:           { border: '#94A3B8', bg: 'rgba(148,163,184,0.14)', text: '#94A3B8' },
  in_progress:     { border: '#3B82F6', bg: 'rgba(59,130,246,0.14)',  text: '#60A5FA' },
  internal_review: { border: '#6366F1', bg: 'rgba(99,102,241,0.14)',  text: '#818CF8' },
  client_review:   { border: '#F59E0B', bg: 'rgba(245,158,11,0.14)',  text: '#FCD34D' },
  live:            { border: '#65A30D', bg: 'rgba(101,163,13,0.16)',  text: '#A3E635' },
  done:            { border: '#10B981', bg: 'rgba(16,185,129,0.16)',  text: '#34D399' },
} satisfies Record<Stage, { border: string; bg: string; text: string }>

export function overallProgress(lpStage: Stage | null, creativesStage: Stage | null): number {
  const lp  = lpStage        ? STAGE_PCT[lpStage]        : 0
  const cre = creativesStage ? STAGE_PCT[creativesStage] : 0
  return Math.round((lp + cre) / 2)
}

export function cardBorderColor(
  isOverdue: boolean,
  daysUntil: number | null,
  lpStage: Stage | null,
  creativesStage: Stage | null,
): string {
  if (isOverdue) return '#EF4444'
  const shipped = isProjectLive(lpStage, creativesStage)
  if (!shipped && daysUntil !== null && daysUntil <= 4) return '#F97316'
  if (lpStage === 'client_review' || creativesStage === 'client_review') return '#F59E0B'
  const lp  = lpStage        ? STAGE_ORDER.indexOf(lpStage)        : 0
  const cre = creativesStage ? STAGE_ORDER.indexOf(creativesStage) : 0
  const dominant = STAGE_ORDER[Math.min(lp, cre)] ?? 'brief'
  return STAGE_COLORS[dominant].border
}

export function calcDaysUntil(dueDateStr: string | null | undefined): number | null {
  if (!dueDateStr) return null
  return Math.ceil((new Date(dueDateStr).getTime() - Date.now()) / 86_400_000)
}

export function isProjectLive(lpStage: Stage | null, creativesStage: Stage | null): boolean {
  const shipped = (s: Stage | null) => s === 'live' || s === 'done'
  return shipped(lpStage) && shipped(creativesStage)
}

export function isProjectOverdue(
  dueDate: string | null | undefined,
  isComplete: boolean,
  lpStage: Stage | null,
  creativesStage: Stage | null,
): boolean {
  if (isComplete) return false
  if (isProjectLive(lpStage, creativesStage)) return false
  const d = calcDaysUntil(dueDate)
  return d !== null && d < 0
}
