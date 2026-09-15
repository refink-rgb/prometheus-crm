// Validation for incoming campaign result rows. Pure and testable — no DB
// access, no network, no `new Date()`. The endpoint reads the tracked campaigns
// and passes them in; this file decides only what is acceptable.
//
// WHY THIS EXISTS: the ingestion path is an LLM (a scheduled Claude agent
// driving the Meta MCP). That is a deliberate tradeoff — it reuses access we
// already have — but it means bad data arrives PLAUSIBLY FORMATTED. A wrong
// number from a spreadsheet import looks wrong; a wrong number from a language
// model looks exactly like a right one.
//
// The posture mirrors findUnverifiedNumbers() in src/lib/ai/approval-message.ts:
// REPORT TO A HUMAN, don't silently block and don't silently accept.
//
// Two outcomes, and the difference matters:
//
//   REJECT — the row is not about a campaign we track, or claims a date that
//     cannot exist. There is nowhere to put it. Rejections are returned to the
//     agent AND written to campaign_result_ingests.
//
//   WARN — the row is storable but its own arithmetic disagrees with itself
//     (the reported ROAS isn't revenue/spend), or a value is implausible.
//     The row is STORED WITH THE WARNING and badged in the UI.
//
// Warn-don't-drop is the important half. A dropped row and a day the campaign
// didn't run render identically — as a gap. Storing the row with a visible
// warning is the only version where a human can tell those apart.
//
// NO IMPORTS, deliberately — scripts/verify-results.ts runs this file under
// bare `node --experimental-strip-types`, where the `@/` path alias does not
// resolve. Same constraint that keeps src/lib/results.ts dependency-free.

// ---------------------------------------------------------------------------
// Wire shape
// ---------------------------------------------------------------------------

// What the agent POSTs, before any coercion. Everything is `unknown` because
// this is the untrusted boundary — the agent is a language model, and the
// shape it sends is a hope, not a guarantee.
export interface RawResultRow {
  ad_account_id?: unknown
  campaign_id?: unknown
  // Present only for ad-set-level tracking. When the tracked row names an ad
  // set, the agent MUST send this or the row won't match — see campaignKey.
  adset_id?: unknown
  // Optional CONTEXT the agent may echo from Meta. Never used for matching —
  // backfilled onto the tracked row so the UI can say "ad set in <campaign>"
  // without a human having typed it. See backfillContext in the ingest route.
  campaign_name?: unknown
  adset_name?: unknown
  stat_date?: unknown
  spend?: unknown
  revenue?: unknown
  incremental_revenue?: unknown
  purchases?: unknown
  landing_page_views?: unknown
  roas?: unknown
  cpa?: unknown
  unique_outbound_ctr?: unknown
  lp_conversion_rate?: unknown
  attribution_window?: unknown
}

// The validated, storable row. Money already in integer cents; percentages
// already in PERCENT units (2.45 = 2.45%).
export interface ValidatedRow {
  tracked_campaign_id: string
  stat_date: string
  spend_cents: number
  revenue_cents: number
  incremental_revenue_cents: number | null
  cpa_cents: number | null
  purchases: number
  landing_page_views: number | null
  roas: number | null
  unique_outbound_ctr: number | null
  lp_conversion_rate: number | null
  attribution_window: string
  warnings: string[]
}

export interface RejectedRow {
  // Echoed back so the agent's run output names the row it got wrong.
  ad_account_id: string | null
  campaign_id: string | null
  adset_id?: string | null
  stat_date: string | null
  reason: string
}

export interface ValidationResult {
  valid: ValidatedRow[]
  rejected: RejectedRow[]
}

// The subset of a tracked_campaigns row validation needs.
// `meta_adset_id: null` = the whole campaign is tracked.
export interface CampaignRef {
  id: string
  meta_ad_account_id: string
  // IDENTITY when meta_adset_id is null; CONTEXT (nullable, agent-backfilled)
  // when it isn't.
  meta_campaign_id: string | null
  // IDENTITY for ad-set tracking.
  meta_adset_id: string | null
  launched_on: string
  ended_on: string | null
}

// ---------------------------------------------------------------------------
// Tolerances
// ---------------------------------------------------------------------------

// Meta rounds its own reported ratios, and cents-level rounding on our side
// adds a little more. 2% relative tolerance clears both without letting a
// genuinely invented number through — a fabricated ROAS is off by tens of
// percent, not by two.
export const RATIO_TOLERANCE = 0.02

// Above this, a ROAS is far more likely to be a units error (a fraction sent
// as a percent, revenue in cents sent as dollars) than a real result.
export const IMPLAUSIBLE_ROAS = 100

// A rate stored as PERCENT can legitimately reach 100. Past that, the sender
// almost certainly passed a fraction through a ×100 twice.
export const MAX_PERCENT = 100

