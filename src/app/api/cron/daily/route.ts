import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { daysBetween, easternDayOfMonth, easternToday, followingMonthStart } from '@/lib/eastern'
import { eventsEnabled, logEvents, type EventTrack, type PipelineEventInput } from '@/lib/events'
import { offerCardName, offerMonthLabel } from '@/lib/types'

export const runtime = 'nodejs'
export const maxDuration = 60

// Daily cron (vercel.json — 06:00 UTC, i.e. 1-2am Eastern; scheduled well clear
// of the Eastern midnight boundary so the "today" it computes is unambiguous).
//
// Jobs, in order:
//   1. Slip scan (Phase 1): a track sitting in a stage past that stage's due
//      date gets a slip_recorded event — one per track per Eastern day,
//      deduped so a manual re-run doesn't double-log.
//   2. Offer generation (Phase 3 Trigger A): on the 24th Eastern (or with
//      ?force_generate=1 for validation), create the following month's 2
//      offer cards per active client. Idempotent twice over: an existence
//      pre-check plus the DB unique index (brand_id, target_month,
//      moment_slot) — duplicates are skipped, never errored.
//   3. Alerts (reported in the response + Vercel error log):
//      - approved offers with no linked production card (Trigger B failed or
//        was killed mid-flight) — the "fail loud" net;
//      - after the 24th: active brands missing next month's cards (e.g.
//        clients onboarded mid-cycle — signed-off decision: no auto-create,
//        notify and let a PM create manually on /offers).
//
// Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}` when the
// CRON_SECRET env var is set. Manual runs pass the same header.

const STAGE_DUE_COLUMN = {
  brief: 'stage_brief_due_date',
  in_progress: 'stage_in_progress_due_date',
  internal_review: 'stage_internal_review_due_date',
  client_review: 'stage_client_review_due_date',
} as const

type SlippableStage = keyof typeof STAGE_DUE_COLUMN

type OpenProject = {
  id: string
  brand_id: string
  lp_stage: string
  creatives_stage: string
  stage_brief_due_date: string | null
  stage_in_progress_due_date: string | null
  stage_internal_review_due_date: string | null
  stage_client_review_due_date: string | null
}

type SupabaseService = ReturnType<typeof createServiceClient>

async function runSlipScan(supabase: SupabaseService, today: string) {
  const { data: projects, error } = await supabase
    .from('projects')
    .select('id, brand_id, lp_stage, creatives_stage, stage_brief_due_date, stage_in_progress_due_date, stage_internal_review_due_date, stage_client_review_due_date')
    .eq('is_complete', false)
  if (error) throw new Error(`Project scan failed: ${error.message}`)

  // Already logged today (idempotency for manual re-runs / double fires).
  const { data: existing, error: dedupeErr } = await supabase
    .from('pipeline_events')
    .select('card_id, track')
    .eq('event_type', 'slip_recorded')
    .eq('payload->>actual_date', today)
  if (dedupeErr) throw new Error(`Dedupe query failed: ${dedupeErr.message}`)
  const alreadyLogged = new Set((existing ?? []).map(e => `${e.card_id}:${e.track}`))

  const events: PipelineEventInput[] = []
  for (const p of (projects ?? []) as OpenProject[]) {
    const tracks: Array<{ track: EventTrack; stage: string }> = [
      { track: 'lp', stage: p.lp_stage },
      { track: 'creative', stage: p.creatives_stage },
    ]
    for (const { track, stage } of tracks) {
      if (!(stage in STAGE_DUE_COLUMN)) continue // live/done can't slip
      const expected = p[STAGE_DUE_COLUMN[stage as SlippableStage]]
      if (!expected || expected >= today) continue
      if (alreadyLogged.has(`${p.id}:${track}`)) continue
      events.push({
        event_type: 'slip_recorded',
        card_id: p.id,
        brand_id: p.brand_id,
        track,
        actor_label: 'system',
        payload: {
          attributed_stage: stage,
          expected_date: expected,
          actual_date: today,
          delta_days: daysBetween(expected, today),
        },
      })
    }
  }

  await logEvents(events)
  return { open_projects: (projects ?? []).length, slips_recorded: events.length }
}

