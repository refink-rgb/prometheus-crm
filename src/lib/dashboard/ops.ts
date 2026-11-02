// Management metrics and client concerns for the Dashboard. Pure: callers pass
// the rows and Eastern `today`; nothing here reads the clock or Supabase.
//
// Thresholds live at the top so they're easy to tune.

import { daysBetween } from '@/lib/eastern'
import { breakEvenRoas, type BrandCod } from '@/lib/results'
import type { ClientRevenue } from '@/lib/revenue/metrics'
import { normalizeClientName } from '@/lib/revenue/sheet'

/** A project this many days past its LIVE date (or launched this late) is "delayed". */
export const DELAY_DAYS = 5
/** First-week revenue under this, once a launch has run 5+ days, is a weak launch. */
export const WEAK_LAUNCH_CENTS = 200_000
export const WEAK_LAUNCH_MIN_DAYS = 5
export const WEAK_LAUNCH_WINDOW_DAYS = 7
/** ROAS floor when a brand has no cost of delivery set (so no break-even). */
export const DEFAULT_MIN_ROAS = 2.0
/** Below this spend a ROAS is noise, not a signal. */
export const MIN_SPEND_FOR_ROAS_CENTS = 25_000
/** Days in client review before it counts as waiting on the client. */
export const CLIENT_WAIT_DAYS = 5
/** Only launches this recent can raise a results concern. */
export const RESULTS_LOOKBACK_DAYS = 30
/** Offers must be approved by this day of their target month. */
export const OFFER_APPROVAL_DAY = 5
/** Moments an MM retainer buys per month. */
export const MOMENTS_PER_MONTH = 2

// --- Inputs -----------------------------------------------------------------

export interface OpsBrand {
  id: string
  name: string
  is_active: boolean
  cod_value: number | null
  cod_mode: 'percent' | 'per_order' | null
}

export interface OpsProject {
  id: string
  name: string
  brand_id: string
  due_date: string | null
  is_complete: boolean
  lp_stage: string
  creatives_stage: string
}

/** Stage change events, already converted to Eastern dates. */
export interface OpsEvent {
  card_id: string
  card_kind: 'production' | 'offer'
  track: 'lp' | 'creative' | null
  to_stage: string
  date: string
}

export interface OpsOffer {
  id: string
  brand_id: string
  name: string
  target_month: string // 'YYYY-MM-01'
  stage: string
  client_approved_at: string | null // Eastern date
}

export interface OpsTracking {
  id: string
  project_id: string
  brand_id: string
  launched_on: string | null
  ended_on: string | null
  daily: Array<{ stat_date: string; spend_cents: number; revenue_cents: number }>
}

// --- Project timing -----------------------------------------------------------

export type DelayStatus = 'upcoming' | 'on_time' | 'late' | 'delayed'

export interface ProjectTiming {
  id: string
  name: string
  brandId: string
  brandName: string
  dueDate: string
  shipped: boolean
  /** When both tracks went live. Null for open projects, or shipped ones with no event. */
  liveDate: string | null
  /** Days past the LIVE date: at launch if shipped, so far if still open. Never negative. */
  daysLate: number
  status: DelayStatus
  stageLabel: string
}

function liveDates(events: OpsEvent[]): Map<string, { lp?: string; creative?: string }> {
  const out = new Map<string, { lp?: string; creative?: string }>()
  for (const e of events) {
    if (e.card_kind !== 'production' || e.to_stage !== 'live' || !e.track) continue
    const cur = out.get(e.card_id) ?? {}
    // Latest arrival at live wins: a track can bounce back and go live again.
    if (!cur[e.track] || e.date > cur[e.track]!) cur[e.track] = e.date
    out.set(e.card_id, cur)
  }
  return out
}

const STAGE_NAMES: Record<string, string> = {
  brief: 'Brief', in_progress: 'In progress', internal_review: 'Internal review',
  client_review: 'Client review', revisions: 'Revisions', ready: 'Ready', live: 'Live',
}

