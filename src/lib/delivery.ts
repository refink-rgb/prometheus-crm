// Moment delivery tracking — "am I keeping up with what I sold?"
//
// The retainer buys a fixed number of marketing moments per billing cycle.
// This module answers, per client per cycle: how many were owed, how many
// actually shipped, and whether the account is in credit or in debt overall.
//
// Rules that shape everything below:
//
//   * The BILLING CYCLE is the unit of time, not the calendar month. A client
//     that pays on the 13th owes 2 moments between the 13th and the next 13th.
//     That mirrors the ledger (`billing_periods`) rather than inventing a
//     second calendar, so "months" here can never drift from what was invoiced.
//     Columns are still LABELLED by calendar month — the cycle billed in that
//     month — which is how the tracking sheet reads.
//
//   * A moment lands in the cycle it ACTUALLY shipped in, not the cycle it was
//     planned for. A July moment that slips to August leaves July short and
//     shows up as August catch-up, so a past month never silently heals itself.
//     Undelivered moments stay in their planned cycle (their due_date), which
//     is what makes a gap visible before it becomes a miss.
//
//   * Nothing here calls `new Date()` — callers pass Eastern today, same
//     contract as billing.ts and eastern.ts.
//
// No schema change: everything is derived from `billing_periods`, `projects`,
// and the `pipeline_events` log that already exists.

import { normalizeStage } from './types'
import type { StoredPeriodStatus } from './billing'

// What one retainer cycle buys. Every client is on the same 2-moment deal
// today (18 clients × 2 moments); if that ever splits per contract, this is
// the single place it needs to become a per-subscription column.
export const MOMENTS_PER_CYCLE = 2

// --- Inputs -----------------------------------------------------------------

export interface MomentRow {
  id: string
  brand_id: string
  name: string
  due_date: string | null
  marketing_moment: number | null
  is_complete: boolean
  lp_stage: string
  creatives_stage: string
}

export interface CycleRow {
  brand_id: string
  period_start: string
  period_end: string
  due_date: string
  status: StoredPeriodStatus
}

// card_id → Eastern date the moment reached live, from pipeline_events.
export type LiveDateMap = Map<string, string>

// --- Derived shapes ---------------------------------------------------------

export type CellState =
  // No billing cycle that month — before the client started, or after churn,
  // or a paused month. Renders blank; never counts as a miss.
  | 'no_cycle'
  // Cycle closed and the quota was met (or beaten).
  | 'met'
  // Cycle closed short.
  | 'behind'
  // Cycle still running, enough moments on the board to still hit the number.
  | 'in_flight'
  // Cycle still running and there aren't even enough moments briefed to cover
  // the quota — the gap is structural, not just unfinished work.
  | 'at_risk'

// Where a delivered moment's date came from. 'event' is an observed ship date
// from the pipeline log; 'target' is the moment's own due_date, standing in
// for a ship date nobody recorded. The distinction has to survive into the UI:
// a target-dated moment can never be measured against its own target.
export type DateSource = 'event' | 'target'

export interface DeliveredAt {
  date: string
  source: DateSource
}

export interface CellMoment {
  id: string
  name: string
  slot: number | null
  delivered: boolean
  // Eastern date it shipped (null while in flight).
  deliveredOn: string | null
  dateSource: DateSource | null
  // Whether it landed after its own planned due date. NULL means unknowable —
  // the only date we have IS the due date, so comparing them would manufacture
  // an on-time result rather than measure one.
  late: boolean | null
}

export interface DeliveryCell {
  monthKey: string
  state: CellState
  // Payment date anchoring this cycle, and the window it covers.
  dueDate: string | null
  cycleStart: string | null
  cycleEnd: string | null
  closed: boolean
  owed: number
  delivered: number
  // Moments sitting in this cycle that haven't shipped yet.
  inFlight: number
  // Delivered moments placed by their TARGET date because no ship date was
  // ever logged. They still count, but which cycle they landed in is inferred,
  // not observed — surfaced so the number can be read with that in mind.
  estimated: number
  moments: CellMoment[]
}

export interface DeliveryRow {
  brandId: string
  brandName: string
  cells: DeliveryCell[]
  // Lifetime, across CLOSED cycles only — an in-flight month isn't a debt yet.
  owedToDate: number
  deliveredToDate: number
  // delivered − owed. Negative = moments still owed to the client.
  balance: number
}

