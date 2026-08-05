import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { easternToday } from '@/lib/eastern'
import { addDaysIso } from '@/lib/results'
import {
  parsePayload,
  validateRows,
  type CampaignRef,
  type RejectedRow,
  type ValidatedRow,
} from '@/lib/results/validate'

// Service-role writes + crypto-free Node APIs. Same posture as
// /api/cron/daily, which this route's auth is modelled on.
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * /api/results/ingest — the daily campaign-results pipe.
 *
 * Auth: `Authorization: Bearer ${RESULTS_INGEST_SECRET}`, exactly like
 * /api/cron/daily's CRON_SECRET check. `/api/results` is in PUBLIC_PREFIXES
 * (src/middleware.ts) so the agent can call it without a session cookie; the
 * secret is the only gate, so it is checked before ANY work happens.
 *
 * GET  → the work list. Every live tracked campaign plus the date range it
 *        needs. THE CRM DECIDES WHAT TO FETCH, not the agent — that is what
 *        keeps the agent's prompt stable and stateless. It doesn't have to
 *        remember what it pulled yesterday, and a prompt edit can't silently
 *        change the window.
 *
 * POST → { reported_at, rows: [...] }, upserted on (tracked_campaign_id,
 *        stat_date). Every write is an UPSERT because Meta restates: the same
 *        day pulled next week must UPDATE, never append.
 */

// Trailing window re-pulled every day. Meta's attribution backfills for days
// after the event, so yesterday-only ingestion permanently freezes each day at
// its worst, earliest number.
const TRAILING_DAYS = 7

function authorized(request: Request): boolean {
  const secret = process.env.RESULTS_INGEST_SECRET
  if (!secret) return false
  return request.headers.get('authorization') === `Bearer ${secret}`
}

interface WorkItem {
  tracked_campaign_id: string
  ad_account_id: string
  campaign_id: string
  campaign_name: string
  // Non-null = pull the breakdown for THIS AD SET ONLY, not the campaign.
  // Several clients run each marketing moment as an ad set inside one
  // evergreen campaign, so campaign totals would be several moments summed.
  adset_id: string | null
  adset_name: string | null
  // Explicit so the agent never has to infer it from adset_id being present.
  level: 'campaign' | 'adset'
  launched_on: string
  // Inclusive range the agent should pull.
  from_date: string
  to_date: string
  // 'backfill' on first sight (nothing stored yet), 'trailing' thereafter.
  // Surfaced so the agent's run output says which it did.
  mode: 'backfill' | 'trailing'
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const today = easternToday()
  // The agent stops at YESTERDAY. Today is still accruing; plotting a partial
  // day beside complete ones reads as a crash, and it would be overwritten
  // tomorrow anyway.
  const through = addDaysIso(today, -1)

  // Full re-pull, for the weekly run that absorbs older restatements.
  const full = new URL(request.url).searchParams.get('full') === '1'

  const { data: campaigns, error } = await supabase
    .from('tracked_campaigns')
    .select('id, meta_ad_account_id, meta_campaign_id, campaign_name, meta_adset_id, adset_name, launched_on, ended_on')
    .is('ended_on', null)          // NULL means live — the whole filter
    .order('launched_on', { ascending: false })

  if (error) {
    return NextResponse.json({ error: `Failed to read tracked campaigns: ${error.message}` }, { status: 500 })
  }

  // CampaignRef plus the display names, which only the work list needs (they
  // go into the agent's run output so a human reading it sees names, not ids).
  const rows = (campaigns ?? []) as unknown as Array<
    CampaignRef & { campaign_name: string; adset_name: string | null }
  >