function stageLabel(p: OpsProject): string {
  if (p.lp_stage === p.creatives_stage) return STAGE_NAMES[p.lp_stage] ?? p.lp_stage
  return `LP ${STAGE_NAMES[p.lp_stage] ?? p.lp_stage} · Creatives ${STAGE_NAMES[p.creatives_stage] ?? p.creatives_stage}`
}

export function projectTimings(
  projects: OpsProject[],
  events: OpsEvent[],
  brandName: Map<string, string>,
  today: string,
): ProjectTiming[] {
  const live = liveDates(events)
  const out: ProjectTiming[] = []
  for (const p of projects) {
    if (!p.due_date) continue
    const shipped = p.is_complete || (p.lp_stage === 'live' && p.creatives_stage === 'live')
    let liveDate: string | null = null
    let daysLate = 0
    if (shipped) {
      const d = live.get(p.id)
      liveDate = d?.lp && d?.creative ? (d.lp > d.creative ? d.lp : d.creative) : d?.lp ?? d?.creative ?? null
      // No event (shipped before the log started, 2026-07-17): count it as on time.
      daysLate = liveDate ? Math.max(0, daysBetween(p.due_date, liveDate)) : 0
    } else {
      daysLate = Math.max(0, daysBetween(p.due_date, today))
    }
    const status: DelayStatus =
      !shipped && p.due_date >= today ? 'upcoming'
        : daysLate >= DELAY_DAYS ? 'delayed'
          : daysLate > 0 ? 'late'
            : 'on_time'
    out.push({
      id: p.id,
      name: p.name,
      brandId: p.brand_id,
      brandName: brandName.get(p.brand_id) ?? 'Unknown client',
      dueDate: p.due_date,
      shipped,
      liveDate,
      daysLate,
      status,
      stageLabel: shipped ? 'Live' : stageLabel(p),
    })
  }
  return out
}

// --- Management -----------------------------------------------------------------

export interface PunctualityMonth {
  month: string // 'YYYY-MM'
  onTime: number
  late: number // 1-4 days
  delayed: number // 5+ days
  upcoming: number // not due yet
}

export interface LateOffer {
  id: string
  name: string
  brandId: string
  brandName: string
  targetMonth: string
  stage: string
  daysLate: number
}

export interface ClientWait {
  projectId: string
  projectName: string
  brandId: string
  brandName: string
  track: 'LP' | 'Creatives' | 'LP + Creatives'
  days: number
}

export interface DeliveryRow {
  brandId: string | null
  clientName: string
  expected: number
  delivered: number
  inFlight: number
}

export interface ManagementData {
  activeClients: number
  delayedClients: number
  delayedClientRate: number | null
  delayedNow: ProjectTiming[] // open, 5+ days late, worst first
  dueThisMonth: number
  delayedThisMonth: number
  delayedThisMonthRate: number | null
  avgDaysLate: number | null // shipped late projects, last 90 days
  onTimeRate90: number | null // shipped in the last 90 days, live by the due date
  punctuality: PunctualityMonth[]
  offersThisMonth: { total: number; approved: number; late: number }
  offerOnTimeRate: number | null // last 3 months, approved by the 5th
  lateOffers: LateOffer[]
  clientWaits: ClientWait[]
  delivery: DeliveryRow[]
}

const monthKey = (iso: string) => iso.slice(0, 7)

function shiftMonth(key: string, delta: number): string {
  const y = Number(key.slice(0, 4))
  const m = Number(key.slice(5, 7)) - 1 + delta
  const yy = y + Math.floor(m / 12)
  const mm = ((m % 12) + 12) % 12
  return `${yy}-${String(mm + 1).padStart(2, '0')}`
}

const offerDue = (targetMonth: string) => `${targetMonth.slice(0, 7)}-${String(OFFER_APPROVAL_DAY).padStart(2, '0')}`