// Trigger A: two cards (M1 + M2) per active client for `targetMonth`.
async function runOfferGeneration(supabase: SupabaseService, targetMonth: string) {
  const { data: brands, error: brandErr } = await supabase
    .from('brands')
    .select('id, name')
    .eq('is_active', true)
    .order('name')
  if (brandErr) throw new Error(`Active-brand query failed: ${brandErr.message}`)

  const { data: existingCards, error: existErr } = await supabase
    .from('offer_cards')
    .select('brand_id, moment_slot')
    .eq('target_month', targetMonth)
  if (existErr) throw new Error(`Existing-card query failed: ${existErr.message}`)
  const exists = new Set((existingCards ?? []).map(c => `${c.brand_id}:${c.moment_slot}`))

  const rows: Array<Record<string, unknown>> = []
  let skipped = 0
  for (const brand of brands ?? []) {
    for (const slot of [1, 2] as const) {
      if (exists.has(`${brand.id}:${slot}`)) { skipped++; continue }
      rows.push({
        brand_id: brand.id,
        target_month: targetMonth,
        moment_slot: slot,
        name: offerCardName(brand.name, targetMonth, slot),
        // stage defaults to 'auto_generated'; created_by null = system.
      })
    }
  }

  if (rows.length > 0) {
    // Belt to the pre-check's suspenders: if a concurrent run inserted the
    // same key between our check and this write, ignore the duplicate rather
    // than failing the batch.
    const { error: insErr } = await supabase
      .from('offer_cards')
      .upsert(rows, { onConflict: 'brand_id,target_month,moment_slot', ignoreDuplicates: true })
    if (insErr) throw new Error(`Offer card insert failed: ${insErr.message}`)
  }

  console.log(`[cron] Trigger A for ${offerMonthLabel(targetMonth)}: ${rows.length} card(s) created, ${skipped} already existed, ${(brands ?? []).length} active client(s).`)
  return {
    target_month: targetMonth,
    active_clients: (brands ?? []).length,
    cards_created: rows.length,
    cards_already_existed: skipped,
  }
}

// Alert surface — findings land in the JSON response AND the error log.
async function collectAlerts(supabase: SupabaseService, dayOfMonth: number, targetMonth: string) {
  const alerts: string[] = []

  // Approved offers whose production card never materialized (Trigger B net).
  const { data: unlinked } = await supabase
    .from('offer_cards')
    .select('id, name')
    .eq('stage', 'offer_approved')
    .is('derived_production_card_id', null)
  for (const o of unlinked ?? []) {
    alerts.push(`Approved offer has NO production card: "${o.name}" (${o.id}) — move it out of Approved and back in to retry, or create the production card manually.`)
  }

  // After generation day: active brands missing next month's cards — the
  // mid-cycle-onboarding case. Signed-off behavior: notify, don't auto-create.
  if (dayOfMonth > 24) {
    const [{ data: brands }, { data: cards }] = await Promise.all([
      supabase.from('brands').select('id, name').eq('is_active', true),
      supabase.from('offer_cards').select('brand_id, moment_slot').eq('target_month', targetMonth),
    ])
    const have = new Set((cards ?? []).map(c => `${c.brand_id}:${c.moment_slot}`))
    for (const b of brands ?? []) {
      const missing = ([1, 2] as const).filter(slot => !have.has(`${b.id}:${slot}`))
      if (missing.length > 0) {
        alerts.push(`Active client "${b.name}" is missing ${missing.map(m => `M${m}`).join(' + ')} offer card(s) for ${offerMonthLabel(targetMonth)} (onboarded mid-cycle?) — create manually on /offers.`)
      }
    }
  }

  for (const a of alerts) console.error(`[cron] ALERT: ${a}`)
  return alerts
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const today = easternToday()
  const dayOfMonth = easternDayOfMonth()
  const targetMonth = followingMonthStart(today)
  const forceGenerate = new URL(request.url).searchParams.get('force_generate') === '1'

  try {
    const slipScan = eventsEnabled()
      ? await runSlipScan(supabase, today)
      : { skipped: 'events disabled' as const }

    const generation = (dayOfMonth === 24 || forceGenerate)
      ? await runOfferGeneration(supabase, targetMonth)
      : { skipped: `not the 24th (Eastern day ${dayOfMonth})${forceGenerate ? '' : '; pass ?force_generate=1 to override'}` as const }

    const alerts = await collectAlerts(supabase, dayOfMonth, targetMonth)

    return NextResponse.json({ ok: true, date_eastern: today, slip_scan: slipScan, offer_generation: generation, alerts })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[cron] daily run FAILED: ${msg}`)
    return NextResponse.json({ ok: false, date_eastern: today, error: msg }, { status: 500 })
  }
}
