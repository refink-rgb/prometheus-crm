// Campaign results math — pure, no I/O, no `new Date()` for calendar logic.
//
// Every function here takes data in and returns data out. Callers pass "today"
// from easternToday() (src/lib/eastern.ts), exactly as billing.ts does — the
// host timezone must never decide which day a stat belongs to.
//
// Money is INTEGER CENTS, matching src/lib/billing.ts. Summing floats across a
// 90-day campaign drifts; summing integers does not.
//
// PERCENTAGES ARE PERCENT, NOT FRACTIONS. `unique_outbound_ctr = 2.45` means
// 2.45%, not 245%. ROAS is a plain multiple (2.45 = 2.45x). This is written on
// the DB columns too — see 20260805_add_campaign_results.sql — because it is
// the classic silent bug in a metrics table.
//
// NO IMPORTS, deliberately — same reason billing.ts defines its own
// daysBetweenIso instead of importing from eastern.ts. scripts/verify-results.ts
// runs this file under bare `node --experimental-strip-types`, where the `@/`
// path alias does not resolve. Keeping the pure layer dependency-free is what
// makes it testable at all.

// Whole days between two YYYY-MM-DD dates. DATE-only math on UTC midnight, so
// DST can never shift the result. Mirrors eastern.daysBetween.
function daysBetweenIso(fromIso: string, toIso: string): number {
  const ms = Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)
  return Math.round(ms / 86_400_000)
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export type ResultSource = 'mcp_agent' | 'manual'

// A row of `tracked_campaigns`. `ended_on: null` MEANS LIVE.
//
// `meta_adset_id: null` means track the WHOLE campaign. A non-null value
// narrows tracking to one ad set inside it — which is how several clients
// actually structure marketing moments (Noble runs every moment as an ad set
// inside one evergreen campaign). See 20260805_add_adset_tracking.sql.
export interface TrackedCampaign {
  id: string
  project_id: string
  brand_id: string
  meta_ad_account_id: string
  meta_campaign_id: string
  campaign_name: string
  meta_adset_id: string | null
  adset_name: string | null
  launched_on: string
  ended_on: string | null
  created_at: string
}

// What the Results tab shows as the thing's name. An ad-set-level row is named
// after the ad set — that's the moment — with the campaign as context.
export function trackedLabel(c: Pick<TrackedCampaign, 'campaign_name' | 'adset_name' | 'meta_adset_id'>): string {
  if (c.meta_adset_id) return c.adset_name ?? `Ad set ${c.meta_adset_id}`
  return c.campaign_name
}

export function trackedSublabel(c: Pick<TrackedCampaign, 'campaign_name' | 'meta_adset_id'>): string | null {
  return c.meta_adset_id ? `ad set in ${c.campaign_name}` : null
}

// A row of `campaign_daily_results`.
export interface DailyResult {
  id: string
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
  source: ResultSource
  warnings: string[]
  reported_at: string
}

export function isLive(campaign: Pick<TrackedCampaign, 'ended_on'>): boolean {
  return campaign.ended_on === null
}

// ---------------------------------------------------------------------------
// Rollups
// ---------------------------------------------------------------------------

export interface ResultTotals {
  days: number
  spend_cents: number
  revenue_cents: number
  // NULL when NOT ONE row in the set reported it. A campaign whose account has
  // no "Incremental Revenue" column must show '—', never $0 — a zero is a
  // claim, an em dash is an admission.
  incremental_revenue_cents: number | null
  purchases: number
  landing_page_views: number | null
  // DERIVED from the summed cents, never averaged from the per-day ratios.
  // Averaging ratios weights a $12 day the same as a $12,000 day.
  roas: number | null
  cpa_cents: number | null
}

export const EMPTY_TOTALS: ResultTotals = {
  days: 0,
  spend_cents: 0,
  revenue_cents: 0,
  incremental_revenue_cents: null,
  purchases: 0,
  landing_page_views: null,
  roas: null,
  cpa_cents: null,
}

