// Billing period math — pure, no I/O, no `new Date()` for calendar logic.
//
// Every retainer bills on the ANNIVERSARY of its start date: a client that
// started 5/13 is due 5/13, 6/13, 7/13, … The old /financials page counted
// whole calendar months instead, which over-counted revenue by up to a month
// per client (a brand starting on the 30th was credited a full month on the
// 1st). Nothing here uses the host timezone — callers pass in "today" from
// `easternToday()`, matching the rule in eastern.ts.
//
// Money is INTEGER CENTS everywhere. `brands.monthly_retainer` is a float
// column written with parseFloat; the ledger deliberately does not repeat that.

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

export function lastDayOfMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29
  return DAYS_IN_MONTH[month - 1]
}

export function parseIsoDate(iso: string): { year: number; month: number; day: number } {
  return {
    year: Number(iso.slice(0, 4)),
    month: Number(iso.slice(5, 7)),
    day: Number(iso.slice(8, 10)),
  }
}

export function toIsoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// Add whole months to a year/month pair. Month is 1-12 in and out.
export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const zero = year * 12 + (month - 1) + delta
  return { year: Math.floor(zero / 12), month: (zero % 12) + 1 }
}

// The billing date `n` months after the anchor, clamped to the last day of
// short months. The anchor day is preserved rather than "sticking" to the
// clamped value: anchor 31 bills 5/31 → 6/30 → 7/31, NOT 6/30 → 7/30.
// Tea with Tae (started 5/31) is the live case for this.
export function anniversaryDate(startIso: string, anchorDay: number, monthsAfter: number): string {
  const { year, month } = parseIsoDate(startIso)
  const target = addMonths(year, month, monthsAfter)
  const day = Math.min(anchorDay, lastDayOfMonth(target.year, target.month))
  return toIsoDate(target.year, target.month, day)
}

// Whole months from `fromIso` to `toIso`, by calendar position only (not by
// anniversary). Used to size the generation window, never to count revenue.
export function monthsBetween(fromIso: string, toIso: string): number {
  const a = parseIsoDate(fromIso)
  const b = parseIsoDate(toIso)
  return (b.year - a.year) * 12 + (b.month - a.month)
}

export function monthKeyOf(iso: string): string {
  return iso.slice(0, 7)
}

export function monthStart(monthKey: string): string {
  return `${monthKey}-01`
}

export function monthEnd(monthKey: string): string {
  const { year, month } = parseIsoDate(`${monthKey}-01`)
  return toIsoDate(year, month, lastDayOfMonth(year, month))
}

export function shiftMonthKey(monthKey: string, delta: number): string {
  const { year, month } = parseIsoDate(`${monthKey}-01`)
  const next = addMonths(year, month, delta)
  return `${next.year}-${String(next.month).padStart(2, '0')}`
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export function monthLabel(monthKey: string): string {
  const { year, month } = parseIsoDate(`${monthKey}-01`)
  return `${MONTH_NAMES[month - 1]} ${year}`
}

// 'Jul 13' — compact due-date label for table rows.
export function shortDateLabel(iso: string): string {
  const { month, day } = parseIsoDate(iso)
  return `${MONTH_NAMES[month - 1].slice(0, 3)} ${day}`
}

export function daysBetweenIso(fromIso: string, toIso: string): number {
  const ms = Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)
  return Math.round(ms / 86_400_000)
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

export function formatCents(cents: number): string {
  const dollars = cents / 100
  return '$' + dollars.toLocaleString('en-US', {
    minimumFractionDigits: dollars % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })
}

// '2,500', '$2500.00', '2500' → 250000. Returns null on anything unparseable
// so callers can reject instead of silently writing NaN.
export function parseMoneyToCents(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, '')
  if (!cleaned || !/^-?\d*\.?\d*$/.test(cleaned)) return null
  const value = Number(cleaned)
  if (!Number.isFinite(value)) return null
  return Math.round(value * 100)
}

// ---------------------------------------------------------------------------
// Period generation
// ---------------------------------------------------------------------------

export type SubscriptionStatus = 'active' | 'paused' | 'cancelled'