// ---------------------------------------------------------------------------
// Coercion
// ---------------------------------------------------------------------------

// Numbers only. A numeric STRING is accepted (JSON from an LLM routinely
// quotes numbers) but anything else — including the strings 'null', 'N/A',
// 'unknown' — becomes null rather than 0. Turning "I don't know" into a zero
// is the single most dangerous coercion in a metrics pipeline.
export function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const cleaned = v.replace(/[$,%\s]/g, '')
    if (!cleaned || !/^-?\d*\.?\d+$/.test(cleaned)) return null
    const n = Number(cleaned)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function toInt(v: unknown): number | null {
  const n = toNumber(v)
  return n === null ? null : Math.round(n)
}

// Meta reports money as a decimal ('1234.56' or 1234.56). Everything downstream
// stores INTEGER CENTS, so this is where the conversion happens — once, at the
// boundary, rather than scattered through the route.
export function dollarsToCents(dollars: number | string | null | undefined): number | null {
  if (dollars === null || dollars === undefined || dollars === '') return null
  const n = typeof dollars === 'number' ? dollars : Number(String(dollars).replace(/[$,\s]/g, ''))
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100)
}

function toTrimmedString(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !ISO_DATE.test(v)) return false
  // Reject 2026-02-31 and friends: round-tripping through Date catches every
  // impossible calendar day without a month-length table here.
  const parsed = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === v
}

// Windows we recognize. An unrecognized one is stored (so the change is
// VISIBLE as a labelled step in the chart) but flagged, because a silent
// window switch looks like performance.
//
// Both orderings are listed on purpose. Meta's `attribution_setting` field
// reports `1d_view_7d_click`; parts of its own tooling write the same window
// as `7d_click_1d_view`. Recognizing only one spelling meant every row from a
// default-configured account got flagged, which would have made the warning
// badge meaningless on the first day it shipped.
const KNOWN_WINDOWS = new Set([
  '1d_click', '7d_click', '28d_click',
  '1d_view', '7d_view',
  '1d_click_1d_view', '1d_view_1d_click',
  '7d_click_1d_view', '1d_view_7d_click',
  '28d_click_1d_view', '1d_view_28d_click',
])

export const DEFAULT_ATTRIBUTION_WINDOW = '7d_click'

// What we consider "the window we asked for". Meta's out-of-the-box setting is
// 1-day view + 7-day click, and that is what these accounts actually run, so
// treating it as a deviation would cry wolf on every row. Anything outside
// this set is still flagged — a 28-day click window really would look like
// performance appearing out of nowhere.
const EXPECTED_WINDOWS = new Set([
  '7d_click', '7d_click_1d_view', '1d_view_7d_click',
])

// ---------------------------------------------------------------------------
// Cross-checks
// ---------------------------------------------------------------------------

// True when `actual` is within RATIO_TOLERANCE (relative) of `expected`.
// Relative, not absolute: a 0.02 gap on a ROAS of 1.0 is noise; the same gap
// on a CTR of 0.05 is a 40% error.
export function withinTolerance(actual: number, expected: number, tolerance = RATIO_TOLERANCE): boolean {
  if (expected === 0) return Math.abs(actual) <= tolerance
  return Math.abs(actual - expected) / Math.abs(expected) <= tolerance
}

// ---------------------------------------------------------------------------
// Row validation
// ---------------------------------------------------------------------------