// Sum a set of daily rows. Ratios are recomputed from the totals rather than
// averaged — see the note on ResultTotals.roas.
export function sumResults(rows: readonly DailyResult[]): ResultTotals {
  if (rows.length === 0) return EMPTY_TOTALS

  let spend = 0
  let revenue = 0
  let purchases = 0
  let incremental: number | null = null
  let lpViews: number | null = null

  for (const r of rows) {
    spend += r.spend_cents
    revenue += r.revenue_cents
    purchases += r.purchases
    if (r.incremental_revenue_cents !== null) {
      incremental = (incremental ?? 0) + r.incremental_revenue_cents
    }
    if (r.landing_page_views !== null) {
      lpViews = (lpViews ?? 0) + r.landing_page_views
    }
  }

  return {
    days: rows.length,
    spend_cents: spend,
    revenue_cents: revenue,
    incremental_revenue_cents: incremental,
    purchases,
    landing_page_views: lpViews,
    roas: safeRoas(revenue, spend),
    cpa_cents: safeCpa(spend, purchases),
  }
}

// ROAS from cents. Null on zero spend — an infinite return is not a number a
// human can act on, and rendering it as 0 would understate a free win.
export function safeRoas(revenueCents: number, spendCents: number): number | null {
  if (spendCents <= 0) return null
  return round4(revenueCents / spendCents)
}

// Null on zero purchases: dividing by zero is not a CPA of $0, and a stored 0
// would drag every average down.
export function safeCpa(spendCents: number, purchases: number): number | null {
  if (purchases <= 0) return null
  return Math.round(spendCents / purchases)
}

// Returns PERCENT (2.45 = 2.45%), matching how the column is stored.
export function safeRate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null
  return round4((numerator / denominator) * 100)
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000
}

// ---------------------------------------------------------------------------
// Contribution margin
// ---------------------------------------------------------------------------
//
// ROAS says how much revenue a dollar of spend returned. It does NOT say
// whether the money was made — it ignores what it costs to deliver the order.
// A 2.0x ROAS is strong at 30% cost of delivery and a loss at 60%, and no
// figure on the tab could distinguish those without this.
//
//   CM = revenue − cost of delivery − ad spend
//
// COD is one value per brand, in one of two modes (see
// 20260805_add_brand_cod.sql for why both exist).

export type CodMode = 'percent' | 'per_order'

export interface BrandCod {
  // NULL means NOT CONFIGURED. Every function here returns null in that case
  // rather than treating delivery as free — reporting gross profit as
  // contribution margin would overstate every campaign on the page.
  cod_value: number | null
  cod_mode: CodMode
}

// Cost of delivery in cents for a given revenue + order count.
// Null when COD isn't configured, or when per-order mode has no purchase
// count to multiply.
export function codCents(
  cod: BrandCod | null | undefined,
  revenueCents: number,
  purchases: number,
): number | null {
  if (!cod || cod.cod_value === null) return null
  if (cod.cod_mode === 'per_order') {
    // cod_value is DOLLARS per order → cents.
    return Math.round(cod.cod_value * 100 * purchases)
  }
  // cod_value is a PERCENT of revenue (35 = 35%).
  return Math.round(revenueCents * (cod.cod_value / 100))
}

export interface MarginResult {
  cod_cents: number | null
  cm_cents: number | null
  // CM as a percent of revenue. The number a P&L conversation actually uses.
  cm_pct: number | null
}

export const NO_MARGIN: MarginResult = { cod_cents: null, cm_cents: null, cm_pct: null }

export function contributionMargin(
  cod: BrandCod | null | undefined,
  revenueCents: number,
  spendCents: number,
  purchases: number,
): MarginResult {
  const delivery = codCents(cod, revenueCents, purchases)
  if (delivery === null) return NO_MARGIN
  const cm = revenueCents - delivery - spendCents
  return {
    cod_cents: delivery,
    cm_cents: cm,
    // Margin on zero revenue is undefined, not 0% — dividing here would render
    // a spend-only day as break-even.
    cm_pct: revenueCents > 0 ? round4((cm / revenueCents) * 100) : null,
  }
}