export interface SubscriptionShape {
  id: string
  brand_id: string
  amount_cents: number
  start_date: string
  anchor_day: number
  status: SubscriptionStatus
  paused_from: string | null
  paused_until: string | null
  ended_at: string | null
}

export interface GeneratedPeriod {
  period_index: number
  period_start: string
  period_end: string
  due_date: string
  amount_cents: number
}

// A due date inside the pause window produces no invoice. An open-ended pause
// (`paused_until` null) suppresses everything from `paused_from` onward.
export function isPausedOn(sub: Pick<SubscriptionShape, 'paused_from' | 'paused_until'>, iso: string): boolean {
  if (!sub.paused_from) return false
  if (iso < sub.paused_from) return false
  if (sub.paused_until && iso >= sub.paused_until) return false
  return true
}

// Every period from the subscription's start through `throughIso`, minus any
// suppressed by a pause or by churn. `period_index` is the month offset from
// the start date — stable and gap-tolerant, so skipping a paused month never
// renumbers the periods around it.
export function generatePeriods(sub: SubscriptionShape, throughIso: string): GeneratedPeriod[] {
  if (sub.start_date > throughIso) return []

  const horizon = sub.ended_at && sub.ended_at < throughIso ? sub.ended_at : throughIso
  const span = monthsBetween(sub.start_date, horizon) + 1
  const periods: GeneratedPeriod[] = []

  for (let i = 0; i < span; i++) {
    const dueDate = anniversaryDate(sub.start_date, sub.anchor_day, i)
    if (dueDate > horizon) break
    if (sub.ended_at && dueDate >= sub.ended_at) break
    if (isPausedOn(sub, dueDate)) continue

    const nextDue = anniversaryDate(sub.start_date, sub.anchor_day, i + 1)
    periods.push({
      period_index: i,
      period_start: dueDate,
      period_end: addDays(nextDue, -1),
      due_date: dueDate,
      amount_cents: sub.amount_cents,
    })
  }

  return periods
}

export function addDays(iso: string, delta: number): string {
  const ms = Date.parse(`${iso}T00:00:00Z`) + delta * 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Period state
// ---------------------------------------------------------------------------

// Stored status is only what a human asserted. Whether an unpaid invoice is
// upcoming, due, or overdue is DERIVED from today's date — so nothing goes
// stale if the cron misses a night.
export type StoredPeriodStatus = 'scheduled' | 'paid' | 'waived' | 'void'
export type PeriodState = 'paid' | 'waived' | 'void' | 'overdue' | 'due' | 'upcoming'

export const OVERDUE_AFTER_DAYS = 7

export function derivePeriodState(
  period: { status: StoredPeriodStatus; due_date: string },
  todayIso: string,
): PeriodState {
  if (period.status !== 'scheduled') return period.status
  if (period.due_date > todayIso) return 'upcoming'
  return daysBetweenIso(period.due_date, todayIso) > OVERDUE_AFTER_DAYS ? 'overdue' : 'due'
}

export const PERIOD_STATE_LABEL: Record<PeriodState, string> = {
  paid: 'Paid',
  waived: 'Waived',
  void: 'Void',
  overdue: 'Overdue',
  due: 'Due',
  upcoming: 'Upcoming',
}

export const PERIOD_STATE_COLOR: Record<PeriodState, string> = {
  paid: 'var(--success)',
  waived: 'var(--text-muted)',
  void: 'var(--text-muted)',
  overdue: 'var(--danger)',
  due: 'var(--warning)',
  upcoming: 'var(--text-muted)',
}

// Counts toward money actually in the bank.
export function isCollected(state: PeriodState): boolean {
  return state === 'paid'
}

// Counts toward money owed but not received. Waived/void are neither
// collected nor outstanding — that's the point of having both.
export function isOutstanding(state: PeriodState): boolean {
  return state === 'due' || state === 'overdue'
}

export const SUBSCRIPTION_STATUS_LABEL: Record<SubscriptionStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  cancelled: 'Ended',
}

export const SUBSCRIPTION_STATUS_COLOR: Record<SubscriptionStatus, string> = {
  active: 'var(--success)',
  paused: 'var(--warning)',
  cancelled: 'var(--text-muted)',
}