export function validateRows(
  rows: readonly RawResultRow[],
  campaigns: readonly CampaignRef[],
  todayIso: string,
): ValidationResult {
  // (ad_account_id, identity_id) → tracked row, where identity is the ad set
  // id if there is one and the campaign id otherwise. Same key the DB's unique
  // index uses, so what matches here is what can be stored.
  const byMetaIds = new Map<string, CampaignRef>()
  // Ad sets tracked under each campaign. CONTEXT ONLY — used to write a better
  // rejection when the agent sends campaign-level rows for a campaign that is
  // actually tracked per ad set. Empty until the agent backfills campaign_id
  // on those rows, at which point the message gets more specific.
  const adsetsByCampaign = new Map<string, string[]>()
  for (const c of campaigns) {
    const identity = identityOf(c)
    if (!identity) continue   // guarded by tracked_campaign_has_an_identity
    byMetaIds.set(campaignKey(c.meta_ad_account_id, identity), c)
    if (c.meta_adset_id && c.meta_campaign_id) {
      const k = campaignKey(c.meta_ad_account_id, c.meta_campaign_id)
      adsetsByCampaign.set(k, [...(adsetsByCampaign.get(k) ?? []), c.meta_adset_id])
    }
  }

  const valid: ValidatedRow[] = []
  const rejected: RejectedRow[] = []
  // Later rows win on a within-payload duplicate, but the collision is
  // reported — an agent sending the same day twice in one POST is confused
  // about something, and the upsert would otherwise hide it.
  const seen = new Map<string, number>()

  for (const raw of rows) {
    const accountId = toTrimmedString(raw.ad_account_id)
    const campaignId = toTrimmedString(raw.campaign_id)
    const adsetId = toTrimmedString(raw.adset_id)
    const statDate = toTrimmedString(raw.stat_date)

    const echo = {
      ad_account_id: accountId,
      campaign_id: campaignId,
      adset_id: adsetId,
      stat_date: statDate,
    }

    if (!accountId || (!campaignId && !adsetId)) {
      rejected.push({ ...echo, reason: 'Missing ad_account_id, and either campaign_id or adset_id.' })
      continue
    }

    // THE MANUAL LINK IS THE CONTRACT. An unknown entity is rejected, never
    // auto-created: ingestion inventing rows in tracked_campaigns would mean
    // the Results tab quietly grows campaigns nobody chose to watch.
    //
    // Matched on the ad set id when the row carries one — that is the identity
    // — and on the campaign id otherwise. A row carrying an adset_id is NEVER
    // matched against a whole-campaign tracking row, because those are
    // different scopes and quietly conflating them is the whole bug this
    // guards against.
    const identity = adsetId ?? (campaignId as string)
    const campaign = byMetaIds.get(campaignKey(accountId, identity))
    if (!campaign) {
      // The likeliest real mistake: the campaign IS tracked, but per ad set,
      // and the agent sent campaign-level totals. Silently accepting those
      // would write the parent campaign's numbers — every other moment in the
      // bucket included — into one moment's history. Name the fix instead.
      const trackedAdsets = campaignId ? adsetsByCampaign.get(campaignKey(accountId, campaignId)) : undefined
      if (!adsetId && trackedAdsets && trackedAdsets.length > 0) {
        rejected.push({
          ...echo,
          reason:
            `Campaign ${campaignId} is tracked per AD SET (${trackedAdsets.join(', ')}), not as a whole. ` +
            'Send adset_id on each row and pull the breakdown at ad-set level.',
        })
        continue
      }
      rejected.push({
        ...echo,
        reason: adsetId
          ? `No tracked ad set for ${accountId} / ${campaignId} / ${adsetId}. Link it on the project first.`
          : `No tracked campaign for ${accountId} / ${campaignId}. Link it on the project first.`,
      })
      continue
    }

    if (!isIsoDate(statDate)) {
      rejected.push({ ...echo, reason: `stat_date must be YYYY-MM-DD, got ${JSON.stringify(raw.stat_date)}.` })
      continue
    }

    if (statDate < campaign.launched_on) {
      rejected.push({ ...echo, reason: `stat_date ${statDate} precedes launch ${campaign.launched_on}.` })
      continue
    }
    // Strictly future days cannot have happened. Today itself is allowed but
    // warned below — a partial day of data plotted next to full days reads as
    // a crash.
    if (statDate > todayIso) {
      rejected.push({ ...echo, reason: `stat_date ${statDate} is in the future (today is ${todayIso}).` })
      continue
    }
    // Tracking ended: no new days after the end date. History is untouched.
    if (campaign.ended_on && statDate > campaign.ended_on) {
      rejected.push({ ...echo, reason: `stat_date ${statDate} is after tracking ended ${campaign.ended_on}.` })
      continue
    }

    const spendCents = dollarsToCents(toNumber(raw.spend))
    const revenueCents = dollarsToCents(toNumber(raw.revenue))

    // Spend and revenue are the two columns everything else derives from. A
    // row without them isn't a thin row, it's not a row.
    if (spendCents === null || revenueCents === null) {
      rejected.push({ ...echo, reason: 'spend and revenue are required and must be numeric.' })
      continue
    }
    // Negative spend is a refund artifact or a parse error, never a day of
    // advertising. Rejected rather than warned: it would poison every
    // cumulative total downstream of it.
    if (spendCents < 0 || revenueCents < 0) {
      rejected.push({ ...echo, reason: 'spend and revenue must not be negative.' })
      continue
    }

    const warnings: string[] = []

    const rawPurchases = toInt(raw.purchases)
    const purchases = Math.max(0, rawPurchases ?? 0)
    if (rawPurchases === null) {
      warnings.push('purchases missing — stored as 0')
    } else if (rawPurchases < 0) {
      warnings.push('purchases was negative — stored as 0')
    }

    const lpViews = nonNegativeOrNull(toInt(raw.landing_page_views), 'landing_page_views', warnings)

    // Read AS REPORTED. Never derived, never estimated. Null when the account
    // has no such column — the UI renders '—'.
    const incrementalCents = dollarsToCents(toNumber(raw.incremental_revenue))
    if (incrementalCents !== null && incrementalCents < 0) {
      warnings.push('incremental_revenue was negative — stored as reported')
    }
    if (incrementalCents !== null && incrementalCents > revenueCents) {
      // Incremental revenue is a SUBSET of total revenue. Exceeding it means
      // the two came from different columns or different windows.
      warnings.push('incremental revenue exceeds total revenue')
    }

    const roas = toNumber(raw.roas)
    const cpaCents = dollarsToCents(toNumber(raw.cpa))
    const ctr = toNumber(raw.unique_outbound_ctr)
    const lpConv = toNumber(raw.lp_conversion_rate)

    // ── Arithmetic cross-checks ───────────────────────────────────────────
    // The row is checked against ITSELF. These catch a plausible-looking
    // number that doesn't follow from the numbers beside it — which is
    // precisely the failure mode of a generative ingestion path.

    if (roas !== null && spendCents > 0) {
      const expected = revenueCents / spendCents
      if (!withinTolerance(roas, expected)) {
        warnings.push(`ROAS ${roas} disagrees with revenue/spend (${expected.toFixed(2)})`)
      }
    }
    if (roas !== null && roas < 0) warnings.push('ROAS is negative')
    if (roas !== null && roas > IMPLAUSIBLE_ROAS) {
      warnings.push(`ROAS ${roas} is implausibly high (> ${IMPLAUSIBLE_ROAS}) — check units`)
    }

    if (cpaCents !== null && purchases > 0) {
      const expected = spendCents / purchases
      if (!withinTolerance(cpaCents, expected)) {
        warnings.push(`CPA disagrees with spend/purchases (expected ${(expected / 100).toFixed(2)})`)
      }
    }
    // A CPA on a day with no purchases has no denominator. Whatever it is, it
    // isn't cost per acquisition.
    if (cpaCents !== null && purchases === 0) {
      warnings.push('CPA reported on a day with 0 purchases')
    }

    if (lpConv !== null && lpViews !== null && lpViews > 0) {
      const expected = (purchases / lpViews) * 100
      if (!withinTolerance(lpConv, expected)) {
        warnings.push(`LP conversion ${lpConv}% disagrees with purchases/LP views (${expected.toFixed(2)}%)`)
      }
    }

    // Percentages are stored as PERCENT. A value over 100 means someone
    // multiplied a fraction by 100 twice, or divided by the wrong denominator.
    if (ctr !== null && (ctr < 0 || ctr > MAX_PERCENT)) {
      warnings.push(`unique_outbound_ctr ${ctr} is outside 0–${MAX_PERCENT}% — check units`)
    }
    if (lpConv !== null && (lpConv < 0 || lpConv > MAX_PERCENT)) {
      warnings.push(`lp_conversion_rate ${lpConv} is outside 0–${MAX_PERCENT}% — check units`)
    }

    // Revenue without a purchase to attribute it to. Legal under view-through
    // attribution lag, but worth a human's eye.
    if (revenueCents > 0 && purchases === 0) {
      warnings.push('revenue reported with 0 purchases')
    }

    // Today is still accruing. Plotted beside complete days it reads as a
    // collapse; the agent is told to stop at yesterday.
    if (statDate === todayIso) {
      warnings.push('partial day — today is still accruing')
    }

    const window = toTrimmedString(raw.attribution_window) ?? DEFAULT_ATTRIBUTION_WINDOW
    if (!KNOWN_WINDOWS.has(window)) {
      warnings.push(`unrecognized attribution window '${window}'`)
    } else if (!EXPECTED_WINDOWS.has(window)) {
      // Stored, not rejected — but a window change must never be invisible.
      warnings.push(`attribution window is '${window}', not the expected 7-day click`)
    }

    const row: ValidatedRow = {
      tracked_campaign_id: campaign.id,
      stat_date: statDate,
      spend_cents: spendCents,
      revenue_cents: revenueCents,
      incremental_revenue_cents: incrementalCents,
      cpa_cents: cpaCents,
      purchases,
      landing_page_views: lpViews,
      roas,
      unique_outbound_ctr: ctr,
      lp_conversion_rate: lpConv,
      attribution_window: window,
      warnings,
    }

    const dedupeKey = `${campaign.id}|${statDate}`
    const existingIndex = seen.get(dedupeKey)
    if (existingIndex !== undefined) {
      row.warnings.push('duplicate row for this date in the same payload — last one kept')
      valid[existingIndex] = row
    } else {
      seen.set(dedupeKey, valid.length)
      valid.push(row)
    }
  }

  return { valid, rejected }
}