// The ROAS at which contribution margin is exactly zero — every dollar above
// it is profit, every dollar below is a loss. Only meaningful in percent mode,
// where it's a property of the brand rather than of a particular day.
//
//   CM = 0  ⇒  revenue(1 − cod) = spend  ⇒  revenue/spend = 1/(1 − cod)
export function breakEvenRoas(cod: BrandCod | null | undefined): number | null {
  if (!cod || cod.cod_value === null || cod.cod_mode !== 'percent') return null
  const fraction = cod.cod_value / 100
  if (fraction >= 1) return null
  return round4(1 / (1 - fraction))
}

export function formatCodLabel(cod: BrandCod | null | undefined): string {
  if (!cod || cod.cod_value === null) return NO_VALUE
  return cod.cod_mode === 'percent'
    ? `${cod.cod_value}% of revenue`
    : `${formatCents(Math.round(cod.cod_value * 100))} per order`
}

// ---------------------------------------------------------------------------
// Series
// ---------------------------------------------------------------------------

export interface CumulativePoint {
  stat_date: string
  spend_cents: number
  revenue_cents: number
  cumulative_spend_cents: number
  cumulative_revenue_cents: number
  cumulative_roas: number | null
}

// Running totals in stat_date order. The daily view charts both the per-day
// bars and the cumulative line off this.
export function cumulativeSeries(rows: readonly DailyResult[]): CumulativePoint[] {
  const ordered = sortByDate(rows)
  let spend = 0
  let revenue = 0
  return ordered.map(r => {
    spend += r.spend_cents
    revenue += r.revenue_cents
    return {
      stat_date: r.stat_date,
      spend_cents: r.spend_cents,
      revenue_cents: r.revenue_cents,
      cumulative_spend_cents: spend,
      cumulative_revenue_cents: revenue,
      cumulative_roas: safeRoas(revenue, spend),
    }
  })
}

export function sortByDate<T extends { stat_date: string }>(rows: readonly T[]): T[] {
  // ISO dates sort lexicographically — no Date parsing needed.
  return [...rows].sort((a, b) => (a.stat_date < b.stat_date ? -1 : a.stat_date > b.stat_date ? 1 : 0))
}

// Change from the previous day, as a PERCENT of the previous value. Null when
// there's no prior day or the prior value was 0 — "up ∞%" is noise.
export function dayOverDayPct(current: number, previous: number | null | undefined): number | null {
  if (previous === null || previous === undefined || previous === 0) return null
  return round4(((current - previous) / Math.abs(previous)) * 100)
}

// Days present between launch and the last row, so the UI can say "3 of 12
// days missing" instead of quietly drawing a continuous line over the gaps.
// A gap is normal under restatement lag; a growing gap is a broken agent.
export function missingDates(
  rows: readonly DailyResult[],
  launchedOn: string,
  throughIso: string,
): string[] {
  if (throughIso < launchedOn) return []
  const have = new Set(rows.map(r => r.stat_date))
  const out: string[] = []
  const span = daysBetweenIso(launchedOn, throughIso)
  for (let i = 0; i <= span; i++) {
    const iso = addDaysIso(launchedOn, i)
    if (!have.has(iso)) out.push(iso)
  }
  return out
}

export function addDaysIso(iso: string, delta: number): string {
  const ms = Date.parse(`${iso}T00:00:00Z`) + delta * 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}

// Days a campaign has been live, inclusive of launch day (launch day = day 1).
export function daysLive(launchedOn: string, endedOn: string | null, todayIso: string): number {
  const end = endedOn && endedOn < todayIso ? endedOn : todayIso
  if (end < launchedOn) return 0
  return daysBetweenIso(launchedOn, end) + 1
}

// ---------------------------------------------------------------------------
// Freshness
// ---------------------------------------------------------------------------
//
// Non-negotiable for an LLM-fed pipeline. A stale dashboard that LOOKS fresh is
// worse than an empty one: it gets quoted in a client call. The agent runs
// ~7am Eastern daily, so anything past ~36h means at least one run was missed.

export const STALE_AFTER_HOURS = 36