function offerApprovalDates(offers: OpsOffer[], events: OpsEvent[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const e of events) {
    if (e.card_kind !== 'offer' || e.to_stage !== 'offer_approved') continue
    const cur = out.get(e.card_id)
    if (!cur || e.date < cur) out.set(e.card_id, e.date)
  }
  for (const o of offers) {
    if (!out.has(o.id) && o.client_approved_at) out.set(o.id, o.client_approved_at)
  }
  return out
}

export function lateOffers(offers: OpsOffer[], brandName: Map<string, string>, today: string): LateOffer[] {
  return offers
    .filter(o => o.stage !== 'offer_approved' && today > offerDue(o.target_month))
    .map(o => ({
      id: o.id,
      name: o.name,
      brandId: o.brand_id,
      brandName: brandName.get(o.brand_id) ?? 'Unknown client',
      targetMonth: o.target_month,
      stage: o.stage,
      daysLate: daysBetween(offerDue(o.target_month), today),
    }))
    .sort((a, b) => b.daysLate - a.daysLate)
}

export function clientWaits(
  projects: OpsProject[],
  events: OpsEvent[],
  brandName: Map<string, string>,
  today: string,
): ClientWait[] {
  const entered = new Map<string, string>() // `${id}|${track}` → latest entry date
  for (const e of events) {
    if (e.card_kind !== 'production' || e.to_stage !== 'client_review' || !e.track) continue
    const k = `${e.card_id}|${e.track}`
    const cur = entered.get(k)
    if (!cur || e.date > cur) entered.set(k, e.date)
  }
  const out: ClientWait[] = []
  for (const p of projects) {
    if (p.is_complete) continue
    const lp = p.lp_stage === 'client_review' ? entered.get(`${p.id}|lp`) : undefined
    const cr = p.creatives_stage === 'client_review' ? entered.get(`${p.id}|creative`) : undefined
    if (!lp && !cr) continue
    const since = lp && cr ? (lp < cr ? lp : cr) : (lp ?? cr)!
    out.push({
      projectId: p.id,
      projectName: p.name,
      brandId: p.brand_id,
      brandName: brandName.get(p.brand_id) ?? 'Unknown client',
      track: lp && cr ? 'LP + Creatives' : lp ? 'LP' : 'Creatives',
      days: daysBetween(since, today),
    })
  }
  return out.sort((a, b) => b.days - a.days)
}