function nonNegativeOrNull(n: number | null, label: string, warnings: string[]): number | null {
  if (n === null) return null
  if (n < 0) {
    warnings.push(`${label} was negative — stored as null`)
    return null
  }
  return n
}

// The identity of a tracked thing: an ad account plus THE ONE ID that
// identifies it — the ad set id when there is one, the campaign id otherwise.
// Mirrors the DB's COALESCE(meta_adset_id, meta_campaign_id) unique index, so
// what matches here is exactly what can be stored.
//
// Meta object IDs are globally unique, so an ad set id needs no campaign id
// beside it to be unambiguous. Deliberately NOT keyed on both: campaign_id on
// an ad-set row is CONTEXT that the agent backfills, and an identity that
// changes when context arrives is not an identity.
//
// Campaign-level and ad-set-level rows can never collide, because a campaign
// id and an ad set id are different values from the same global namespace. So
// an agent that forgets to send adset_id gets a clean rejection rather than
// silently writing the parent campaign's numbers — every sibling moment
// included — into one ad set's history.
export function campaignKey(accountId: string, entityId: string): string {
  return `${accountId.trim()}|${entityId.trim()}`
}

// The identity id for a tracked row: ad set if present, else campaign.
export function identityOf(c: Pick<CampaignRef, 'meta_adset_id' | 'meta_campaign_id'>): string | null {
  return c.meta_adset_id ?? c.meta_campaign_id
}