  // The latest stat_date we already hold per campaign decides
  // backfill-vs-trailing.
  //
  // One indexed single-row lookup PER CAMPAIGN, run in parallel, rather than
  // one `.in()` over every campaign at once. The grouped version looks cheaper
  // but is wrong at scale: PostgREST caps a result set, and 20 campaigns × 60
  // days already exceeds a 1000-row cap — the truncation would silently drop
  // the oldest campaigns' rows and re-backfill them from launch every single
  // day. These hit idx_campaign_daily_results_campaign_date directly, and this
  // endpoint runs once a day.
  const latestByCampaign = new Map<string, string>()
  const latestResults = await Promise.all(
    rows.map(c =>
      supabase
        .from('campaign_daily_results')
        .select('stat_date')
        .eq('tracked_campaign_id', c.id)
        .order('stat_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ),
  )
  for (let i = 0; i < rows.length; i++) {
    const { data, error: latestErr } = latestResults[i]
    if (latestErr) {
      return NextResponse.json({ error: `Failed to read existing results: ${latestErr.message}` }, { status: 500 })
    }
    if (data?.stat_date) latestByCampaign.set(rows[i].id, data.stat_date as string)
  }

  const work: WorkItem[] = []
  for (const c of rows) {
    // Launched today: nothing complete to pull yet. Skipped rather than sent
    // with an inverted range the agent would have to reason about.
    if (c.launched_on > through) continue

    const latest = latestByCampaign.get(c.id)
    const backfill = full || !latest

    // Trailing window starts TRAILING_DAYS before the last day we hold, never
    // before launch.
    const trailingStart = latest ? maxIso(c.launched_on, addDaysIso(latest, -TRAILING_DAYS)) : c.launched_on
    const from = backfill ? c.launched_on : trailingStart

    work.push({
      tracked_campaign_id: c.id,
      ad_account_id: c.meta_ad_account_id,
      campaign_id: c.meta_campaign_id,
      campaign_name: c.campaign_name,
      adset_id: c.meta_adset_id,
      adset_name: c.adset_name,
      level: c.meta_adset_id ? 'adset' : 'campaign',
      launched_on: c.launched_on,
      from_date: from,
      to_date: through,
      mode: backfill ? 'backfill' : 'trailing',
    })
  }

  return NextResponse.json({
    ok: true,
    today_eastern: today,
    through,
    attribution_window: '7d_click',
    campaign_count: work.length,
    // Restated verbatim so the agent's standing rules travel with the work
    // list rather than living only in a prompt someone can edit.
    instructions:
      'Pull the daily breakdown for each entry over [from_date, to_date] inclusive, at the 7d_click ' +
      'attribution window, and POST the rows back to this endpoint. ' +
      'IMPORTANT — check `level` on each entry. level="campaign" means pull campaign totals. ' +
      'level="adset" means pull ONLY that ad set (filter by its adset_id) and echo adset_id back on ' +
      'every row you post for it; campaign totals there would be several marketing moments summed ' +
      'together and will be rejected. ' +
      'Report ONLY what the tool returned. If a metric is unavailable, send null — never estimate, ' +
      'interpolate, or round to something that looks better. incremental_revenue comes from the ad ' +
      'account\'s existing "Incremental Revenue" column; if the account has no such column, send null.',
    campaigns: work,
  })
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const parsed = parsePayload(body)
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }
  const { reported_at, rows } = parsed.payload

  const supabase = createServiceClient()
  const today = easternToday()

  // ALL campaigns, not just live ones: a POST landing moments after someone
  // ends tracking should be validated against the real end date (and rejected
  // for days past it) rather than failing as "unknown campaign", which would
  // send the agent chasing a link that already exists.
  const { data: campaigns, error: campaignErr } = await supabase
    .from('tracked_campaigns')
    .select('id, meta_ad_account_id, meta_campaign_id, meta_adset_id, launched_on, ended_on')
  if (campaignErr) {
    return NextResponse.json({ error: `Failed to read tracked campaigns: ${campaignErr.message}` }, { status: 500 })
  }

  const { valid, rejected } = validateRows(
    rows,
    (campaigns ?? []) as unknown as CampaignRef[],
    today,
  )

  // A MANUAL ROW IS NEVER OVERWRITTEN BY THE AGENT. That is the repair path:
  // when the agent gets a day wrong, a human fixes it in the UI and the fix
  // has to survive tomorrow's run. Filtered here rather than in SQL because
  // Postgres upsert has no "update only when the existing row says so"
  // without a trigger, and a trigger would hide the rule from this file.
  const skippedManual: RejectedRow[] = []
  let writable = valid
  if (valid.length > 0) {
    // Bounded to the date range actually being written, so this can't grow
    // into a truncated result set as history accumulates. A truncated read
    // here would look like "no manual rows" and let the agent overwrite a
    // human's correction — the exact failure this guard exists to prevent.
    const statDates = valid.map(r => r.stat_date)
    const { data: manual, error: manualErr } = await supabase
      .from('campaign_daily_results')
      .select('tracked_campaign_id, stat_date')
      .eq('source', 'manual')
      .in('tracked_campaign_id', [...new Set(valid.map(r => r.tracked_campaign_id))])
      .gte('stat_date', minOf(statDates))
      .lte('stat_date', maxOf(statDates))
    if (manualErr) {
      return NextResponse.json({ error: `Failed to read manual overrides: ${manualErr.message}` }, { status: 500 })
    }
    const protectedKeys = new Set(
      ((manual ?? []) as unknown as Array<{ tracked_campaign_id: string; stat_date: string }>)
        .map(m => `${m.tracked_campaign_id}|${m.stat_date}`),
    )
    if (protectedKeys.size > 0) {
      writable = []
      for (const r of valid) {
        if (protectedKeys.has(`${r.tracked_campaign_id}|${r.stat_date}`)) {
          skippedManual.push({
            ad_account_id: null,
            campaign_id: r.tracked_campaign_id,
            stat_date: r.stat_date,
            reason: 'Skipped: a human manually corrected this day. Agent writes never overwrite source=manual.',
          })
        } else {
          writable.push(r)
        }
      }
    }
  }

  let upserted = 0
  let writeError: string | null = null

  if (writable.length > 0) {
    const payload = writable.map((r: ValidatedRow) => ({
      tracked_campaign_id: r.tracked_campaign_id,
      stat_date: r.stat_date,
      spend_cents: r.spend_cents,
      revenue_cents: r.revenue_cents,
      incremental_revenue_cents: r.incremental_revenue_cents,
      cpa_cents: r.cpa_cents,
      purchases: r.purchases,
      landing_page_views: r.landing_page_views,
      roas: r.roas,
      unique_outbound_ctr: r.unique_outbound_ctr,
      lp_conversion_rate: r.lp_conversion_rate,
      attribution_window: r.attribution_window,
      source: 'mcp_agent' as const,
      warnings: r.warnings,
      reported_at,
      updated_at: new Date().toISOString(),
    }))

    // THE RESTATEMENT FIX. onConflict names the unique index from
    // 20260805_add_campaign_results.sql; without it this would append a second
    // contradictory row for every day re-pulled, every single run.
    const { error: upsertErr, count } = await supabase
      .from('campaign_daily_results')
      .upsert(payload, { onConflict: 'tracked_campaign_id,stat_date', count: 'exact' })

    if (upsertErr) {
      writeError = upsertErr.message
    } else {
      upserted = count ?? payload.length
    }
  }

  const allRejected = [...rejected, ...skippedManual]

  // Audit trail. Written even on a failed upsert — the run where the agent
  // started returning garbage is exactly the one worth having a record of.
  // A logging failure must never turn a successful ingest into an error, so
  // this is best-effort.
  const dateRange = rangeLabel(valid.map(r => r.stat_date))
  const { error: logErr } = await supabase.from('campaign_result_ingests').insert({
    date_range: dateRange,
    rows_received: rows.length,
    rows_upserted: upserted,
    rows_rejected: allRejected.length,
    warnings: {
      rejected: allRejected,
      flagged: writable
        .filter(r => r.warnings.length > 0)
        .map(r => ({ stat_date: r.stat_date, tracked_campaign_id: r.tracked_campaign_id, warnings: r.warnings })),
      write_error: writeError,
    },
  })
  if (logErr) console.error(`[results/ingest] audit log write failed: ${logErr.message}`)

  if (writeError) {
    return NextResponse.json({
      ok: false,
      error: `Upsert failed: ${writeError}`,
      rows_received: rows.length,
      rows_rejected: allRejected.length,
      rejected: allRejected,
    }, { status: 500 })
  }

  const flagged = writable.filter(r => r.warnings.length > 0)

  return NextResponse.json({
    ok: true,
    date_range: dateRange,
    rows_received: rows.length,
    rows_upserted: upserted,
    rows_rejected: allRejected.length,
    // Returned in full so the agent's run output shows a human what went
    // wrong, instead of a silent success on a half-empty ingest.
    rejected: allRejected,
    rows_flagged: flagged.length,
    flagged: flagged.map(r => ({ stat_date: r.stat_date, warnings: r.warnings })),
  })
}

function maxIso(a: string, b: string): string {
  return a > b ? a : b
}

function minOf(dates: string[]): string {
  return dates.reduce((m, d) => (d < m ? d : m), dates[0])
}

function maxOf(dates: string[]): string {
  return dates.reduce((m, d) => (d > m ? d : m), dates[0])
}

function rangeLabel(dates: string[]): string | null {
  if (dates.length === 0) return null
  let min = dates[0]
  let max = dates[0]
  for (const d of dates) {
    if (d < min) min = d
    if (d > max) max = d
  }
  return min === max ? min : `${min}..${max}`
}