export interface DeliverySummary {
  rows: DeliveryRow[]
  monthKeys: string[]
  clientsBehind: number
  momentsOwed: number
  deliveredThisMonth: number
  owedThisMonth: number
  // Delivered moments in the visible grid that had no logged ship date, so
  // their cycle was inferred from their target. Footnoted rather than hidden.
  estimatedInWindow: number
}

// --- Delivery detection -----------------------------------------------------

// A moment is delivered once BOTH tracks are live. `is_complete` also counts:
// markProjectComplete forces both stages to 'live', and archived rows written
// before that are still genuinely shipped work.
export function isMomentDelivered(m: MomentRow): boolean {
  if (m.is_complete) return true
  return normalizeStage(m.lp_stage) === 'live' && normalizeStage(m.creatives_stage) === 'live'
}

// When it shipped, and how confidently we know. The event log is the only real
// record — `due_date` is a target, not an outcome — so events win.
//
// The fallback matters more than it looks. Moments completed before the event
// log existed (Phase 1, 2026-07-17), or archived through a path that emitted
// nothing, have no ship date at all. Dating those by `due_date` is the only
// option, but it must be LABELLED: measuring such a moment against its own due
// date would report "on time" for every one of them by construction, which is
// a fabricated result, not a measurement.
export function deliveredDateOf(m: MomentRow, liveDates: LiveDateMap): DeliveredAt | null {
  if (!isMomentDelivered(m)) return null
  const logged = liveDates.get(m.id)
  if (logged) return { date: logged, source: 'event' }
  return m.due_date ? { date: m.due_date, source: 'target' } : null
}

// The cycle a moment belongs to: where it landed if it shipped, where it was
// aimed if it hasn't.
export function effectiveDateOf(m: MomentRow, liveDates: LiveDateMap): string | null {
  return deliveredDateOf(m, liveDates)?.date ?? m.due_date
}

// Build the card_id → live-date index from stage_changed events. Takes the
// LATEST live transition per card: a card bounced back to revisions and
// relaunched shipped on the second date, not the first. Historic rows carry
// to_stage='done' (the stage was retired 2026-08-02), so callers must include
// both values in the query.
export function buildLiveDateMap(
  events: Array<{ card_id: string; created_at: string }>,
  toEasternDate: (iso: string) => string,
): LiveDateMap {
  const map: LiveDateMap = new Map()
  for (const e of events) {
    const date = toEasternDate(e.created_at)
    const seen = map.get(e.card_id)
    if (!seen || date > seen) map.set(e.card_id, date)
  }
  return map
}

// --- Assembly ---------------------------------------------------------------

function monthKeyOfDate(iso: string): string {
  return iso.slice(0, 7)
}

// Cycles that count toward the running balance: waived and void periods were
// never really sold, so they buy no moments.
function isBillable(status: StoredPeriodStatus): boolean {
  return status === 'scheduled' || status === 'paid'
}