// ---------------------------------------------------------------------------
// Payload envelope
// ---------------------------------------------------------------------------

export interface IngestPayload {
  reported_at: string
  rows: RawResultRow[]
  // tracked_campaign_id values the agent found PAUSED (not just quiet for a
  // day) at Meta. The route sets ended_on for these so the next GET work-list
  // stops asking the agent to pull them — a paused campaign never resumes on
  // its own in this pipeline, so re-checking it every run is pure waste.
  paused_campaigns: string[]
  // LP-scoped sections (see 20260915_add_lp_results.sql). All optional so the
  // pre-existing campaign-only agent flow keeps working unchanged.
  lp_rows: RawLpRow[]
  account_rows: RawAccountRow[]
  discovered_ads: RawDiscoveredAd[]
}

// Validates the envelope only — row-level checks are validateRows(). Returns
// an error string rather than throwing so the route can answer 400 with
// something the agent can act on.
export function parsePayload(body: unknown): { payload: IngestPayload } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Body must be a JSON object.' }
  const b = body as Record<string, unknown>

  const pausedCampaigns = Array.isArray(b.paused_campaigns)
    ? b.paused_campaigns.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
    : []

  if (!Array.isArray(b.rows)) return { error: 'Body must include a `rows` array.' }

  // LP-scoped sections, all optional (absent = empty). Typed as raw-row arrays
  // at the boundary the same way `rows` is: every field inside is `unknown`
  // until its validator coerces it.
  const lpRows = Array.isArray(b.lp_rows) ? (b.lp_rows as RawLpRow[]) : []
  const accountRows = Array.isArray(b.account_rows) ? (b.account_rows as RawAccountRow[]) : []
  const discoveredAds = Array.isArray(b.discovered_ads) ? (b.discovered_ads as RawDiscoveredAd[]) : []

  // The payload must carry SOMETHING — otherwise it's a no-op mistake worth
  // telling the agent about rather than logging as a successful empty run.
  if (
    b.rows.length === 0 && pausedCampaigns.length === 0 &&
    lpRows.length === 0 && accountRows.length === 0 && discoveredAds.length === 0
  ) {
    return { error: 'Every section is empty — nothing to ingest.' }
  }
  // A cap so a runaway agent loop can't try to write a million rows in one
  // request. ~50 campaigns × 90 days of backfill fits comfortably.
  if (b.rows.length > 5000) return { error: '`rows` exceeds the 5000-row limit for a single request.' }
  if (lpRows.length > 5000) return { error: '`lp_rows` exceeds the 5000-row limit for a single request.' }
  if (accountRows.length > 5000) return { error: '`account_rows` exceeds the 5000-row limit for a single request.' }
  if (discoveredAds.length > 2000) return { error: '`discovered_ads` exceeds the 2000-row limit for a single request.' }

  // Absent or unparseable reported_at falls back to the server's clock. The
  // freshness stamp depends on this being real, so a bad value must not be
  // stored as-is.
  const reportedAt = typeof b.reported_at === 'string' && !Number.isNaN(Date.parse(b.reported_at))
    ? new Date(b.reported_at).toISOString()
    : new Date().toISOString()

  return {
    payload: {
      reported_at: reportedAt,
      rows: b.rows as RawResultRow[],
      paused_campaigns: pausedCampaigns,
      lp_rows: lpRows,
      account_rows: accountRows,
      discovered_ads: discoveredAds,
    },
  }
}

// ---------------------------------------------------------------------------
// LP-scoped results (the per-project Results tab — see 20260915_add_lp_results.sql)
// ---------------------------------------------------------------------------

