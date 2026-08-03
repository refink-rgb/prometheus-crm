import type { Stage } from './types'

export type { Stage } from './types'
export { STAGE_LABELS, STAGE_ORDER, normalizeStage } from './types'

import { STAGE_ORDER, normalizeStage } from './types'

// 'live' is terminal, so it is 100% — a shipped track has nothing left to do.
// Archiving (is_complete) is tracked separately and doesn't move a bar. The
// middle stops were re-spread after Done was removed so the ramp still climbs
// evenly to the end instead of topping out at 85%.
export const STAGE_PCT: Record<Stage, number> = {
  brief:           0,
  in_progress:     25,
  internal_review: 50,
  client_review:   70,
  revisions:       85,
  live:            100,
}

export const STAGE_COLORS = {
  brief:           { border: '#94A3B8', bg: 'rgba(148,163,184,0.14)', text: '#94A3B8' },
  in_progress:     { border: '#3B82F6', bg: 'rgba(59,130,246,0.14)',  text: '#60A5FA' },
  internal_review: { border: '#6366F1', bg: 'rgba(99,102,241,0.14)',  text: '#818CF8' },
  client_review:   { border: '#F59E0B', bg: 'rgba(245,158,11,0.14)',  text: '#FCD34D' },
  revisions:       { border: '#F43F5E', bg: 'rgba(244,63,94,0.14)',   text: '#FB7185' },
  live:            { border: '#65A30D', bg: 'rgba(101,163,13,0.16)',  text: '#A3E635' },
} satisfies Record<Stage, { border: string; bg: string; text: string }>

// Emerald used to be the Done stage's colour. Done is gone, but the colour
// still means "finished" in the two places that aren't a stage lookup: an
// archived project (is_complete) and the offer board's approved column. Kept
// distinct from Live's lime on purpose — shipped and archived are different
// states and the board should not make them look like the same thing.
export const COMPLETE_COLORS = { border: '#10B981', bg: 'rgba(16,185,129,0.16)', text: '#34D399' }

// Offer Cycle columns reuse the production palette so the two boards read as
// one visual system: same slate→blue→indigo→amber ramp, green for terminal.
import type { OfferStage } from './types'

export const OFFER_STAGE_COLORS = {
  auto_generated:        STAGE_COLORS.brief,
  offer_draft:           STAGE_COLORS.in_progress,
  internal_offer_review: STAGE_COLORS.internal_review,
  client_review:         STAGE_COLORS.client_review,
  offer_approved:        COMPLETE_COLORS,
} satisfies Record<OfferStage, { border: string; bg: string; text: string }>

