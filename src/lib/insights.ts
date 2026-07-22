// Prometheus Evolution — Phase 4: insights computed from the event stream.
//
// Read-only over pipeline_events (+ projects/brands/profiles for names and
// current assignments). Never mutates anything. Volumes are small (tens of
// active projects, hundreds of events/month), so metrics are computed per
// request; the 50K event cap is a guard rail, not an expectation — if it's
// ever hit, move to windowed aggregation per the brief.
//
// Attribution note: producer attribution uses the track's CURRENT editor
// (lp_editor_id / creative_editor_id). Events don't record who was assigned
// at the time; with assignments rarely changing mid-flight this is the honest
// approximation, and `assigned` events exist if it ever needs to be exact.

import { easternDateOf, easternToday, daysBetween } from './eastern'
import type { Profile } from './types'
import { profileName } from './types'

type SupabaseClient = {
  from: (table: string) => any // eslint-disable-line @typescript-eslint/no-explicit-any
}

const EVENT_WINDOW_DAYS = 60
const RECENT_WINDOW_DAYS = 7
const WORKDAY_HOURS = 8

interface EventRow {
  event_type: string
  card_kind: string
  card_id: string
  brand_id: string | null
  track: 'lp' | 'creative' | null
  from_stage: string | null
  to_stage: string | null
  actor_id: string | null
  actor_label: string
  payload: Record<string, unknown>
  created_at: string
}

interface ProjectRow {
  id: string
  name: string
  brand_id: string
  due_date: string | null
  is_complete: boolean
  lp_stage: string
  creatives_stage: string
  lp_editor_id: string | null
  creative_editor_id: string | null
  brands: { name: string } | null
}

export interface BarDatum {
  label: string
  value: number
}

export interface SlipBuckets {
  on_time: number
  d1_3: number
  d4_7: number
  d8_plus: number
  rolled_over: number
}

export interface InsightsData {
  events_since: string | null // first event date, null = no events at all
  event_count: number
  capacity: {
    median_in_progress_days_lp: number | null
    median_in_progress_days_creative: number | null
    throughput_week_total: number
    throughput_by_producer: BarDatum[]
    queue_depth_by_producer: BarDatum[]
    utilization_by_producer: BarDatum[]
    context_switch_by_producer: BarDatum[]
  }
  slips: {
    evaluated_projects: number
    buckets: SlipBuckets
    rollover_rate: number | null // % of evaluated projects
    attribution_by_stage: BarDatum[]
    slip_by_brand: BarDatum[] // avg slip days per brand
    slip_by_producer: BarDatum[] // avg slip days per producer
    median_offer_approval_days: number | null
    approved_offers_measured: number
  }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const m = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  return Math.round(m * 10) / 10
}

function toBars(map: Map<string, number>, round = false): BarDatum[] {
  return [...map.entries()]
    .map(([label, value]) => ({ label, value: round ? Math.round(value * 10) / 10 : value }))
    .sort((a, b) => b.value - a.value)
}

// Weekday count in [from, to) — utilization denominator.
function workdaysBetween(fromMs: number, toMs: number): number {
  let count = 0
  for (let t = fromMs; t < toMs; t += 86_400_000) {
    const day = new Date(t).getUTCDay()
    if (day !== 0 && day !== 6) count++
  }
  return Math.max(1, count)
}