export function buildDeliveryRows(
  input: {
    brandNames: Map<string, string>
    cycles: CycleRow[]
    moments: MomentRow[]
    liveDates: LiveDateMap
    monthKeys: string[]
    today: string
  },
): DeliverySummary {
  const { brandNames, cycles, moments, liveDates, monthKeys, today } = input

  // Cycles indexed by brand, then by the calendar month their payment falls in.
  // Two cycles can't share a month: due dates are one anniversary apart.
  const cyclesByBrand = new Map<string, Map<string, CycleRow>>()
  for (const c of cycles) {
    if (!isBillable(c.status)) continue
    let byMonth = cyclesByBrand.get(c.brand_id)
    if (!byMonth) {
      byMonth = new Map()
      cyclesByBrand.set(c.brand_id, byMonth)
    }
    byMonth.set(monthKeyOfDate(c.due_date), c)
  }

  const momentsByBrand = new Map<string, MomentRow[]>()
  for (const m of moments) {
    const list = momentsByBrand.get(m.brand_id)
    if (list) list.push(m)
    else momentsByBrand.set(m.brand_id, [m])
  }

  const currentMonth = monthKeyOfDate(today)
  let deliveredThisMonth = 0
  let owedThisMonth = 0

  const rows: DeliveryRow[] = []

  for (const [brandId, byMonth] of cyclesByBrand) {
    const mine = momentsByBrand.get(brandId) ?? []

    // Pre-place every moment on its effective date once, so each cycle lookup
    // is a filter rather than a re-derivation.
    const placed = mine
      .map(m => {
        const deliveredAt = deliveredDateOf(m, liveDates)
        const at = deliveredAt?.date ?? m.due_date
        return { m, deliveredAt, at }
      })
      .filter((p): p is Placed => p.at !== null)

    const cells: DeliveryCell[] = monthKeys.map(monthKey => {
      const cycle = byMonth.get(monthKey)
      if (!cycle) {
        return {
          monthKey,
          state: 'no_cycle',
          dueDate: null,
          cycleStart: null,
          cycleEnd: null,
          closed: false,
          owed: 0,
          delivered: 0,
          inFlight: 0,
          estimated: 0,
          moments: [],
        }
      }
      return buildCell(monthKey, cycle, placed, today)
    })

    const closedCycles = [...byMonth.values()].filter(c => c.period_end < today)
    const owedToDate = closedCycles.length * MOMENTS_PER_CYCLE
    const closedThrough = closedCycles.reduce<string | null>(
      (latest, c) => (latest === null || c.period_end > latest ? c.period_end : latest),
      null,
    )
    const openedAt = [...byMonth.values()].reduce<string | null>(
      (earliest, c) => (earliest === null || c.period_start < earliest ? c.period_start : earliest),
      null,
    )
    // Only count deliveries inside the closed window, so a moment shipped
    // early in the current (still open) cycle can't pay down a past debt it
    // hasn't been measured against yet.
    const deliveredToDate = closedThrough === null || openedAt === null
      ? 0
      : placed.filter(p => p.deliveredAt !== null && p.at >= openedAt && p.at <= closedThrough).length

    const currentCell = cells.find(c => c.monthKey === currentMonth)
    if (currentCell && currentCell.state !== 'no_cycle') {
      deliveredThisMonth += currentCell.delivered
      owedThisMonth += currentCell.owed
    }

    rows.push({
      brandId,
      brandName: brandNames.get(brandId) ?? 'Unknown client',
      cells,
      owedToDate,
      deliveredToDate,
      balance: deliveredToDate - owedToDate,
    })
  }

  // Most in debt first — this view exists to surface who is owed work.
  rows.sort((a, b) => a.balance - b.balance || a.brandName.localeCompare(b.brandName))

  return {
    rows,
    monthKeys,
    clientsBehind: rows.filter(r => r.balance < 0).length,
    momentsOwed: rows.reduce((sum, r) => sum + Math.max(0, -r.balance), 0),
    deliveredThisMonth,
    owedThisMonth,
    estimatedInWindow: rows.reduce(
      (sum, r) => sum + r.cells.reduce((n, c) => n + c.estimated, 0),
      0,
    ),
  }
}

// A moment pinned to the date that decides which cycle it falls in.
interface Placed {
  m: MomentRow
  deliveredAt: DeliveredAt | null
  at: string
}

function buildCell(
  monthKey: string,
  cycle: CycleRow,
  placed: Placed[],
  today: string,
): DeliveryCell {
  const inCycle = placed.filter(p => p.at >= cycle.period_start && p.at <= cycle.period_end)

  const cellMoments: CellMoment[] = inCycle
    .map(({ m, deliveredAt }) => ({
      id: m.id,
      name: m.name,
      slot: m.marketing_moment,
      delivered: deliveredAt !== null,
      deliveredOn: deliveredAt?.date ?? null,
      dateSource: deliveredAt?.source ?? null,
      // Only an observed ship date can be late. A target-dated moment is being
      // compared against the very date it was placed by, so the answer would
      // always be "on time" — that's not an observation, so it stays unknown.
      late: deliveredAt === null || deliveredAt.source !== 'event'
        ? null
        : m.due_date !== null && deliveredAt.date > m.due_date,
    }))
    .sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99) || a.name.localeCompare(b.name))

  const delivered = cellMoments.filter(m => m.delivered).length
  const estimated = cellMoments.filter(m => m.dateSource === 'target').length
  const inFlight = cellMoments.length - delivered
  const closed = cycle.period_end < today
  const owed = MOMENTS_PER_CYCLE

  let state: CellState
  if (delivered >= owed) state = 'met'
  else if (closed) state = 'behind'
  else if (delivered + inFlight < owed) state = 'at_risk'
  else state = 'in_flight'

  return {
    monthKey,
    state,
    dueDate: cycle.due_date,
    cycleStart: cycle.period_start,
    cycleEnd: cycle.period_end,
    closed,
    owed,
    delivered,
    inFlight,
    estimated,
    moments: cellMoments,
  }
}