export function computeManagement(args: {
  brands: OpsBrand[]
  projects: OpsProject[]
  events: OpsEvent[]
  offers: OpsOffer[]
  timings: ProjectTiming[]
  revenueClients: ClientRevenue[] | null
  mmClientKeys: Set<string> | null // clients with an MM line this month
  today: string
}): ManagementData {
  const { brands, projects, events, offers, timings, revenueClients, mmClientKeys, today } = args
  const brandName = new Map(brands.map(b => [b.id, b.name]))
  const thisMonth = monthKey(today)

  const activeBrandIds = new Set(brands.filter(b => b.is_active).map(b => b.id))
  const delayedNow = timings
    .filter(t => !t.shipped && t.status === 'delayed')
    .sort((a, b) => b.daysLate - a.daysLate)
  const delayedClientIds = new Set(delayedNow.map(t => t.brandId))
  const activeClients = activeBrandIds.size

  const dueThisMonth = timings.filter(t => monthKey(t.dueDate) === thisMonth && t.dueDate <= today)
  const delayedThisMonth = dueThisMonth.filter(t => t.status === 'delayed')

  const since90 = shiftMonth(thisMonth, -3) + today.slice(7)
  const shipped90 = timings.filter(t => t.shipped && t.dueDate >= since90 && t.dueDate <= today)
  const late90 = shipped90.filter(t => t.daysLate > 0)

  const punctuality: PunctualityMonth[] = []
  for (let i = -5; i <= 0; i++) {
    const m = shiftMonth(thisMonth, i)
    const inMonth = timings.filter(t => monthKey(t.dueDate) === m)
    punctuality.push({
      month: m,
      onTime: inMonth.filter(t => t.status === 'on_time').length,
      late: inMonth.filter(t => t.status === 'late').length,
      delayed: inMonth.filter(t => t.status === 'delayed').length,
      upcoming: inMonth.filter(t => t.status === 'upcoming').length,
    })
  }

  const approvals = offerApprovalDates(offers, events)
  const offersNow = offers.filter(o => monthKey(o.target_month) === thisMonth)
  const late = lateOffers(offers, brandName, today)
  const recentMonths = new Set([shiftMonth(thisMonth, -2), shiftMonth(thisMonth, -1), thisMonth])
  const judged = offers.filter(o => recentMonths.has(monthKey(o.target_month)) && today > offerDue(o.target_month))
  const onTime = judged.filter(o => {
    const a = approvals.get(o.id)
    return o.stage === 'offer_approved' && (!a || a <= offerDue(o.target_month))
  })

  // Delivery: moments shipped this month per client, against 2 per MM client.
  const delivery = new Map<string, DeliveryRow>()
  const rowFor = (brandId: string | null, name: string) => {
    const k = brandId ?? `name:${normalizeClientName(name)}`
    let r = delivery.get(k)
    if (!r) {
      r = { brandId, clientName: name, expected: 0, delivered: 0, inFlight: 0 }
      delivery.set(k, r)
    }
    return r
  }
  if (revenueClients && mmClientKeys) {
    for (const c of revenueClients) {
      if (!mmClientKeys.has(c.key)) continue
      rowFor(c.brandIds[0] ?? null, c.name).expected = MOMENTS_PER_MONTH
    }
  }
  for (const t of timings) {
    const shippedThisMonth = t.shipped && monthKey(t.liveDate ?? t.dueDate) === thisMonth
    const openThisMonth = !t.shipped && monthKey(t.dueDate) <= thisMonth
    if (!shippedThisMonth && !openThisMonth) continue
    const r = rowFor(t.brandId, t.brandName)
    if (shippedThisMonth) r.delivered++
    else r.inFlight++
  }

  return {
    activeClients,
    delayedClients: delayedClientIds.size,
    delayedClientRate: activeClients > 0 ? delayedClientIds.size / activeClients : null,
    delayedNow,
    dueThisMonth: dueThisMonth.length,
    delayedThisMonth: delayedThisMonth.length,
    delayedThisMonthRate: dueThisMonth.length > 0 ? delayedThisMonth.length / dueThisMonth.length : null,
    avgDaysLate: late90.length > 0 ? Math.round((late90.reduce((s, t) => s + t.daysLate, 0) / late90.length) * 10) / 10 : null,
    onTimeRate90: shipped90.length > 0 ? (shipped90.length - late90.length) / shipped90.length : null,
    punctuality,
    offersThisMonth: {
      total: offersNow.length,
      approved: offersNow.filter(o => o.stage === 'offer_approved').length,
      late: late.filter(o => monthKey(o.targetMonth) === thisMonth).length,
    },
    offerOnTimeRate: judged.length > 0 ? onTime.length / judged.length : null,
    lateOffers: late,
    clientWaits: clientWaits(projects, events, brandName, today),
    delivery: [...delivery.values()].sort((a, b) =>
      (b.expected - b.delivered - b.inFlight) - (a.expected - a.delivered - a.inFlight) ||
      a.clientName.localeCompare(b.clientName)),
  }
}

// --- Concerns + renewal odds ----------------------------------------------------

export type ConcernKind =
  | 'leaving' | 'fee_drop' | 'delayed_project' | 'late_offer'
  | 'weak_launch' | 'low_roas' | 'waiting_client'

