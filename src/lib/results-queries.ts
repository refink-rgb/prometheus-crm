// Shared reads for the Results tab.
//
// Kept separate from results.ts, which is deliberately import-free so the
// verify script can run it under bare node. Anything touching Supabase lives
// here.

import type { createClient } from '@/lib/supabase/server'
import type { DailyResult } from '@/lib/results'

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

export const DAILY_COLUMNS =
  'id, tracked_campaign_id, stat_date, spend_cents, revenue_cents, incremental_revenue_cents, ' +
  'cpa_cents, purchases, landing_page_views, roas, unique_outbound_ctr, lp_conversion_rate, ' +
  'attribution_window, source, warnings, reported_at'

// PostgREST caps a result set (Supabase's max-rows setting, 1000 by default on
// a new project). A dashboard that silently drops rows past the cap reports
// numbers that are simply WRONG — quietly, and always in the same direction
// (understated) — which is the worst possible failure for a page whose entire
// job is to be trusted with revenue figures.
//
// So every read here PAGES until it sees a short page, rather than assuming a
// single request returns everything. 20 campaigns × 90 days already exceeds
// 1000 rows, so this is not a hypothetical.
const PAGE_SIZE = 1000

export async function fetchDailyResults(
  supabase: SupabaseClient,
  trackedCampaignIds: string[],
): Promise<{ rows: DailyResult[]; error: string | null }> {
  if (trackedCampaignIds.length === 0) return { rows: [], error: null }

  const all: DailyResult[] = []
  for (let page = 0; ; page++) {
    const from = page * PAGE_SIZE
    const { data, error } = await supabase
      .from('campaign_daily_results')
      .select(DAILY_COLUMNS)
      .in('tracked_campaign_id', trackedCampaignIds)
      .order('stat_date', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) return { rows: all, error: error.message }

    const batch = (data ?? []) as unknown as DailyResult[]
    all.push(...batch)

    // A short page means we've reached the end. An exactly-full page might be
    // the end too — the next request just comes back empty, which costs one
    // round-trip a day and removes the guesswork.
    if (batch.length < PAGE_SIZE) break

    // Backstop against an unbounded loop if a future change breaks the range
    // semantics. 50k campaign-days is far past any real usage.
    if (all.length >= 50_000) break
  }

  return { rows: all, error: null }
}