// Both of the helpers below run on archived projects too (the brand list and
// the project page render completed work), so they normalize their inputs — a
// pre-migration 'done' row would otherwise index to undefined and render NaN.
export function overallProgress(lpStage: Stage | null, creativesStage: Stage | null): number {
  const lp  = lpStage        ? STAGE_PCT[normalizeStage(lpStage)]        : 0
  const cre = creativesStage ? STAGE_PCT[normalizeStage(creativesStage)] : 0
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
  const lp  = lpStage        ? STAGE_ORDER.indexOf(normalizeStage(lpStage))        : 0
  const cre = creativesStage ? STAGE_ORDER.indexOf(normalizeStage(creativesStage)) : 0
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
// "in-flight" stages have a per-phase due date — revisions/live can't slip, so
// they map to null and callers fall back to the go-live date. Mirrors
// STAGE_DUE_COLUMN in the daily cron so the board and the slip scan agree on
// which date governs which stage.
export const STAGE_DUE_FIELD = {
  brief:           'stage_brief_due_date',
  in_progress:     'stage_in_progress_due_date',
  internal_review: 'stage_internal_review_due_date',
  client_review:   'stage_client_review_due_date',
  revisions:       null,
  live:            null,
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
  return lpStage === 'live' && creativesStage === 'live'
}

// ---------------------------------------------------------------------------
// Stage-exit model (Timeline view). A project row on the timeline is driven by
// its "governing" track — the one closest to slipping — so the dual LP/Creative
// pipeline collapses to a single bar the way `cardBorderColor` picks a single
// dominant stage. No new data: every field here already lives on `projects`.
// ---------------------------------------------------------------------------

// Minimal project shape the timeline reads. Mirrors the narrow SELECT in
// timeline/page.tsx so the query and this helper stay in sync.
export interface StageExitFields {
  lp_stage: Stage
  creatives_stage: Stage
  due_date: string | null
  stage_brief_due_date: string | null
  stage_in_progress_due_date: string | null
  stage_internal_review_due_date: string | null
  stage_client_review_due_date: string | null
}

export type EditorTrack = 'lp' | 'creative'

export interface StageExit {
  track: EditorTrack
  stage: Stage
  // The date this stage is meant to exit by: its phase-due column, or the
  // go-live date for stages with no phase target (revisions/live).
  exitDate: Date | null
  daysUntil: number | null
  tone: PhaseDueTone | null
}

// The raw date string governing a single stage's exit.
function stageExitDateStr(p: StageExitFields, stage: Stage): string | null {
  const field = STAGE_DUE_FIELD[stage]
  return field ? (p[field] ?? null) : p.due_date
}

export function trackExit(p: StageExitFields, track: EditorTrack): StageExit {
  const stage = track === 'lp' ? p.lp_stage : p.creatives_stage
  const raw = stageExitDateStr(p, stage)
  const { due, daysUntil } = parseAndDaysUntil(raw)
  const tone: PhaseDueTone | null =
    daysUntil === null ? null : daysUntil < 0 ? 'overdue' : daysUntil <= 3 ? 'urgent' : 'neutral'
  return { track, stage, exitDate: due, daysUntil, tone }
}

// Earlier exit wins; ties break toward the less-advanced stage. A track with no
// exit date sorts last (Infinity).
function moreUrgent(a: StageExit, b: StageExit): StageExit {
  const at = a.exitDate?.getTime() ?? Infinity
  const bt = b.exitDate?.getTime() ?? Infinity
  if (at !== bt) return at < bt ? a : b
  return STAGE_ORDER.indexOf(a.stage) <= STAGE_ORDER.indexOf(b.stage) ? a : b
}

// The track that drives this project's timeline row. Prefer the track that can
// still slip (a live track has nothing left to exit); if both are still
// in-flight, the more urgent of the two.
export function governingStageExit(p: StageExitFields): StageExit {
  const lp = trackExit(p, 'lp')
  const cre = trackExit(p, 'creative')
  const lpShipped = lp.stage === 'live'
  const creShipped = cre.stage === 'live'
  if (lpShipped && !creShipped) return cre
  if (creShipped && !lpShipped) return lp
  return moreUrgent(lp, cre)
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

// ---------------------------------------------------------------------------
// Offer approval deadline
// ---------------------------------------------------------------------------

// An offer for a given month has to be APPROVED by the 5th of that month —
// anything still sitting in the offer pipeline after that is late (Giovane,
// 2026-07-31). The 5th is the deadline itself, so a card is overdue from the
// 6th, not on the 5th.
//
// This is what makes the date meaningful downstream: production due dates are
// the 15th (M1) and month-end (M2), so an offer approved on the 5th leaves ten
// days to build M1. Slipping the offer eats directly into that.
export const OFFER_APPROVAL_DAY = 5

// 'YYYY-MM-05' for an offer_cards.target_month ('YYYY-MM-01').
export function offerApprovalDue(targetMonth: string): string {
  return `${targetMonth.slice(0, 7)}-${String(OFFER_APPROVAL_DAY).padStart(2, '0')}`
}

// Urgency of an offer card. Approved cards have no deadline left to miss, so
// they return null and render calm — same convention as phaseDueTone() for
// live projects.
export function offerDueTone(targetMonth: string, stage: OfferStage): PhaseDueTone | null {
  if (stage === 'offer_approved') return null
  return phaseDueTone(offerApprovalDue(targetMonth))
}

// Days until the approval deadline; negative once past it.
export function offerDaysUntilDue(targetMonth: string): number | null {
  return calcDaysUntil(offerApprovalDue(targetMonth))
}

// 'Due Aug 5' / '3d left' / '6d late' — the badge text on an offer card.
export function offerDueLabel(targetMonth: string, stage: OfferStage): string | null {
  const tone = offerDueTone(targetMonth, stage)
  if (tone === null) return null
  const days = offerDaysUntilDue(targetMonth)
  if (days === null) return null
  if (days < 0) return `${Math.abs(days)}d late`
  if (days === 0) return 'Due today'
  if (days <= 3) return `${days}d left`
  const due = parseDueDate(offerApprovalDue(targetMonth))
  return due ? `Due ${due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : null
}