export type Freshness = 'fresh' | 'stale' | 'never'

export interface FreshnessInfo {
  state: Freshness
  hours_ago: number | null
  // Latest stat_date we hold — "data through Aug 4", distinct from when we
  // pulled it. Both matter: a fresh pull of old data is still a hole.
  data_through: string | null
}

export function freshnessOf(
  rows: readonly DailyResult[],
  nowMs: number,
): FreshnessInfo {
  if (rows.length === 0) return { state: 'never', hours_ago: null, data_through: null }

  let latestReport = 0
  let dataThrough = ''
  for (const r of rows) {
    const t = Date.parse(r.reported_at)
    if (Number.isFinite(t) && t > latestReport) latestReport = t
    if (r.stat_date > dataThrough) dataThrough = r.stat_date
  }

  if (latestReport === 0) {
    return { state: 'never', hours_ago: null, data_through: dataThrough || null }
  }

  const hours = (nowMs - latestReport) / 3_600_000
  return {
    state: hours > STALE_AFTER_HOURS ? 'stale' : 'fresh',
    hours_ago: Math.max(0, Math.round(hours * 10) / 10),
    data_through: dataThrough || null,
  }
}

// '6:58am' — the time-of-day half of the freshness stamp, in Eastern.
export function easternTimeLabel(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso)).replace(' AM', 'am').replace(' PM', 'pm')
}

// ---------------------------------------------------------------------------
// Display formatting
// ---------------------------------------------------------------------------
//
// Every formatter renders null as an em dash. Nothing here may turn an absent
// number into a zero — the never-invent rule the marketing report follows.

export const NO_VALUE = '—'

// The sign goes BEFORE the currency symbol: '-$60', not '$-60'. Negative
// amounts were impossible before contribution margin (spend and revenue are
// CHECK >= 0), so this only started mattering once a campaign could lose money
// — which is exactly the number nobody should have to squint at.
export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return NO_VALUE
  const dollars = cents / 100
  const sign = dollars < 0 ? '-' : ''
  const abs = Math.abs(dollars)
  return sign + '$' + abs.toLocaleString('en-US', {
    minimumFractionDigits: abs % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })
}

// Compact money for tiles: $12.4k, $1.2M. Full precision stays in the table.
export function formatCentsCompact(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return NO_VALUE
  const dollars = cents / 100
  const abs = Math.abs(dollars)
  const sign = dollars < 0 ? '-' : ''
  if (abs >= 1_000_000) return sign + '$' + (abs / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (abs >= 1_000) return sign + '$' + (abs / 1_000).toFixed(1).replace(/\.0$/, '') + 'k'
  return sign + '$' + Math.round(abs).toLocaleString('en-US')
}

export function formatRoas(roas: number | null | undefined): string {
  if (roas === null || roas === undefined) return NO_VALUE
  return roas.toFixed(2) + 'x'
}

// Input is ALREADY PERCENT (2.45 → '2.45%'). Do not multiply by 100 here.
export function formatPercent(pct: number | null | undefined, digits = 2): string {
  if (pct === null || pct === undefined) return NO_VALUE
  return pct.toFixed(digits) + '%'
}

export function formatCount(n: number | null | undefined): string {
  if (n === null || n === undefined) return NO_VALUE
  return n.toLocaleString('en-US')
}

// '$2,500' → 250000. Null on anything unparseable so callers reject instead of
// writing NaN. Same contract as billing.parseMoneyToCents.
export function parseMoneyToCents(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, '')
  if (!cleaned || !/^-?\d*\.?\d*$/.test(cleaned)) return null
  const value = Number(cleaned)
  if (!Number.isFinite(value)) return null
  return Math.round(value * 100)
}

// Meta reports money as a decimal string ('1234.56'). Converting it to cents is
// a WIRE-BOUNDARY concern, so it lives in results/validate.ts next to the other
// coercions — this file is rollups and display only.

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// 'Aug 4' — compact date label for table rows and chart ticks.
export function shortDateLabel(iso: string): string {
  return `${MONTH_ABBR[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`
}
