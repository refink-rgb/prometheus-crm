// Shared reads for the Results tab.
//
// Kept separate from results.ts, which is deliberately import-free so the
// verify script can run it under bare node. Anything touching Supabase lives
// here.

import type { createClient } from '@/lib/supabase/server'
import type { DailyResult, FunnelDailyRow } from '@/lib/results'

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

// LP funnel reads for the /results overview: same paging discipline as
// fetchDailyResults (a silently truncated read understates revenue), but over
// the LP tables, keyed by their own parent columns.
const FUNNEL_COLUMNS =
  'stat_date, spend_cents, revenue_cents, purchases, impressions, link_clicks, ' +
  'initiate_checkouts, landing_page_views, source, warnings, reported_at'

export type LpDailyWithParent = FunnelDailyRow & { lp_tracking_id: string }
export type AccountDailyWithParent = FunnelDailyRow & { meta_ad_account_id: string }

async function fetchFunnelPaged<T>(
  supabase: SupabaseClient,
  table: string,
  parentColumn: string,
  parentIds: string[],
  sinceIso?: string,
): Promise<T[]> {
  if (parentIds.length === 0) return []
  const all: T[] = []
  for (let page = 0; ; page++) {
    const from = page * PAGE_SIZE
    let query = supabase
      .from(table)
      .select(`${parentColumn}, ${FUNNEL_COLUMNS}`)
      .in(parentColumn, parentIds)
      .order('stat_date', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (sinceIso) query = query.gte('stat_date', sinceIso)
    const { data, error } = await query
    if (error) return all
    const batch = (data ?? []) as unknown as T[]
    all.push(...batch)
    if (batch.length < PAGE_SIZE) break
    if (all.length >= 50_000) break
  }
  return all
}

export function fetchLpDailyAll(
  supabase: SupabaseClient,
  trackingIds: string[],
): Promise<LpDailyWithParent[]> {
  return fetchFunnelPaged<LpDailyWithParent>(supabase, 'lp_daily_results', 'lp_tracking_id', trackingIds)
}

// The included ad matches for a set of trackings — enough to build an Ads
// Manager deep link per page. Paged like everything else here.
export interface IncludedAdMatch {
  lp_tracking_id: string
  meta_ad_id: string
  meta_campaign_id: string | null
}

export async function fetchIncludedAdMatches(
  supabase: SupabaseClient,
  trackingIds: string[],
): Promise<IncludedAdMatch[]> {
  if (trackingIds.length === 0) return []
  const all: IncludedAdMatch[] = []
  for (let page = 0; ; page++) {
    const from = page * PAGE_SIZE
    const { data, error } = await supabase
      .from('lp_ad_matches')
      .select('lp_tracking_id, meta_ad_id, meta_campaign_id')
      .in('lp_tracking_id', trackingIds)
      .eq('status', 'included')
      .range(from, from + PAGE_SIZE - 1)
    if (error) return all
    const batch = (data ?? []) as unknown as IncludedAdMatch[]
    all.push(...batch)
    if (batch.length < PAGE_SIZE) break
    if (all.length >= 50_000) break
  }
  return all
}

export function fetchAccountDailyAll(
  supabase: SupabaseClient,
  accountIds: string[],
  sinceIso: string,
): Promise<AccountDailyWithParent[]> {
  return fetchFunnelPaged<AccountDailyWithParent>(supabase, 'account_daily_results', 'meta_ad_account_id', accountIds, sinceIso)
}