// Duplicated from src/lib/results.ts on purpose — this file is import-free so
// scripts/verify-results.ts can run it under bare node (same reason billing.ts
// has its own daysBetweenIso). Keep the two implementations identical.
export function normalizeLpUrl(raw: string): string {
  let s = raw.trim().toLowerCase()
  s = s.replace(/^https?:\/\//, '')
  s = s.replace(/^www\./, '')
  const cut = s.search(/[?#]/)
  if (cut !== -1) s = s.slice(0, cut)
  while (s.endsWith('/')) s = s.slice(0, -1)
  return s
}

// The subset of an lp_tracking row validation needs.
export interface LpTrackingRef {
  id: string
  meta_ad_account_id: string
  lp_url: string
  launched_on: string
  ended_on: string | null
}

// What the agent POSTs for one LP per day — aggregated over the included ads
// the work list gave it. Identified by lp_tracking_id, which the work list
// carries: the server assigned the work, so the server's id is the identity
// (no meta-id matching dance like campaign rows need).
export interface RawLpRow {
  lp_tracking_id?: unknown
  stat_date?: unknown
  spend?: unknown
  revenue?: unknown
  purchases?: unknown
  impressions?: unknown
  link_clicks?: unknown
  initiate_checkouts?: unknown
  landing_page_views?: unknown
  matched_ad_count?: unknown
  attribution_window?: unknown
}

export interface ValidatedLpRow {
  lp_tracking_id: string
  stat_date: string
  spend_cents: number
  revenue_cents: number
  purchases: number
  impressions: number | null
  link_clicks: number | null
  initiate_checkouts: number | null
  landing_page_views: number | null
  matched_ad_count: number | null
  attribution_window: string
  warnings: string[]
}

// Whole-account totals per day — the "rest of account" denominator.
export interface RawAccountRow {
  ad_account_id?: unknown
  stat_date?: unknown
  spend?: unknown
  revenue?: unknown
  purchases?: unknown
  impressions?: unknown
  link_clicks?: unknown
  initiate_checkouts?: unknown
  landing_page_views?: unknown
  attribution_window?: unknown
}

export interface ValidatedAccountRow {
  meta_ad_account_id: string
  brand_id: string
  stat_date: string
  spend_cents: number
  revenue_cents: number
  purchases: number
  impressions: number | null
  link_clicks: number | null
  initiate_checkouts: number | null
  landing_page_views: number | null
  attribution_window: string
  warnings: string[]
}

// An account the work list asked for, with the earliest date it may report.
export interface AccountRef {
  meta_ad_account_id: string
  brand_id: string
  earliest: string
}

// An ad the agent proposes as pointing at a tracked LP. The server is the
// referee: destination_url must NORMALIZE EQUAL to the tracking's lp_url or
// the proposal is rejected — an LLM's "close enough" is exactly what this
// check exists to catch.
export interface RawDiscoveredAd {
  lp_tracking_id?: unknown
  ad_id?: unknown
  ad_name?: unknown
  campaign_id?: unknown
  campaign_name?: unknown
  adset_id?: unknown
  adset_name?: unknown
  destination_url?: unknown
}

export interface AcceptedAdMatch {
  lp_tracking_id: string
  meta_ad_id: string
  ad_name: string | null
  meta_campaign_id: string | null
  campaign_name: string | null
  meta_adset_id: string | null
  adset_name: string | null
  destination_url: string
}

export interface RejectedAd {
  lp_tracking_id: string | null
  ad_id: string | null
  reason: string
}

function trimmed(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t
}

// Shared funnel-count coercion + cross-checks for LP and account rows. The
// checks are soft (warn, don't drop) except the two hard ones every pipeline
// row already has: spend/revenue present and non-negative, date sane.
function coerceFunnelCounts(
  raw: { purchases?: unknown; impressions?: unknown; link_clicks?: unknown; initiate_checkouts?: unknown; landing_page_views?: unknown },
  warnings: string[],
): {
  purchases: number
  impressions: number | null
  link_clicks: number | null
  initiate_checkouts: number | null
  landing_page_views: number | null
} {
  const rawPurchases = toInt(raw.purchases)
  const purchases = Math.max(0, rawPurchases ?? 0)
  if (rawPurchases === null) warnings.push('purchases missing — stored as 0')
  else if (rawPurchases < 0) warnings.push('purchases was negative — stored as 0')

  const impressions = nonNegativeOrNull(toInt(raw.impressions), 'impressions', warnings)
  const linkClicks = nonNegativeOrNull(toInt(raw.link_clicks), 'link_clicks', warnings)
  const checkouts = nonNegativeOrNull(toInt(raw.initiate_checkouts), 'initiate_checkouts', warnings)
  const lpViews = nonNegativeOrNull(toInt(raw.landing_page_views), 'landing_page_views', warnings)

  // Funnel-shape checks. Soft: attribution windows make each step's count a
  // different population, so a small inversion can be legitimate — but a large
  // one is a units or column mix-up and a human should look.
  if (impressions !== null && linkClicks !== null && linkClicks > impressions) {
    warnings.push(`link_clicks (${linkClicks}) exceeds impressions (${impressions})`)
  }
  if (linkClicks !== null && checkouts !== null && checkouts > linkClicks) {
    warnings.push(`initiate_checkouts (${checkouts}) exceeds link_clicks (${linkClicks})`)
  }
  if (checkouts !== null && purchases > checkouts) {
    warnings.push(`purchases (${purchases}) exceed initiate_checkouts (${checkouts})`)
  }

  return { purchases, impressions, link_clicks: linkClicks, initiate_checkouts: checkouts, landing_page_views: lpViews }
}

function checkWindow(raw: unknown, warnings: string[]): string {
  const window = trimmed(raw) ?? DEFAULT_ATTRIBUTION_WINDOW
  if (!KNOWN_WINDOWS.has(window)) {
    warnings.push(`unrecognized attribution window '${window}'`)
  } else if (!EXPECTED_WINDOWS.has(window)) {
    warnings.push(`attribution window is '${window}', not the expected 7-day click`)
  }
  return window
}

export function validateLpRows(
  rows: readonly RawLpRow[],
  trackings: readonly LpTrackingRef[],
  todayIso: string,
): { valid: ValidatedLpRow[]; rejected: RejectedRow[] } {
  const byId = new Map(trackings.map(t => [t.id, t]))
  const valid: ValidatedLpRow[] = []
  const rejected: RejectedRow[] = []
  const seen = new Map<string, number>()

  for (const raw of rows) {
    const trackingId = trimmed(raw.lp_tracking_id)
    const statDate = trimmed(raw.stat_date)
    // RejectedRow is reused for the run report; campaign_id carries the
    // tracking id so the echo names the row that failed.
    const echo = { ad_account_id: null, campaign_id: trackingId, stat_date: statDate }

    if (!trackingId) {
      rejected.push({ ...echo, reason: 'Missing lp_tracking_id.' })
      continue
    }
    const tracking = byId.get(trackingId)
    if (!tracking) {
      rejected.push({ ...echo, reason: `No lp_tracking row with id ${trackingId}. Use the ids from the work list.` })
      continue
    }
    if (!isIsoDate(statDate)) {
      rejected.push({ ...echo, reason: `stat_date must be YYYY-MM-DD, got ${JSON.stringify(raw.stat_date)}.` })
      continue
    }
    if (statDate < tracking.launched_on) {
      rejected.push({ ...echo, reason: `stat_date ${statDate} precedes launch ${tracking.launched_on}.` })
      continue
    }
    if (statDate > todayIso) {
      rejected.push({ ...echo, reason: `stat_date ${statDate} is in the future (today is ${todayIso}).` })
      continue
    }
    if (tracking.ended_on && statDate > tracking.ended_on) {
      rejected.push({ ...echo, reason: `stat_date ${statDate} is after tracking ended ${tracking.ended_on}.` })
      continue
    }

    const spendCents = dollarsToCents(toNumber(raw.spend))
    const revenueCents = dollarsToCents(toNumber(raw.revenue))
    if (spendCents === null || revenueCents === null) {
      rejected.push({ ...echo, reason: 'spend and revenue are required and must be numeric.' })
      continue
    }
    if (spendCents < 0 || revenueCents < 0) {
      rejected.push({ ...echo, reason: 'spend and revenue must not be negative.' })
      continue
    }

    const warnings: string[] = []
    const counts = coerceFunnelCounts(raw, warnings)
    const matchedAdCount = nonNegativeOrNull(toInt(raw.matched_ad_count), 'matched_ad_count', warnings)

    if (revenueCents > 0 && counts.purchases === 0) {
      warnings.push('revenue reported with 0 purchases')
    }
    if (statDate === todayIso) {
      warnings.push('partial day — today is still accruing')
    }
    const window = checkWindow(raw.attribution_window, warnings)

    const row: ValidatedLpRow = {
      lp_tracking_id: trackingId,
      stat_date: statDate,
      spend_cents: spendCents,
      revenue_cents: revenueCents,
      ...counts,
      matched_ad_count: matchedAdCount,
      attribution_window: window,
      warnings,
    }

    const key = `${trackingId}|${statDate}`
    const existing = seen.get(key)
    if (existing !== undefined) {
      row.warnings.push('duplicate row for this date in the same payload — last one kept')
      valid[existing] = row
    } else {
      seen.set(key, valid.length)
      valid.push(row)
    }
  }

  return { valid, rejected }
}

export function validateAccountRows(
  rows: readonly RawAccountRow[],
  accounts: readonly AccountRef[],
  todayIso: string,
): { valid: ValidatedAccountRow[]; rejected: RejectedRow[] } {
  const byAccount = new Map(accounts.map(a => [a.meta_ad_account_id, a]))
  const valid: ValidatedAccountRow[] = []
  const rejected: RejectedRow[] = []
  const seen = new Map<string, number>()

  for (const raw of rows) {
    const accountId = trimmed(raw.ad_account_id)
    const statDate = trimmed(raw.stat_date)
    const echo = { ad_account_id: accountId, campaign_id: null, stat_date: statDate }

    if (!accountId) {
      rejected.push({ ...echo, reason: 'Missing ad_account_id.' })
      continue
    }
    const account = byAccount.get(accountId)
    if (!account) {
      rejected.push({ ...echo, reason: `Account ${accountId} is not in the work list. Account totals are only stored for accounts with live LP tracking.` })
      continue
    }
    if (!isIsoDate(statDate)) {
      rejected.push({ ...echo, reason: `stat_date must be YYYY-MM-DD, got ${JSON.stringify(raw.stat_date)}.` })
      continue
    }
    if (statDate < account.earliest) {
      rejected.push({ ...echo, reason: `stat_date ${statDate} precedes the earliest tracked launch ${account.earliest} for this account.` })
      continue
    }
    if (statDate > todayIso) {
      rejected.push({ ...echo, reason: `stat_date ${statDate} is in the future (today is ${todayIso}).` })
      continue
    }

    const spendCents = dollarsToCents(toNumber(raw.spend))
    const revenueCents = dollarsToCents(toNumber(raw.revenue))
    if (spendCents === null || revenueCents === null) {
      rejected.push({ ...echo, reason: 'spend and revenue are required and must be numeric.' })
      continue
    }
    if (spendCents < 0 || revenueCents < 0) {
      rejected.push({ ...echo, reason: 'spend and revenue must not be negative.' })
      continue
    }

    const warnings: string[] = []
    const counts = coerceFunnelCounts(raw, warnings)
    if (revenueCents > 0 && counts.purchases === 0) {
      warnings.push('revenue reported with 0 purchases')
    }
    if (statDate === todayIso) {
      warnings.push('partial day — today is still accruing')
    }
    const window = checkWindow(raw.attribution_window, warnings)

    const row: ValidatedAccountRow = {
      meta_ad_account_id: accountId,
      brand_id: account.brand_id,
      stat_date: statDate,
      spend_cents: spendCents,
      revenue_cents: revenueCents,
      ...counts,
      attribution_window: window,
      warnings,
    }

    const key = `${accountId}|${statDate}`
    const existing = seen.get(key)
    if (existing !== undefined) {
      row.warnings.push('duplicate row for this date in the same payload — last one kept')
      valid[existing] = row
    } else {
      seen.set(key, valid.length)
      valid.push(row)
    }
  }

  return { valid, rejected }
}

export function validateDiscoveredAds(
  ads: readonly RawDiscoveredAd[],
  trackings: readonly LpTrackingRef[],
): { accepted: AcceptedAdMatch[]; rejected: RejectedAd[] } {
  const byId = new Map(trackings.map(t => [t.id, t]))
  const accepted: AcceptedAdMatch[] = []
  const rejected: RejectedAd[] = []
  const seen = new Set<string>()

  for (const raw of ads) {
    const trackingId = trimmed(raw.lp_tracking_id)
    const adId = trimmed(raw.ad_id)
    if (!trackingId || !adId) {
      rejected.push({ lp_tracking_id: trackingId, ad_id: adId, reason: 'Missing lp_tracking_id or ad_id.' })
      continue
    }
    const tracking = byId.get(trackingId)
    if (!tracking) {
      rejected.push({ lp_tracking_id: trackingId, ad_id: adId, reason: `No lp_tracking row with id ${trackingId}.` })
      continue
    }
    const destination = trimmed(raw.destination_url)
    if (!destination) {
      rejected.push({ lp_tracking_id: trackingId, ad_id: adId, reason: 'Missing destination_url — every proposed ad must carry the URL it points at.' })
      continue
    }
    // THE REFEREE. The agent's judgment got the ad here; deterministic URL
    // equality decides whether it stays. Reject, don't warn: a stored
    // mis-match feeds wrong spend into the tiles from day one.
    if (normalizeLpUrl(destination) !== normalizeLpUrl(tracking.lp_url)) {
      rejected.push({
        lp_tracking_id: trackingId,
        ad_id: adId,
        reason: `destination_url does not match the tracked LP after normalization (${normalizeLpUrl(destination)} vs ${normalizeLpUrl(tracking.lp_url)}).`,
      })
      continue
    }

    const key = `${trackingId}|${adId}`
    if (seen.has(key)) continue
    seen.add(key)

    accepted.push({
      lp_tracking_id: trackingId,
      meta_ad_id: adId,
      ad_name: trimmed(raw.ad_name),
      meta_campaign_id: trimmed(raw.campaign_id),
      campaign_name: trimmed(raw.campaign_name),
      meta_adset_id: trimmed(raw.adset_id),
      adset_name: trimmed(raw.adset_name),
      destination_url: destination,
    })
  }

  return { accepted, rejected }
}
