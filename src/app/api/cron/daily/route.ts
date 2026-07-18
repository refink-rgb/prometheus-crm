import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { daysBetween, easternToday } from '@/lib/eastern'
import { eventsEnabled, logEvents, type EventTrack, type PipelineEventInput } from '@/lib/events'

export const runtime = 'nodejs'
export const maxDuration = 60

// Daily cron (vercel.json — 06:00 UTC, i.e. 1-2am Eastern; scheduled well clear
// of the Eastern midnight boundary so the "today" it computes is unambiguous).
//
// Phase 1 job: the slip scan. A track sitting in a stage past that stage's due
// date gets a slip_recorded event — one per track per Eastern day, deduped so a
// manual re-run doesn't double-log. delta_days grows daily while it stays
// overdue; the latest slip event for a card is its current slip state.
//
// Phase 3 extends this same route with the on-the-24th offer-card generation.
//
// Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}` when the CRON_SECRET
// env var is set. Manual re-runs pass the same header.

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

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
  if (!eventsEnabled()) {
    return NextResponse.json({ ok: true, skipped: 'events disabled' })
  }

  const supabase = createServiceClient()
  const today = easternToday()

  const { data: projects, error } = await supabase
    .from('projects')
    .select('id, brand_id, lp_stage, creatives_stage, stage_brief_due_date, stage_in_progress_due_date, stage_internal_review_due_date, stage_client_review_due_date')
    .eq('is_complete', false)
  if (error) {
    return NextResponse.json({ error: `Project scan failed: ${error.message}` }, { status: 500 })
  }

  // Already logged today (idempotency for manual re-runs / double fires).
  const { data: existing, error: dedupeErr } = await supabase
    .from('pipeline_events')
    .select('card_id, track')
    .eq('event_type', 'slip_recorded')
    .eq('payload->>actual_date', today)
  if (dedupeErr) {
    return NextResponse.json({ error: `Dedupe query failed: ${dedupeErr.message}` }, { status: 500 })
  }
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

  return NextResponse.json({
    ok: true,
    date_eastern: today,
    open_projects: (projects ?? []).length,
    slips_recorded: events.length,
  })
}
