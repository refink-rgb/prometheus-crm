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

// Offer Cycle columns reuse the production palette so the two boards read as
// one visual system: same slate→blue→indigo→amber ramp, green for terminal.
import type { OfferStage } from './types'

export const OFFER_STAGE_COLORS = {
  auto_generated:        STAGE_COLORS.brief,
  offer_draft:           STAGE_COLORS.in_progress,
  internal_offer_review: STAGE_COLORS.internal_review,
  client_review:         STAGE_COLORS.client_review,
  offer_approved:        STAGE_COLORS.done,
} satisfies Record<OfferStage, { border: string; bg: string; text: string }>

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

// Postgres `DATE` values arrive as `YYYY-MM-DD`. `new Date("YYYY-MM-DD")` parses
// them as UTC midnight, which renders as the previous calendar day in any
// timezone west of UTC. Force a local-midnight parse so the day the user sees
// matches the day the team stored.
const BARE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function parseDueDate(dueDateStr: string | null | undefined): Date | null {
  if (!dueDateStr) return null
  // Handle both plain dates and full ISO strings; only patch bare YYYY-MM-DD.
  const bare = BARE_DATE_RE.test(dueDateStr) ? `${dueDateStr}T00:00:00` : dueDateStr
  const d = new Date(bare)
  return isNaN(d.getTime()) ? null : d
}

// Local-midnight-of-today, computed once per call site so the caller can pass
// it in when computing multiple days-until values in one render.
function localMidnightToday(): number {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
}

export function calcDaysUntil(dueDateStr: string | null | undefined): number | null {
  const due = parseDueDate(dueDateStr)
  if (!due) return null
  return Math.round((due.getTime() - localMidnightToday()) / 86_400_000)
}

// Combined variant: parses once, returns both. Prefer this at render sites
// that need the Date AND the days-until — halves the work of calling both.
export function parseAndDaysUntil(dueDateStr: string | null | undefined): { due: Date | null; daysUntil: number | null } {
  const due = parseDueDate(dueDateStr)
  if (!due) return { due: null, daysUntil: null }
  return { due, daysUntil: Math.round((due.getTime() - localMidnightToday()) / 86_400_000) }
}

// Which project column holds the target date for each stage. Only the four
// "in-flight" stages have a per-phase due date — live/done can't slip, so they
// map to null and callers fall back to the go-live date (`due_date`). Mirrors
// STAGE_DUE_COLUMN in the daily cron so the board and the slip scan agree on
// which date governs which stage.
export const STAGE_DUE_FIELD = {
  brief:           'stage_brief_due_date',
  in_progress:     'stage_in_progress_due_date',
  internal_review: 'stage_internal_review_due_date',
  client_review:   'stage_client_review_due_date',
  live:            null,
  done:            null,
} as const satisfies Record<Stage, string | null>

export type PhaseDueTone = 'neutral' | 'urgent' | 'overdue'

// Urgency of a phase target date, independent of the go-live date. A phase is
// the actionable deadline ("this has to leave the column") so it flares earlier
// and louder than the calm go-live anchor: overdue once past, urgent within 3
// days. `null` when there is no date to judge.
export function phaseDueTone(dueDateStr: string | null | undefined): PhaseDueTone | null {
  const days = calcDaysUntil(dueDateStr)
  if (days === null) return null
  if (days < 0) return 'overdue'
  if (days <= 3) return 'urgent'
  return 'neutral'
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