export async function computeInsights(supabase: SupabaseClient, profiles: Profile[]): Promise<InsightsData> {
  const windowStart = new Date(Date.now() - EVENT_WINDOW_DAYS * 86_400_000).toISOString()

  const [{ data: eventsRaw }, { data: projectsRaw }] = await Promise.all([
    supabase
      .from('pipeline_events')
      .select('event_type, card_kind, card_id, brand_id, track, from_stage, to_stage, actor_id, actor_label, payload, created_at')
      .gte('created_at', windowStart)
      .order('created_at', { ascending: true })
      .limit(50000),
    supabase
      .from('projects')
      .select('id, name, brand_id, due_date, is_complete, lp_stage, creatives_stage, lp_editor_id, creative_editor_id, brands(name)'),
  ])

  const events = (eventsRaw ?? []) as EventRow[]
  const projects = (projectsRaw ?? []) as unknown as ProjectRow[]
  const projectById = new Map(projects.map(p => [p.id, p]))
  const profileById = new Map(profiles.map(p => [p.id, p]))
  const profileByEmail = new Map(profiles.map(p => [p.email, p]))

  const today = easternToday()
  const nowMs = Date.now()
  const recentStartMs = nowMs - RECENT_WINDOW_DAYS * 86_400_000

  const producerName = (profileId: string | null): string | null => {
    const p = profileId ? profileById.get(profileId) : undefined
    return p ? profileName(p) : null
  }
  const trackEditor = (project: ProjectRow | undefined, track: 'lp' | 'creative' | null): string | null => {
    if (!project || !track) return null
    return producerName(track === 'lp' ? project.lp_editor_id : project.creative_editor_id)
  }

  // ── In Progress durations (per completed interval, per track) ────────────
  // Walk stage events per card+track; entering in_progress opens an interval,
  // leaving it closes one. Open intervals also feed utilization below.
  const prodStageEvents = events.filter(e => e.event_type === 'stage_changed' && e.card_kind === 'production')
  const intervalsByTrack: Record<'lp' | 'creative', number[]> = { lp: [], creative: [] }
  {
    // Only CLOSED intervals count toward the median build-time figure — a
    // track still In Progress hasn't finished, so its duration is unknown.
    // (Open intervals are handled separately by utilization, below.)
    const openByKey = new Map<string, number>() // cardId:track → startMs
    for (const e of prodStageEvents) {
      if (!e.track) continue
      const key = `${e.card_id}:${e.track}`
      if (e.to_stage === 'in_progress') {
        openByKey.set(key, Date.parse(e.created_at))
      } else if (e.from_stage === 'in_progress') {
        const start = openByKey.get(key)
        if (start !== undefined) {
          intervalsByTrack[e.track].push((Date.parse(e.created_at) - start) / 86_400_000)
          openByKey.delete(key)
        }
      }
    }
  }

  // ── Throughput: cards shipped to Internal Review, last 7 days ────────────
  const throughputMap = new Map<string, number>()
  let throughputTotal = 0
  for (const e of prodStageEvents) {
    if (e.to_stage !== 'internal_review' || Date.parse(e.created_at) < recentStartMs) continue
    throughputTotal++
    const name = trackEditor(projectById.get(e.card_id), e.track)
      ?? (e.actor_id ? producerName(e.actor_id) : null)
      ?? profileByEmail.get(e.actor_label)?.full_name
      ?? e.actor_label
    throughputMap.set(name, (throughputMap.get(name) ?? 0) + 1)
  }

  // ── Queue depth: tracks assigned but still sitting in Brief ──────────────
  const queueMap = new Map<string, number>()
  for (const p of projects) {
    if (p.is_complete) continue
    for (const track of ['lp', 'creative'] as const) {
      const stage = track === 'lp' ? p.lp_stage : p.creatives_stage
      const editor = trackEditor(p, track)
      if (editor && stage === 'brief') queueMap.set(editor, (queueMap.get(editor) ?? 0) + 1)
    }
  }

  // ── Utilization: fraction of the last 7 working days with a track in
  //    In Progress, per producer. Interval union per producer, clamped. ─────
  const producerIntervals = new Map<string, Array<[number, number]>>()
  const addInterval = (name: string | null, start: number, end: number) => {
    if (!name) return
    const s = Math.max(start, recentStartMs)
    const e = Math.min(end, nowMs)
    if (e <= s) return
    const list = producerIntervals.get(name) ?? []
    list.push([s, e])
    producerIntervals.set(name, list)
  }
  // Closed intervals need a second pass (we only kept durations above), so
  // re-walk with timestamps.
  {
    const open = new Map<string, number>()
    for (const e of prodStageEvents) {
      if (!e.track) continue
      const key = `${e.card_id}:${e.track}`
      if (e.to_stage === 'in_progress') open.set(key, Date.parse(e.created_at))
      else if (e.from_stage === 'in_progress') {
        const start = open.get(key)
        if (start !== undefined) {
          addInterval(trackEditor(projectById.get(e.card_id), e.track), start, Date.parse(e.created_at))
          open.delete(key)
        }
      }
    }
    for (const [key, startMs] of open) {
      const [cardId, track] = key.split(':') as [string, 'lp' | 'creative']
      addInterval(trackEditor(projectById.get(cardId), track), startMs, nowMs)
    }
  }
  const availableHours = workdaysBetween(recentStartMs, nowMs) * WORKDAY_HOURS
  const utilizationMap = new Map<string, number>()
  for (const [name, list] of producerIntervals) {
    const sorted = list.sort((a, b) => a[0] - b[0])
    let busyMs = 0
    let curStart = -1
    let curEnd = -1
    for (const [s, e] of sorted) {
      if (s > curEnd) {
        if (curEnd > curStart) busyMs += curEnd - curStart
        curStart = s
        curEnd = e
      } else {
        curEnd = Math.max(curEnd, e)
      }
    }
    if (curEnd > curStart) busyMs += curEnd - curStart
    utilizationMap.set(name, Math.min(100, Math.round((busyMs / 3_600_000 / availableHours) * 100)))
  }

  // ── Context-switch load: distinct brands touched per active day, last 7d ─
  const actorDayBrands = new Map<string, Map<string, Set<string>>>() // name → day → brands
  for (const e of events) {
    if (Date.parse(e.created_at) < recentStartMs || !e.brand_id) continue
    if (e.actor_label === 'system' || e.actor_label === 'client') continue
    const name = (e.actor_id ? producerName(e.actor_id) : null)
      ?? profileByEmail.get(e.actor_label)?.full_name
      ?? e.actor_label
    const day = easternDateOf(e.created_at)
    const days = actorDayBrands.get(name) ?? new Map<string, Set<string>>()
    const brands = days.get(day) ?? new Set<string>()
    brands.add(e.brand_id)
    days.set(day, brands)
    actorDayBrands.set(name, days)
  }
  const contextSwitchMap = new Map<string, number>()
  for (const [name, days] of actorDayBrands) {
    const counts = [...days.values()].map(s => s.size)
    contextSwitchMap.set(name, counts.reduce((a, b) => a + b, 0) / counts.length)
  }

  // ── Slip metrics ─────────────────────────────────────────────────────────
  // A project is evaluable once its outcome is known: it went live (event) or
  // it's already past due. slip = live date (or today) minus due date.
  const liveDateByCard = new Map<string, string>() // latest track to reach live
  for (const e of prodStageEvents) {
    if (e.to_stage !== 'live') continue
    const d = easternDateOf(e.created_at)
    const prev = liveDateByCard.get(e.card_id)
    if (!prev || d > prev) liveDateByCard.set(e.card_id, d)
  }

  const buckets: SlipBuckets = { on_time: 0, d1_3: 0, d4_7: 0, d8_plus: 0, rolled_over: 0 }
  const slipDaysByBrand = new Map<string, number[]>()
  let evaluated = 0
  for (const p of projects) {
    if (!p.due_date) continue
    const liveDate = liveDateByCard.get(p.id)
    const shipped = liveDate !== undefined || p.is_complete
    if (!shipped && p.due_date >= today) continue // future card, nothing to say yet
    // Completed cards with no live event predate Phase 1 — no honest slip data.
    if (!liveDate && p.is_complete) continue
    evaluated++
    const endDate = liveDate ?? today
    const slip = daysBetween(p.due_date, endDate)
    const rolled = endDate.slice(0, 7) > p.due_date.slice(0, 7)
    if (rolled) buckets.rolled_over++
    else if (slip <= 0) buckets.on_time++
    else if (slip <= 3) buckets.d1_3++
    else if (slip <= 7) buckets.d4_7++
    else buckets.d8_plus++
    if (slip > 0) {
      const brandName = p.brands?.name ?? 'Unknown'
      slipDaysByBrand.set(brandName, [...(slipDaysByBrand.get(brandName) ?? []), slip])
    }
  }

  // Attribution + per-producer slip from slip_recorded events (latest per
  // card+track carries the current delta and the stage it sat in).
  const latestSlip = new Map<string, EventRow>()
  for (const e of events) {
    if (e.event_type === 'slip_recorded') latestSlip.set(`${e.card_id}:${e.track}`, e)
  }
  const attributionMap = new Map<string, number>()
  const slipDaysByProducer = new Map<string, number[]>()
  for (const e of latestSlip.values()) {
    const stage = String(e.payload?.attributed_stage ?? 'unknown')
    attributionMap.set(stage, (attributionMap.get(stage) ?? 0) + 1)
    const editor = trackEditor(projectById.get(e.card_id), e.track)
    const delta = Number(e.payload?.delta_days ?? 0)
    if (editor && delta > 0) {
      slipDaysByProducer.set(editor, [...(slipDaysByProducer.get(editor) ?? []), delta])
    }
  }

  // ── Median offer approval time (Client Review entry → Offer Approved) ────
  const offerEvents = events.filter(e => e.event_type === 'stage_changed' && e.card_kind === 'offer')
  const clientReviewEntry = new Map<string, number>()
  const approvalDurations: number[] = []
  for (const e of offerEvents) {
    if (e.to_stage === 'client_review' && !clientReviewEntry.has(e.card_id)) {
      clientReviewEntry.set(e.card_id, Date.parse(e.created_at))
    }
    if (e.to_stage === 'offer_approved') {
      const entry = clientReviewEntry.get(e.card_id)
      if (entry !== undefined) approvalDurations.push((Date.parse(e.created_at) - entry) / 86_400_000)
    }
  }

  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

  return {
    events_since: events.length > 0 ? easternDateOf(events[0].created_at) : null,
    event_count: events.length,
    capacity: {
      median_in_progress_days_lp: median(intervalsByTrack.lp),
      median_in_progress_days_creative: median(intervalsByTrack.creative),
      throughput_week_total: throughputTotal,
      throughput_by_producer: toBars(throughputMap),
      queue_depth_by_producer: toBars(queueMap),
      utilization_by_producer: toBars(utilizationMap),
      context_switch_by_producer: toBars(contextSwitchMap, true),
    },
    slips: {
      evaluated_projects: evaluated,
      buckets,
      rollover_rate: evaluated > 0 ? Math.round((buckets.rolled_over / evaluated) * 100) : null,
      attribution_by_stage: toBars(attributionMap),
      slip_by_brand: toBars(new Map([...slipDaysByBrand].map(([k, v]) => [k, avg(v)])), true).slice(0, 8),
      slip_by_producer: toBars(new Map([...slipDaysByProducer].map(([k, v]) => [k, avg(v)])), true),
      median_offer_approval_days: median(approvalDurations),
      approved_offers_measured: approvalDurations.length,
    },
  }
}