export interface ConcernFlag {
  kind: ConcernKind
  label: string
  /** Points taken off renewal odds. */
  penalty: number
}

export interface ClientConcern {
  key: string
  brandId: string | null
  name: string
  currentCents: number
  nextCents: number
  services: string[]
  flags: ConcernFlag[]
  renewalOdds: number // 0-100
}

export const CONCERN_LABELS: Record<ConcernKind, string> = {
  leaving: 'Leaving',
  fee_drop: 'Fee drop',
  delayed_project: 'Project delayed',
  late_offer: 'Offer late',
  weak_launch: 'Weak launch',
  low_roas: 'Low ROAS',
  waiting_client: 'Waiting on client',
}

const money = (cents: number) => '$' + Math.round(cents / 100).toLocaleString('en-US')

export function computeConcerns(args: {
  brands: OpsBrand[]
  timings: ProjectTiming[]
  lateOffers: LateOffer[]
  clientWaits: ClientWait[]
  trackings: OpsTracking[]
  projectName: Map<string, string>
  revenueClients: ClientRevenue[] | null
  nextMonthLabel: string | null
  today: string
}): ClientConcern[] {
  const { brands, timings, trackings, projectName, revenueClients, nextMonthLabel, today } = args
  const brandById = new Map(brands.map(b => [b.id, b]))

  // One entry per client: sheet clients first (they carry the revenue), then
  // any CRM brand that raises a flag without being in the sheet.
  const byKey = new Map<string, ClientConcern>()
  const keyForBrand = new Map<string, string>()
  for (const c of revenueClients ?? []) {
    byKey.set(c.key, {
      key: c.key, brandId: c.brandIds[0] ?? null, name: c.name,
      currentCents: c.currentCents, nextCents: c.nextCents, services: c.services,
      flags: [], renewalOdds: 100,
    })
    for (const id of c.brandIds) keyForBrand.set(id, c.key)
  }
  const entryFor = (brandId: string): ClientConcern => {
    const k = keyForBrand.get(brandId) ?? `brand:${brandId}`
    let e = byKey.get(k)
    if (!e) {
      e = {
        key: k, brandId, name: brandById.get(brandId)?.name ?? 'Unknown client',
        currentCents: 0, nextCents: 0, services: [], flags: [], renewalOdds: 100,
      }
      byKey.set(k, e)
      keyForBrand.set(brandId, k)
    }
    return e
  }

  // Revenue signals from the sheet.
  if (revenueClients && nextMonthLabel) {
    for (const c of revenueClients) {
      const e = byKey.get(c.key)!
      if (c.currentCents > 0 && c.nextCents === 0) {
        e.flags.push({ kind: 'leaving', label: `Not in ${nextMonthLabel} revenue`, penalty: 90 })
      } else if (c.currentCents > 0 && c.nextCents < c.currentCents) {
        e.flags.push({ kind: 'fee_drop', label: `Fee drops ${money(c.currentCents - c.nextCents)} in ${nextMonthLabel}`, penalty: 15 })
      }
    }
  }

  // Delays: first delayed project costs 20 points, each extra one 5 (max 30).
  const delayedByBrand = new Map<string, ProjectTiming[]>()
  for (const t of timings) {
    if (t.shipped || t.status !== 'delayed') continue
    const list = delayedByBrand.get(t.brandId) ?? []
    list.push(t)
    delayedByBrand.set(t.brandId, list)
  }
  for (const [brandId, list] of delayedByBrand) {
    const e = entryFor(brandId)
    list.sort((a, b) => b.daysLate - a.daysLate)
    list.forEach((t, i) => e.flags.push({
      kind: 'delayed_project',
      label: `${t.name}: ${t.daysLate} days past LIVE date`,
      penalty: i === 0 ? 20 : i < 3 ? 5 : 0,
    }))
  }

  args.lateOffers.forEach(o => {
    const e = entryFor(o.brandId)
    const already = e.flags.filter(f => f.kind === 'late_offer').length
    e.flags.push({ kind: 'late_offer', label: `${o.name}: not approved, ${o.daysLate} days past the ${OFFER_APPROVAL_DAY}th`, penalty: already < 2 ? 10 : 0 })
  })

  for (const w of args.clientWaits) {
    if (w.days <= CLIENT_WAIT_DAYS) continue
    entryFor(w.brandId).flags.push({
      kind: 'waiting_client', label: `${w.projectName}: ${w.track} in client review for ${w.days} days`, penalty: 5,
    })
  }

  // Results: launches in the last 30 days, or still running.
  for (const t of trackings) {
    if (!t.launched_on) continue
    const age = daysBetween(t.launched_on, today)
    if (t.ended_on !== null && age > RESULTS_LOOKBACK_DAYS) continue
    if (t.ended_on === null && age > RESULTS_LOOKBACK_DAYS * 3) continue
    const name = projectName.get(t.project_id) ?? 'Launch'
    const e = entryFor(t.brand_id)

    if (age >= WEAK_LAUNCH_MIN_DAYS && age <= RESULTS_LOOKBACK_DAYS) {
      const windowEnd = addDays(t.launched_on, WEAK_LAUNCH_WINDOW_DAYS)
      const firstWeek = t.daily
        .filter(d => d.stat_date >= t.launched_on! && d.stat_date < windowEnd)
        .reduce((s, d) => s + d.revenue_cents, 0)
      if (firstWeek < WEAK_LAUNCH_CENTS) {
        e.flags.push({
          kind: 'weak_launch',
          label: `${name}: ${money(firstWeek)} revenue in the first ${Math.min(age, WEAK_LAUNCH_WINDOW_DAYS)} days`,
          penalty: 20,
        })
      }
    }

    const spend = t.daily.reduce((s, d) => s + d.spend_cents, 0)
    const revenue = t.daily.reduce((s, d) => s + d.revenue_cents, 0)
    if (spend >= MIN_SPEND_FOR_ROAS_CENTS) {
      const b = brandById.get(t.brand_id)
      const cod: BrandCod | null = b && b.cod_value !== null ? { cod_value: b.cod_value, cod_mode: b.cod_mode ?? 'percent' } : null
      const breakEven = breakEvenRoas(cod)
      const floor = breakEven ?? DEFAULT_MIN_ROAS
      const roas = revenue / spend
      if (roas < floor) {
        e.flags.push({
          kind: 'low_roas',
          label: `${name}: ROAS ${roas.toFixed(2)} (${breakEven ? `break-even ${breakEven.toFixed(2)}` : `floor ${DEFAULT_MIN_ROAS.toFixed(1)}`})`,
          penalty: 15,
        })
      }
    }
  }

  const out: ClientConcern[] = []
  for (const e of byKey.values()) {
    // Repeat results flags on one client add a little, not the full amount again.
    let penalty = 0
    let seenWeak = 0, seenRoas = 0
    for (const f of e.flags) {
      if (f.kind === 'weak_launch') { penalty += seenWeak++ === 0 ? f.penalty : 5; continue }
      if (f.kind === 'low_roas') { penalty += seenRoas++ === 0 ? f.penalty : 5; continue }
      penalty += f.penalty
    }
    e.renewalOdds = Math.max(5, Math.min(100, 100 - penalty))
    out.push(e)
  }
  return out.sort((a, b) => a.renewalOdds - b.renewalOdds || b.currentCents - a.currentCents || a.name.localeCompare(b.name))
}

function addDays(iso: string, delta: number): string {
  const ms = Date.parse(`${iso}T00:00:00Z`) + delta * 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}

export function oddsBand(odds: number): 'healthy' | 'watch' | 'at_risk' {
  return odds >= 75 ? 'healthy' : odds >= 50 ? 'watch' : 'at_risk'
}
