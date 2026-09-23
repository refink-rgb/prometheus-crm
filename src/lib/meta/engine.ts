// The in-app results engine — the scheduled Claude agent, as code.
//
// It fulfills the exact contract in RESULTS_AGENT_PROMPT.md, deterministically:
//
//   1. GET  /api/results/ingest        → the work list (the CRM decides WHAT)
//   2. Meta Marketing API              → the numbers (this module decides HOW)
//   3. POST /api/results/ingest        → the same validated, audited write path
//
// Deliberately self-calling over HTTP rather than importing the route's
// internals: every guarantee the ingest endpoint enforces (URL verification on
// discovered ads, launch-date fill-only-when-null, manual-row protection,
// warn-don't-drop validation, the audit log) applies to the engine EXACTLY as
// it did to the agent, because the endpoint cannot tell them apart.
//
// Scope per run: everything the work list carries — campaign/ad-set rows for
// the classic /results pipeline, plus the LP sections (ad discovery by
// landing-page URL, launch-date detection, daily LP rows, whole-account rows).

import {
  metaGet, metaGetAll, actionNumber, MetaApiError, MetaDeadlineError,
  INSIGHTS_FIELDS, ATTRIBUTION, type InsightsRow,
} from '@/lib/meta/graph'
import { normalizeLpUrl, addDaysIso } from '@/lib/results'

// ---------------------------------------------------------------------------
// Work-list shapes (what GET /api/results/ingest returns)
// ---------------------------------------------------------------------------

interface CampaignWork {
  tracked_campaign_id: string
  ad_account_id: string
  campaign_id: string | null
  campaign_name: string | null
  brand_name: string | null
  adset_id: string | null
  adset_name: string | null
  level: 'campaign' | 'adset'
  from_date: string
  to_date: string
}

interface LpWork {
  lp_tracking_id: string
  project_name: string | null
  brand_name: string | null
  ad_account_id: string
  lp_url: string
  included_ad_ids: string[]
  known_ad_ids: string[]
  launched_on: string | null
  needs_launch_date: boolean
  from_date: string | null
  to_date: string | null
}

interface AccountWork {
  ad_account_id: string
  from_date: string
  to_date: string
}

interface WorkList {
  ok: boolean
  through: string
  campaigns: CampaignWork[]
  lp_pages: LpWork[]
  accounts: AccountWork[]
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function baseUrl(): string {
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL
  if (prod) return `https://${prod}`
  const dep = process.env.VERCEL_URL
  if (dep) return `https://${dep}`
  return 'http://localhost:3000'
}

function ingestSecret(): string {
  const s = process.env.RESULTS_INGEST_SECRET
  if (!s) throw new Error('RESULTS_INGEST_SECRET is not set.')
  return s
}

// How far back ad discovery looks for candidate ads. With a KNOWN launch the
// window hugs it (ads for a page are created around its launch; older ads
// that point at it are the manual-add path's job). With NO launch date yet
// the tracking may be a historical backfill, so the window is wide enough to
// reach pages from over a year ago.
const DISCOVERY_LOOKBACK_DAYS = 90
const HISTORICAL_LOOKBACK_DAYS = 540

// Stop starting new pulls past this point in a run and POST what's done.
// The route's maxDuration is 300s; a run killed by the platform mid-loop
// would lose EVERYTHING (the POST happens at the end), so the engine budgets
// itself and lets the next pass continue — every pull is idempotent.
const TIME_BUDGET_MS = 210_000
// Hard stop for in-flight pulls — past this, listings return partial results
// and summed reads abort, so the run always reaches its POST before the
// platform's 300s kill (which would lose EVERYTHING pulled so far).
const HARD_DEADLINE_MS = 250_000
let runDeadline = 0

// ---------------------------------------------------------------------------
// Meta pulls
// ---------------------------------------------------------------------------

interface AdListing {
  id: string
  name?: string
  created_time?: string
  adset?: { id: string; name?: string }
  campaign?: { id: string; name?: string }
  creative?: {
    id?: string
    object_story_spec?: StorySpec
    asset_feed_spec?: { link_urls?: Array<{ website_url?: string }> }
  }
}

interface StorySpec {
  link_data?: { link?: string; child_attachments?: Array<{ link?: string }> }
  video_data?: { call_to_action?: { value?: { link?: string } } }
}

function destinationUrls(ad: AdListing, effectiveSpecs?: Map<string, StorySpec>): string[] {
  const urls: string[] = [...specUrls(ad.creative?.object_story_spec)]
  for (const lu of ad.creative?.asset_feed_spec?.link_urls ?? []) {
    if (lu.website_url) urls.push(lu.website_url)
  }
  if (urls.length === 0 && ad.creative?.id && effectiveSpecs) {
    urls.push(...specUrls(effectiveSpecs.get(ad.creative.id)))
  }
  return urls
}

// Every ad in the account whose destination matches the LP URL. Bounded by
// created_time so a decade-old account doesn't get walked end to end.
// Per-run cache of account ad listings: twenty projects of one brand share
// one account, and each run should list that account once, not twenty times.
const adListingCache = new Map<string, Promise<AdListing[]>>()
const effectiveSpecCache = new Map<string, Promise<Map<string, StorySpec>>>()

async function discoverAds(work: LpWork) {
  const today = new Date().toISOString().slice(0, 10)
  const sinceIso = work.launched_on
    ? addDaysIso(work.launched_on, -DISCOVERY_LOOKBACK_DAYS)
    : addDaysIso(work.to_date ?? today, -HISTORICAL_LOOKBACK_DAYS)
  const sinceUnix = Math.floor(Date.parse(`${sinceIso}T00:00:00Z`) / 1000)

  const cacheKey = `${work.ad_account_id}|${sinceIso}`
  let listing = adListingCache.get(cacheKey)
  if (!listing) {
    listing = listAdsAdaptive(work.ad_account_id, sinceUnix)
    adListingCache.set(cacheKey, listing)
  }
  const ads = await listing

  // Second hop for post-based ads: creatives with no inline spec get their
  // effective spec fetched by id (cached per run alongside the listing).
  const urllessCreativeIds = [...new Set(
    ads
      .filter(ad => destinationUrls(ad).length === 0 && ad.creative?.id)
      .map(ad => ad.creative!.id!),
  )]
  const specCacheKey = `${cacheKey}|specs`
  let specsPromise = effectiveSpecCache.get(specCacheKey)
  if (!specsPromise) {
    specsPromise = fetchEffectiveSpecs(urllessCreativeIds)
    effectiveSpecCache.set(specCacheKey, specsPromise)
  }
  const effectiveSpecs = await specsPromise

  const wanted = normalizeLpUrl(work.lp_url)
  const known = new Set(work.known_ad_ids)
  const matches: Array<{
    lp_tracking_id: string
    ad_id: string
    ad_name: string | null
    campaign_id: string | null
    campaign_name: string | null
    adset_id: string | null
    adset_name: string | null
    destination_url: string
  }> = []

  for (const ad of ads) {
    if (known.has(ad.id)) continue
    const hit = destinationUrls(ad, effectiveSpecs).find(u => normalizeLpUrl(u) === wanted)
    if (!hit) continue
    matches.push({
      lp_tracking_id: work.lp_tracking_id,
      ad_id: ad.id,
      ad_name: ad.name ?? null,
      campaign_id: ad.campaign?.id ?? null,
      campaign_name: ad.campaign?.name ?? null,
      adset_id: ad.adset?.id ?? null,
      adset_name: ad.adset?.name ?? null,
      destination_url: hit,
    })
  }
  return matches
}

// Ads built FROM AN EXISTING POST ("Post ID" creatives) carry no
// object_story_spec — their destination lives in effective_object_story_spec,
// which the v23 /ads listing refuses to expand ("nonexisting field") but the
// creative NODE serves directly. Without this second hop, every post-based ad
// is invisible to URL matching — which is how a $47k page showed zero matched
// ads while Motion saw them plainly (the Sep 23 diagnosis).
async function fetchEffectiveSpecs(creativeIds: string[]): Promise<Map<string, StorySpec>> {
  const out = new Map<string, StorySpec>()
  for (let i = 0; i < creativeIds.length; i += 50) {
    const chunk = creativeIds.slice(i, i + 50)
    try {
      const body = await metaGet<Record<string, { effective_object_story_spec?: StorySpec }>>('', {
        ids: chunk.join(','),
        fields: 'effective_object_story_spec',
      })
      for (const [id, c] of Object.entries(body)) {
        if (c && typeof c === 'object' && c.effective_object_story_spec) {
          out.set(id, c.effective_object_story_spec)
        }
      }
    } catch {
      // Best-effort: a failed chunk just leaves those ads URL-less this run.
    }
    if (Date.now() > runDeadline) break
  }
  return out
}

function specUrls(spec: StorySpec | undefined): string[] {
  if (!spec) return []
  const urls: string[] = []
  if (spec.link_data?.link) urls.push(spec.link_data.link)
  for (const child of spec.link_data?.child_attachments ?? []) {
    if (child.link) urls.push(child.link)
  }
  const ctaLink = spec.video_data?.call_to_action?.value?.link
  if (ctaLink) urls.push(ctaLink)
  return urls
}

// Big accounts (Barstool-scale) reject the ad listing outright with Meta's
// "Please reduce the amount of data" error when the page size is too
// ambitious for the nested creative fields. Start at 50 and halve down —
// smaller pages mean more requests, but a slow listing beats no listing.
async function listAdsAdaptive(accountId: string, sinceUnix: number): Promise<AdListing[]> {
  const params = (limit: number) => ({
    fields: 'id,name,created_time,adset{id,name},campaign{id,name},creative{id,object_story_spec,asset_feed_spec}',
    filtering: [{ field: 'ad.created_time', operator: 'GREATER_THAN', value: sinceUnix }],
    limit,
  })
  let lastErr: unknown
  for (const limit of [50, 25, 10]) {
    try {
      // Partial on deadline: discovery is additive, later runs find the rest.
      return await metaGetAll<AdListing>(`${accountId}/ads`, params(limit), 200, runDeadline, 'return')
    } catch (err) {
      lastErr = err
      const msg = err instanceof MetaApiError ? err.message : String(err)
      if (!/reduce the amount of data|unknown error/i.test(msg)) throw err
    }
  }
  throw lastErr
}

// A page that ran a lot of creative iterations can match hundreds of ads
// (Cookt's weight-loss page: 441). One `ad.id IN [...]` filter that size gets
// rejected by Meta as "Invalid parameter" — the filter is part of the query
// string and there's a hard cap on it — so the id list is CHUNKED and the
// per-day sums merged. 100 ids ≈ 2KB of filter, comfortably under the limit.
const AD_FILTER_CHUNK = 100

// Daily insights for a set of ads, summed per day.
async function adDaily(accountId: string, adIds: string[], since: string, until: string) {
  // Throw on deadline: these rows get SUMMED per day — a partial sum stored
  // as a day's truth is a wrong number, not a late one. A deadline mid-chunk
  // throws before anything is returned, so a half-summed page can't happen.
  const rows: InsightsRow[] = []
  for (let i = 0; i < adIds.length; i += AD_FILTER_CHUNK) {
    rows.push(...await metaGetAll<InsightsRow>(`${accountId}/insights`, {
      level: 'ad',
      filtering: [{ field: 'ad.id', operator: 'IN', value: adIds.slice(i, i + AD_FILTER_CHUNK) }],
      fields: INSIGHTS_FIELDS,
      action_attribution_windows: ATTRIBUTION,
      time_range: { since, until },
      time_increment: 1,
      limit: 500,
    }, 20, runDeadline, 'throw'))
  }

  // Counts start at ZERO, not null: Meta omits zero-value actions from a
  // delivery day's row, so absence on a day we received means 0, not unknown.
  const byDay = new Map<string, {
    spend: number; revenue: number; purchases: number
    impressions: number; link_clicks: number
    initiate_checkouts: number; landing_page_views: number
    ads: Set<string>
  }>()

  for (const r of rows) {
    const d = byDay.get(r.date_start) ?? {
      spend: 0, revenue: 0, purchases: 0,
      impressions: 0, link_clicks: 0, initiate_checkouts: 0, landing_page_views: 0,
      ads: new Set<string>(),
    }
    const spend = Number(r.spend ?? 0)
    d.spend += spend
    d.revenue += actionNumber(r.action_values, 'omni_purchase', 'purchase') ?? 0
    d.purchases += actionNumber(r.actions, 'omni_purchase', 'purchase') ?? 0
    const imp = Number(r.impressions ?? 0)
    d.impressions += imp
    d.link_clicks += actionNumber(r.actions, 'link_click') ?? 0
    d.initiate_checkouts += actionNumber(r.actions, 'omni_initiated_checkout', 'initiate_checkout') ?? 0
    d.landing_page_views += actionNumber(r.actions, 'landing_page_view', 'omni_landing_page_view') ?? 0
    if (imp > 0 || spend > 0) d.ads.add(r.ad_id ?? '')
    byDay.set(r.date_start, d)
  }
  return byDay
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export interface EngineSummary {
  campaigns_pulled: number
  lp_pages_pulled: number
  accounts_pulled: number
  ads_discovered: number
  launch_dates_detected: number
  rows_posted: number
  errors: string[]
  ingest: unknown
}

export async function runResultsPull(filters: { brandId?: string; brand?: string } = {}): Promise<EngineSummary> {
  adListingCache.clear() // per-run, not per-warm-lambda: listings go stale
  effectiveSpecCache.clear()
  const startedAt = Date.now()
  runDeadline = startedAt + HARD_DEADLINE_MS
  const outOfBudget = () => Date.now() - startedAt > TIME_BUDGET_MS
  const secret = ingestSecret()
  const qs = filters.brandId
    ? `?brand_id=${encodeURIComponent(filters.brandId)}`
    : filters.brand
      ? `?brand=${encodeURIComponent(filters.brand)}`
      : ''
  const workRes = await fetch(`${baseUrl()}/api/results/ingest${qs}`, {
    headers: { authorization: `Bearer ${secret}` },
  })
  if (!workRes.ok) throw new Error(`Work list fetch failed: HTTP ${workRes.status}`)
  const work = (await workRes.json()) as WorkList

  const errors: string[] = []
  const payload = {
    reported_at: new Date().toISOString(),
    rows: [] as Array<Record<string, unknown>>,
    paused_campaigns: [] as string[],
    lp_rows: [] as Array<Record<string, unknown>>,
    account_rows: [] as Array<Record<string, unknown>>,
    discovered_ads: [] as Array<Record<string, unknown>>,
    launch_dates: [] as Array<Record<string, unknown>>,
  }

  // ── Campaign / ad-set rows (the classic /results pipeline) ───────────────
  let campaignsPulled = 0
  for (const c of work.campaigns ?? []) {
    const entityId = c.adset_id ?? c.campaign_id
    if (!entityId) continue
    try {
      const rows = await metaGetAll<InsightsRow>(`${entityId}/insights`, {
        fields: INSIGHTS_FIELDS,
        action_attribution_windows: ATTRIBUTION,
        time_range: { since: c.from_date, until: c.to_date },
        time_increment: 1,
        limit: 500,
      })
      for (const r of rows) {
        payload.rows.push({
          ad_account_id: c.ad_account_id,
          campaign_id: c.campaign_id,
          adset_id: c.adset_id,
          campaign_name: c.campaign_name,
          adset_name: c.adset_name,
          stat_date: r.date_start,
          spend: Number(r.spend ?? 0),
          revenue: actionNumber(r.action_values, 'omni_purchase', 'purchase') ?? 0,
          // Zero, not null: Meta omits zero-value actions from delivery days.
          purchases: actionNumber(r.actions, 'omni_purchase', 'purchase') ?? 0,
          landing_page_views: actionNumber(r.actions, 'landing_page_view', 'omni_landing_page_view') ?? 0,
          // As-reported only: the engine derives nothing the account doesn't
          // report. Ratio columns stay null; the UI recomputes from raws.
          incremental_revenue: null,
          roas: null, cpa: null, unique_outbound_ctr: null, lp_conversion_rate: null,
          attribution_window: '7d_click',
        })
      }
      campaignsPulled++
    } catch (err) {
      errors.push(`campaign ${c.campaign_name ?? entityId}: ${err instanceof MetaApiError ? err.message : String(err)}`)
    }
  }

  // ── Whole-account rows (the rest-of-account denominator) ─────────────────
  let accountsPulled = 0
  for (const a of work.accounts ?? []) {
    if (outOfBudget()) {
      errors.push('time budget reached — remaining accounts deferred to the next run')
      break
    }
    try {
      const rows = await metaGetAll<InsightsRow>(`${a.ad_account_id}/insights`, {
        fields: INSIGHTS_FIELDS,
        action_attribution_windows: ATTRIBUTION,
        time_range: { since: a.from_date, until: a.to_date },
        time_increment: 1,
        limit: 500,
      })
      for (const r of rows) {
        payload.account_rows.push({
          ad_account_id: a.ad_account_id,
          stat_date: r.date_start,
          spend: Number(r.spend ?? 0),
          revenue: actionNumber(r.action_values, 'omni_purchase', 'purchase') ?? 0,
          // Zero, not null: Meta omits zero-value actions from delivery days.
          purchases: actionNumber(r.actions, 'omni_purchase', 'purchase') ?? 0,
          impressions: Number(r.impressions ?? 0),
          link_clicks: actionNumber(r.actions, 'link_click') ?? 0,
          initiate_checkouts: actionNumber(r.actions, 'omni_initiated_checkout', 'initiate_checkout') ?? 0,
          landing_page_views: actionNumber(r.actions, 'landing_page_view', 'omni_landing_page_view') ?? 0,
        })
      }
      accountsPulled++
    } catch (err) {
      errors.push(`account ${a.ad_account_id}: ${err instanceof MetaApiError ? err.message : String(err)}`)
    }
  }

  // ── LP pages: discovery → launch detection → daily rows ──────────────────
  let lpPulled = 0
  let launchDetected = 0
  // Queue strategy: GROUP by ad account, then shuffle the group order.
  // The expensive step is the account's ad listing; grouped, one listing
  // (cached for the run) serves every page of that brand in the same pass —
  // twenty PixieLane pages cost one listing plus twenty cheap insight reads.
  // Shuffling the groups keeps a heavy or rate-limited account from starving
  // the rest on every pass.
  const groups = new Map<string, LpWork[]>()
  for (const page of work.lp_pages ?? []) {
    groups.set(page.ad_account_id, [...(groups.get(page.ad_account_id) ?? []), page])
  }
  // Productive work first: groups that already have matched ads yield daily
  // rows cheaply; discovery-only groups (which may never match anything) go
  // last so they can't starve real pulls. Random within each tier.
  const hasWork = (pages: LpWork[]) => pages.some(pg => pg.included_ad_ids.length > 0)
  const lpQueue = [...groups.values()]
    .sort((a, b) => (Number(hasWork(b)) - Number(hasWork(a))) || Math.random() - 0.5)
    .flat()
  for (const p of lpQueue) {
    if (outOfBudget()) {
      errors.push(`time budget reached — ${(work.lp_pages?.length ?? 0) - lpPulled} LP page(s) deferred to the next run`)
      break
    }
    try {
      const discovered = await discoverAds(p)
      payload.discovered_ads.push(...discovered)

      const allIds = [...new Set([...p.included_ad_ids, ...discovered.map(d => d.ad_id)])]
      if (allIds.length === 0) continue

      let since = p.from_date
      let until = p.to_date
      if (p.needs_launch_date || !since || !until) {
        // Launch unknown = possibly historical: the detection window must be
        // as wide as discovery's, or an old page's delivery is invisible and
        // the launch date never resolves.
        since = addDaysIso(work.through, -HISTORICAL_LOOKBACK_DAYS)
        until = work.through
      }

      const byDay = await adDaily(p.ad_account_id, allIds, since, until)

      let launch = p.launched_on
      if (!launch) {
        launch = [...byDay.entries()]
          .filter(([, d]) => (d.impressions ?? 0) > 0 || d.spend > 0)
          .map(([day]) => day)
          .sort()[0] ?? null
        if (launch) {
          payload.launch_dates.push({ lp_tracking_id: p.lp_tracking_id, launched_on: launch })
          launchDetected++
        }
      }
      if (!launch) continue // no delivery at all yet — nothing to report

      for (const [day, d] of [...byDay.entries()].sort()) {
        if (day < launch) continue
        payload.lp_rows.push({
          lp_tracking_id: p.lp_tracking_id,
          stat_date: day,
          spend: Math.round(d.spend * 100) / 100,
          revenue: Math.round(d.revenue * 100) / 100,
          purchases: d.purchases,
          impressions: d.impressions,
          link_clicks: d.link_clicks,
          initiate_checkouts: d.initiate_checkouts,
          landing_page_views: d.landing_page_views,
          matched_ad_count: d.ads.size,
        })
      }
      lpPulled++
    } catch (err) {
      if (err instanceof MetaDeadlineError) {
        errors.push(`lp ${p.project_name ?? p.lp_tracking_id}: deferred at the run deadline`)
      } else {
        errors.push(`lp ${p.project_name ?? p.lp_tracking_id}: ${err instanceof MetaApiError ? err.message : String(err)}`)
      }
    }
  }

  // ── POST it all back through the validated path ──────────────────────────
  const total = payload.rows.length + payload.lp_rows.length +
    payload.account_rows.length + payload.discovered_ads.length + payload.launch_dates.length
  let ingest: unknown = { skipped: 'nothing to ingest' }
  if (total > 0) {
    const postRes = await fetch(`${baseUrl()}/api/results/ingest`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    ingest = await postRes.json().catch(() => ({ error: `HTTP ${postRes.status}` }))
    if (!postRes.ok) errors.push(`ingest POST: HTTP ${postRes.status}`)
  }

  return {
    campaigns_pulled: campaignsPulled,
    lp_pages_pulled: lpPulled,
    accounts_pulled: accountsPulled,
    ads_discovered: payload.discovered_ads.length,
    launch_dates_detected: launchDetected,
    rows_posted: total,
    errors,
    ingest,
  }
}
