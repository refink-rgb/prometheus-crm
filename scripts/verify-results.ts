// Checks for the campaign-results math and validation layer. No test framework
// in this repo, so this is a standalone script (same shape as
// scripts/verify-billing.ts):
//
//   node --experimental-strip-types scripts/verify-results.ts
//
// Exits non-zero on any failure. `scripts` is in the tsconfig exclude list, so
// nothing here reaches `next build`.
//
// This script carries more weight than usual: /results cannot be rendered
// locally (the repo's .env.local holds dummy Supabase credentials — see
// PROJECT_CONTEXT.md), so these assertions are the only pre-deploy proof that
// the upsert semantics, the validator, and the rollup math are right.
//
// The two behaviours worth breaking the build over:
//   1. UPSERT IDEMPOTENCY under Meta's restatements — the same (campaign, day)
//      pulled twice must UPDATE, never append. Simulated here against the same
//      unique key the DB enforces.
//   2. WARN-DON'T-DROP — a row whose arithmetic disagrees with itself is
//      STORED with a warning. A dropped row is indistinguishable from a day
//      the campaign didn't run.

import {
  sumResults,
  cumulativeSeries,
  safeRoas,
  safeCpa,
  safeRate,
  contributionMargin,
  breakEvenRoas,
  formatCodLabel,
  dayOverDayPct,
  missingDates,
  daysLive,
  freshnessOf,
  formatCents,
  formatCentsCompact,
  formatRoas,
  formatPercent,
  parseMoneyToCents,
  shortDateLabel,
  addDaysIso,
  STALE_AFTER_HOURS,
  momentKey,
  isGrouped,
  combineDailyByDate,
  trackedLabel,
  trackedSublabel,
  type DailyResult,
  type TrackedCampaign,
} from '../src/lib/results.ts'

import {
  validateRows,
  parsePayload,
  toNumber,
  toInt,
  dollarsToCents,
  isIsoDate,
  withinTolerance,
  campaignKey,
  identityOf,
  type CampaignRef,
  type RawResultRow,
  type ValidatedRow,
} from '../src/lib/results/validate.ts'

let fails = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) fails++
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${ok ? '' : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`)
}

function checkTrue(label: string, actual: boolean) {
  check(label, actual, true)
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TODAY = '2026-08-05'
const CAMPAIGN_ID = 'tc-1'

const CAMPAIGNS: CampaignRef[] = [
  {
    id: CAMPAIGN_ID,
    meta_ad_account_id: 'act_123456',
    meta_campaign_id: '987654321',
    meta_adset_id: null,          // whole-campaign tracking
    launched_on: '2026-08-01',
    ended_on: null,
  },
  {
    id: 'tc-ended',
    meta_ad_account_id: 'act_123456',
    meta_campaign_id: '111222333',
    meta_adset_id: null,
    launched_on: '2026-07-01',
    ended_on: '2026-07-20',
  },
  // Ad-set-level tracking, modelled on the real Noble case: two marketing
  // moments living as ad sets inside ONE evergreen campaign (6987812298183,
  // "CTC - ACQ - Marketing Moments"). Tracking the campaign here would report
  // both moments' spend under whichever one you linked.
  {
    id: 'tc-adset-molly',
    meta_ad_account_id: 'act_10035647',
    meta_campaign_id: '6987812298183',
    meta_adset_id: '52530393856787',   // 260729 - Molly's Favorites
    launched_on: '2026-07-29',
    ended_on: null,
  },
  {
    id: 'tc-adset-summer',
    meta_ad_account_id: 'act_10035647',
    meta_campaign_id: '6987812298183',
    meta_adset_id: '52527904953587',   // 260723 - Summer Launch
    launched_on: '2026-07-23',
    ended_on: null,
  },
  // Freshly linked with the ad set id ALONE — campaign_id not backfilled yet.
  // This is the state every ad-set link starts in, so matching must work
  // without any campaign context at all.
  {
    id: 'tc-adset-bare',
    meta_ad_account_id: 'act_10035647',
    meta_campaign_id: null,
    meta_adset_id: '52520956981987',   // 260703 - 4th of July Flash Sale
    launched_on: '2026-07-03',
    ended_on: null,
  },
]

function day(overrides: Partial<DailyResult> & { stat_date: string }): DailyResult {
  return {
    id: `r-${overrides.stat_date}`,
    tracked_campaign_id: CAMPAIGN_ID,
    spend_cents: 0,
    revenue_cents: 0,
    incremental_revenue_cents: null,
    cpa_cents: null,
    purchases: 0,
    landing_page_views: null,
    roas: null,
    unique_outbound_ctr: null,
    lp_conversion_rate: null,
    attribution_window: '7d_click',
    source: 'mcp_agent',
    warnings: [],
    reported_at: '2026-08-05T10:58:00.000Z',
    ...overrides,
  }
}

// Hand-checked four-day fixture. Totals below were computed by hand, not by
// running the code — that is the point of a fixture.
//
//   day        spend      revenue    purchases   incremental
//   Aug 1     $100.00     $250.00        5          $80.00
//   Aug 2     $150.00     $600.00       12         $200.00
//   Aug 3     $200.00     $400.00        8               —
//   Aug 4     $250.00   $1,000.00       20         $350.00
//   ─────────────────────────────────────────────────────────
//   totals    $700.00   $2,250.00       45         $630.00
//   ROAS = 2250/700 = 3.2142857… → 3.2143 (4dp)
//   CPA  = 70000c/45 = 1555.55… → 1556 cents = $15.56
const FIXTURE: DailyResult[] = [
  day({ stat_date: '2026-08-01', spend_cents: 10_000, revenue_cents: 25_000, purchases: 5, incremental_revenue_cents: 8_000, landing_page_views: 500 }),
  day({ stat_date: '2026-08-02', spend_cents: 15_000, revenue_cents: 60_000, purchases: 12, incremental_revenue_cents: 20_000, landing_page_views: 800 }),
  day({ stat_date: '2026-08-03', spend_cents: 20_000, revenue_cents: 40_000, purchases: 8, landing_page_views: 700 }),
  day({ stat_date: '2026-08-04', spend_cents: 25_000, revenue_cents: 100_000, purchases: 20, incremental_revenue_cents: 35_000, landing_page_views: 1_000 }),
]

// ---------------------------------------------------------------------------

console.log('--- rollups against the hand-checked fixture ---')
const totals = sumResults(FIXTURE)
check('4 days', totals.days, 4)
check('spend = $700', formatCents(totals.spend_cents), '$700')
check('revenue = $2,250', formatCents(totals.revenue_cents), '$2,250')
check('purchases = 45', totals.purchases, 45)
check('LP views = 3,000', totals.landing_page_views, 3_000)
check('ROAS = 3.2143 (derived from summed cents)', totals.roas, 3.2143)
check('ROAS renders 3.21x', formatRoas(totals.roas), '3.21x')
check('CPA = 1556 cents', totals.cpa_cents, 1556)
check('CPA renders $15.56', formatCents(totals.cpa_cents), '$15.56')

console.log('\n--- ratios are derived from totals, NOT averaged from daily ratios ---')
// Averaging the four daily ROASes gives (2.5 + 4.0 + 2.0 + 4.0)/4 = 3.125.
// The correct spend-weighted answer is 3.2143. If this ever equals 3.125 again,
// someone has "simplified" sumResults into a mean.
const naiveMean = (2.5 + 4.0 + 2.0 + 4.0) / 4
checkTrue('weighted ROAS differs from the naive mean', totals.roas !== naiveMean)
check('naive mean would have been 3.125', naiveMean, 3.125)

console.log('\n--- incremental revenue: partial coverage sums, total absence is null ---')
// Aug 3 has no incremental figure. The other three sum to $630 — the day
// without one must NOT be counted as $0.
check('incremental = $630 across the 3 days that reported it', formatCents(totals.incremental_revenue_cents), '$630')
const noneReported = sumResults(FIXTURE.map(r => ({ ...r, incremental_revenue_cents: null })))
check('no row reported it → null, NOT 0', noneReported.incremental_revenue_cents, null)
check('and it renders as an em dash', formatCents(noneReported.incremental_revenue_cents), '—')

console.log('\n--- divide-by-zero returns null, never 0 ---')
check('ROAS on 0 spend → null', safeRoas(50_000, 0), null)
check('CPA on 0 purchases → null', safeCpa(50_000, 0), null)
check('rate on 0 denominator → null', safeRate(5, 0), null)
check('empty set → zeroed totals with null ratios', sumResults([]).roas, null)

console.log('\n--- percentages are PERCENT, not fractions ---')
// 5 purchases / 500 views = 1% . Stored and returned as 1, not 0.01.
check('5/500 → 1 (meaning 1%)', safeRate(5, 500), 1)
check('renders as 1.00%', formatPercent(safeRate(5, 500)), '1.00%')
check('2.45 renders as 2.45%, not 245%', formatPercent(2.45), '2.45%')

console.log('\n--- contribution margin: percent-of-revenue mode ---')
// Fixture totals: $700 spend, $2,250 revenue, 45 purchases.
// At 35% COD: delivery = $787.50, CM = 2250 - 787.50 - 700 = $762.50
const pct35 = { cod_value: 35, cod_mode: 'percent' as const }
const m35 = contributionMargin(pct35, totals.revenue_cents, totals.spend_cents, totals.purchases)
check('delivery cost = $787.50', formatCents(m35.cod_cents), '$787.50')
check('CM = $762.50', formatCents(m35.cm_cents), '$762.50')
check('CM% = 33.8889% of revenue', m35.cm_pct, 33.8889)
check('renders as 33.89%', formatPercent(m35.cm_pct), '33.89%')

// The formula as Giovane states it (2026-08-05): rev * (1 - cod%) - spend.
// contributionMargin() subtracts the delivery cost as its own term instead,
// which is the same thing rearranged. Asserted directly so a future refactor
// of either form has to keep agreeing with the other.
console.log('\n--- CM matches rev * (1 - cod%) - spend, stated directly ---')
for (const codPct of [0, 15, 35, 42.5, 60, 100]) {
  const direct = Math.round(totals.revenue_cents * (1 - codPct / 100)) - totals.spend_cents
  const viaFn = contributionMargin(
    { cod_value: codPct, cod_mode: 'percent' },
    totals.revenue_cents, totals.spend_cents, totals.purchases,
  ).cm_cents
  check(`cod ${codPct}% → ${formatCents(direct)}`, viaFn, direct)
}

console.log('\n--- contribution margin: dollars-per-order mode ---')
// $18.50/order × 45 orders = $832.50 delivery. CM = 2250 - 832.50 - 700 = $717.50
const perOrder = { cod_value: 18.5, cod_mode: 'per_order' as const }
const mPer = contributionMargin(perOrder, totals.revenue_cents, totals.spend_cents, totals.purchases)
check('delivery cost = $832.50', formatCents(mPer.cod_cents), '$832.50')
check('CM = $717.50', formatCents(mPer.cm_cents), '$717.50')
// The two modes MUST give different answers on the same data — if they ever
// agree, one of them is being ignored.
checkTrue('the two modes are genuinely different', m35.cm_cents !== mPer.cm_cents)

console.log('\n--- an unset COD reports nothing, never zero ---')
// The dangerous bug: treating "no COD" as 0% would report gross profit as
// contribution margin, overstating every campaign by the full delivery cost.
const noCod = contributionMargin({ cod_value: null, cod_mode: 'percent' }, 225_000, 70_000, 45)
check('CM is null, NOT $1,550 (revenue − spend)', noCod.cm_cents, null)
check('delivery is null', noCod.cod_cents, null)
check('CM% is null', noCod.cm_pct, null)
check('and it renders as an em dash', formatCents(noCod.cm_cents), '—')
check('null cod object → null', contributionMargin(null, 225_000, 70_000, 45).cm_cents, null)

console.log('\n--- a losing campaign reports a NEGATIVE margin, not a floor of 0 ---')
// $100 spend, $100 revenue, 60% COD → delivery $60, CM = 100 - 60 - 100 = -$60
const losing = contributionMargin({ cod_value: 60, cod_mode: 'percent' }, 10_000, 10_000, 2)
check('CM = -$60', formatCents(losing.cm_cents), '-$60')
checkTrue('and it is negative', (losing.cm_cents as number) < 0)
check('CM% = -60%', losing.cm_pct, -60)

console.log('\n--- per-order COD on a day with no purchases costs nothing ---')
const noPurchases = contributionMargin(perOrder, 0, 5_000, 0)
check('delivery = $0 (no orders to deliver)', noPurchases.cod_cents, 0)
check('CM = -$50 (pure spend)', formatCents(noPurchases.cm_cents), '-$50')
check('CM% on zero revenue is null, not 0%', noPurchases.cm_pct, null)

console.log('\n--- break-even ROAS ---')
// At 35% COD: 1/(1-0.35) = 1.5385x
check('35% COD → 1.5385x', breakEvenRoas(pct35), 1.5385)
check('renders as 1.54x', formatRoas(breakEvenRoas(pct35)), '1.54x')
check('50% COD → exactly 2x', breakEvenRoas({ cod_value: 50, cod_mode: 'percent' }), 2)
check('0% COD → 1x', breakEvenRoas({ cod_value: 0, cod_mode: 'percent' }), 1)
check('100% COD → null (never breaks even)', breakEvenRoas({ cod_value: 100, cod_mode: 'percent' }), null)
check('per-order mode has no single break-even ROAS', breakEvenRoas(perOrder), null)
check('unset COD → null', breakEvenRoas({ cod_value: null, cod_mode: 'percent' }), null)

console.log('\n--- break-even agrees with the margin math (the invariant) ---')
// At exactly break-even ROAS, CM must be 0. If these two ever disagree, the
// tab is telling a brand to hit a number that doesn't actually break even.
const beRoas = breakEvenRoas(pct35) as number
const spendAtBe = 100_000
const revenueAtBe = Math.round(spendAtBe * beRoas)
const atBe = contributionMargin(pct35, revenueAtBe, spendAtBe, 10)
checkTrue('CM at break-even ROAS is ~$0', Math.abs(atBe.cm_cents as number) < 100)

console.log('\n--- COD label formatting ---')
check('percent mode', formatCodLabel(pct35), '35% of revenue')
check('per-order mode', formatCodLabel(perOrder), '$18.50 per order')
check('unset', formatCodLabel({ cod_value: null, cod_mode: 'percent' }), '—')

console.log('\n--- moment grouping: identity and labels ---')
function tc(overrides: Partial<TrackedCampaign> & { id: string }): TrackedCampaign {
  return {
    project_id: 'p-1', brand_id: 'b-1', meta_ad_account_id: 'act_1',
    meta_campaign_id: null, campaign_name: null, meta_adset_id: null, adset_name: null,
    launched_on: '2026-08-01', ended_on: null, created_at: '2026-08-01T00:00:00Z',
    moment_group_id: null, moment_group_label: null,
    ...overrides,
  }
}

const lone = tc({ id: 'tc-lone' })
check('an ungrouped row is its own key', momentKey(lone), 'tc-lone')
check('isGrouped is false for it', isGrouped(lone), false)

const memberA = tc({ id: 'tc-a', meta_adset_id: '111', adset_name: 'Prospecting', moment_group_id: 'grp-1', moment_group_label: "Father's Day 2026" })
const memberB = tc({ id: 'tc-b', meta_adset_id: '222', adset_name: 'Retention', moment_group_id: 'grp-1', moment_group_label: "Father's Day 2026" })
check('grouped members share the group as their key', momentKey(memberA), 'grp-1')
check('...both of them', momentKey(memberB), 'grp-1')
check('isGrouped true for a member', isGrouped(memberA), true)

console.log('\n--- moment grouping: labels ---')
check('a grouped row is named after the MOMENT, not the ad set', trackedLabel(memberA), "Father's Day 2026")
checkTrue('sublabel says how many ad sets, when told', trackedSublabel(memberA, 2) === 'combined from 2 ad sets')
check('an ungrouped ad-set row keeps its own ad-set label', trackedLabel({ ...lone, meta_adset_id: '999', adset_name: 'Solo Ad Set' }), 'Solo Ad Set')

console.log('\n--- combineDailyByDate: the prospecting + retention case ---')
// Hand-checked: two ad sets, three overlapping days.
//   date        prospecting            retention              combined
//   Aug 1     $100 / $200 / 4p        $50 / $300 / 6p       $150 / $500 / 10p
//   Aug 2     $200 / $100 / 1p              —                $200 / $100 / 1p  (retention absent that day)
//   Aug 3           —                $80 / $400 / 8p         $80  / $400 / 8p  (prospecting absent that day)
const prospecting = [
  day({ tracked_campaign_id: 'tc-a', stat_date: '2026-08-01', spend_cents: 10_000, revenue_cents: 20_000, purchases: 4, landing_page_views: 100 }),
  day({ tracked_campaign_id: 'tc-a', stat_date: '2026-08-02', spend_cents: 20_000, revenue_cents: 10_000, purchases: 1, landing_page_views: 50 }),
]
const retention = [
  day({ tracked_campaign_id: 'tc-b', stat_date: '2026-08-01', spend_cents: 5_000, revenue_cents: 30_000, purchases: 6, landing_page_views: 60 }),
  day({ tracked_campaign_id: 'tc-b', stat_date: '2026-08-03', spend_cents: 8_000, revenue_cents: 40_000, purchases: 8, landing_page_views: 80 }),
]
const combined = combineDailyByDate([prospecting, retention])
check('3 combined days (union of dates, not intersection)', combined.length, 3)
check('Aug 1 sums both members', [combined[0].spend_cents, combined[0].revenue_cents, combined[0].purchases], [15_000, 50_000, 10])
check('Aug 2 is prospecting alone (retention had no row that day)', [combined[1].spend_cents, combined[1].revenue_cents], [20_000, 10_000])
check('Aug 3 is retention alone (prospecting had no row that day)', [combined[2].spend_cents, combined[2].revenue_cents], [8_000, 40_000])
check('combined dates are in order', combined.map(r => r.stat_date), ['2026-08-01', '2026-08-02', '2026-08-03'])

console.log('\n--- combineDailyByDate: ratios re-derived, never averaged ---')
// Aug 1 ROAS naive-averaged would be (2.0 + 6.0)/2 = 4.0. The correct
// spend-weighted answer from $150 spend / $500 revenue is 3.3333.
check('Aug 1 combined ROAS is spend-weighted (3.3333), not the naive mean (4.0)', combined[0].roas, 3.3333)
checkTrue('...and it is NOT the naive average', combined[0].roas !== 4.0)

console.log('\n--- combineDailyByDate: outbound CTR cannot be honestly combined ---')
// No stored impressions denominator across entities — averaging two CTRs
// would silently weight a $10 ad set the same as a $10,000 one.
checkTrue('combined CTR is always null, never an average of the two', combined.every(r => r.unique_outbound_ctr === null))

console.log('\n--- combineDailyByDate: warnings union, not first-one-wins ---')
const flaggedA = [day({ tracked_campaign_id: 'tc-a', stat_date: '2026-08-05', spend_cents: 100, revenue_cents: 100, warnings: ['ROAS disagrees with revenue/spend'] })]
const flaggedB = [day({ tracked_campaign_id: 'tc-b', stat_date: '2026-08-05', spend_cents: 100, revenue_cents: 100, warnings: ['CPA disagrees with spend/purchases'] })]
const combinedFlagged = combineDailyByDate([flaggedA, flaggedB])
check('both warnings survive being combined — grouping cannot launder a flag away',
  combinedFlagged[0].warnings, ['ROAS disagrees with revenue/spend', 'CPA disagrees with spend/purchases'])

console.log('\n--- combineDailyByDate: a disagreeing attribution window is flagged, not silently picked ---')
const winA = [day({ tracked_campaign_id: 'tc-a', stat_date: '2026-08-06', attribution_window: '1d_view_7d_click' })]
const winB = [day({ tracked_campaign_id: 'tc-b', stat_date: '2026-08-06', attribution_window: '28d_click' })]
checkTrue('mismatched windows across members produce a warning',
  combineDailyByDate([winA, winB])[0].warnings.some(w => w.includes('disagree on attribution window')))

console.log('\n--- combineDailyByDate: freshness follows the LATEST member pull ---')
const staleA = [day({ tracked_campaign_id: 'tc-a', stat_date: '2026-08-07', reported_at: '2026-08-07T09:00:00.000Z' })]
const freshB = [day({ tracked_campaign_id: 'tc-b', stat_date: '2026-08-07', reported_at: '2026-08-08T09:00:00.000Z' })]
check('combined reported_at is the most recent across members', combineDailyByDate([staleA, freshB])[0].reported_at, '2026-08-08T09:00:00.000Z')

console.log('\n--- combineDailyByDate: an empty set of rows for a date pair yields nothing to sum ---')
check('combining two empty sets is empty, not a phantom zero day', combineDailyByDate([[], []]), [])

console.log('\n--- cumulative series ---')
const series = cumulativeSeries(FIXTURE)
check('cumulative spend runs 100/250/450/700', series.map(p => p.cumulative_spend_cents), [10_000, 25_000, 45_000, 70_000])
check('cumulative revenue runs 250/850/1250/2250', series.map(p => p.cumulative_revenue_cents), [25_000, 85_000, 125_000, 225_000])
check('final cumulative ROAS matches the total', series[3].cumulative_roas, totals.roas)
check('day-1 cumulative ROAS = 2.5', series[0].cumulative_roas, 2.5)

console.log('\n--- series sorts by date regardless of input order ---')
const shuffled = [FIXTURE[2], FIXTURE[0], FIXTURE[3], FIXTURE[1]]
check('shuffled input yields the same ordered dates',
  cumulativeSeries(shuffled).map(p => p.stat_date),
  ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04'])
check('and the same cumulative totals',
  cumulativeSeries(shuffled).map(p => p.cumulative_spend_cents),
  [10_000, 25_000, 45_000, 70_000])

console.log('\n--- day-over-day ---')
check('100 → 150 is +50%', dayOverDayPct(150, 100), 50)
check('150 → 100 is -33.3333%', dayOverDayPct(100, 150), -33.3333)
check('no previous day → null', dayOverDayPct(100, null), null)
check('previous was 0 → null (not Infinity)', dayOverDayPct(100, 0), null)

console.log('\n--- gap detection ---')
check('no gaps in a complete run', missingDates(FIXTURE, '2026-08-01', '2026-08-04'), [])
check('Aug 5 missing when the window extends to it', missingDates(FIXTURE, '2026-08-01', '2026-08-05'), ['2026-08-05'])
const holed = FIXTURE.filter(r => r.stat_date !== '2026-08-02')
check('a hole in the middle is found', missingDates(holed, '2026-08-01', '2026-08-04'), ['2026-08-02'])
check('window ending before launch → no phantom gaps', missingDates([], '2026-08-01', '2026-07-30'), [])

console.log('\n--- days live (launch day counts as day 1) ---')
check('launched today → 1', daysLive('2026-08-05', null, TODAY), 1)
check('launched Aug 1, today Aug 5 → 5', daysLive('2026-08-01', null, TODAY), 5)
check('ended campaign stops counting at ended_on', daysLive('2026-07-01', '2026-07-20', TODAY), 20)
check('future launch → 0', daysLive('2026-08-10', null, TODAY), 0)

console.log('\n--- freshness: a stale dashboard must never look fresh ---')
const NOW = Date.parse('2026-08-05T12:00:00.000Z')
const freshRows = [day({ stat_date: '2026-08-04', reported_at: '2026-08-05T10:58:00.000Z' })]
check('pulled 1h ago → fresh', freshnessOf(freshRows, NOW).state, 'fresh')
check('and reports data_through', freshnessOf(freshRows, NOW).data_through, '2026-08-04')

// 37h > the 36h threshold: at least one 7am run was missed.
const staleRows = [day({ stat_date: '2026-08-02', reported_at: '2026-08-03T23:00:00.000Z' })]
check(`pulled 37h ago → stale (threshold ${STALE_AFTER_HOURS}h)`, freshnessOf(staleRows, NOW).state, 'stale')
check('no rows at all → never', freshnessOf([], NOW).state, 'never')
// Freshness follows the LATEST pull across the set, not the first row.
const mixed = [
  day({ stat_date: '2026-08-01', reported_at: '2026-08-01T11:00:00.000Z' }),
  day({ stat_date: '2026-08-04', reported_at: '2026-08-05T11:00:00.000Z' }),
]
check('mixed pulls take the most recent', freshnessOf(mixed, NOW).state, 'fresh')
check('and the latest stat_date', freshnessOf(mixed, NOW).data_through, '2026-08-04')

console.log('\n--- cents ↔ display round-trips ---')
check("'$2,500' → 250000", parseMoneyToCents('$2,500'), 250_000)
check("'1234.56' → 123456", parseMoneyToCents('1234.56'), 123_456)
check("'abc' → null", parseMoneyToCents('abc'), null)
check("'' → null", parseMoneyToCents(''), null)
check('250000 → $2,500', formatCents(250_000), '$2,500')
check('123456 → $1,234.56', formatCents(123_456), '$1,234.56')
check('round-trip $1,234.56', formatCents(parseMoneyToCents('$1,234.56') as number), '$1,234.56')
check('Meta decimal 1234.56 → 123456 cents', dollarsToCents('1234.56'), 123_456)
check('Meta numeric 0.07 → 7 cents', dollarsToCents(0.07), 7)
check('null stays null', dollarsToCents(null), null)
check('compact: $12,400 → $12.4k', formatCentsCompact(1_240_000), '$12.4k')
check('compact: $2,000,000 → $2M', formatCentsCompact(200_000_000), '$2M')
check('compact: null → em dash', formatCentsCompact(null), '—')
// Sign before the symbol. '$-60' is a misreading waiting to happen, and
// contribution margin made negative money possible for the first time.
check('negative: -$60, not $-60', formatCents(-6_000), '-$60')
check('negative with cents: -$60.50', formatCents(-6_050), '-$60.50')
check('compact negative: -$12.4k', formatCentsCompact(-1_240_000), '-$12.4k')
check('date label', shortDateLabel('2026-08-04'), 'Aug 4')
check('addDaysIso crosses a month boundary', addDaysIso('2026-07-31', 1), '2026-08-01')

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function raw(overrides: Partial<RawResultRow> = {}): RawResultRow {
  return {
    ad_account_id: 'act_123456',
    campaign_id: '987654321',
    stat_date: '2026-08-04',
    spend: 250,
    revenue: 1000,
    purchases: 20,
    landing_page_views: 1000,
    roas: 4,
    cpa: 12.5,
    unique_outbound_ctr: 1.2,
    lp_conversion_rate: 2,
    attribution_window: '7d_click',
    ...overrides,
  }
}

function run(rows: RawResultRow[], today = TODAY) {
  return validateRows(rows, CAMPAIGNS, today)
}

function only(rows: RawResultRow[], today = TODAY): ValidatedRow {
  const r = run(rows, today)
  if (r.valid.length !== 1) throw new Error(`expected 1 valid row, got ${r.valid.length}`)
  return r.valid[0]
}

console.log('\n--- validator: the happy path is clean ---')
const clean = run([raw()])
check('1 valid, 0 rejected', [clean.valid.length, clean.rejected.length], [1, 0])
check('no warnings on consistent data', clean.valid[0].warnings, [])
check('money converted to cents', [clean.valid[0].spend_cents, clean.valid[0].revenue_cents], [25_000, 100_000])
check('linked to the tracked campaign', clean.valid[0].tracked_campaign_id, CAMPAIGN_ID)

console.log('\n--- validator: REJECT — nowhere to put the row ---')
check('unknown campaign is rejected',
  run([raw({ campaign_id: '000000' })]).rejected.length, 1)
check('...and never auto-creates a tracked campaign',
  run([raw({ campaign_id: '000000' })]).valid.length, 0)
checkTrue('...with a reason naming the fix',
  run([raw({ campaign_id: '000000' })]).rejected[0].reason.includes('Link it on the project first'))
check('unknown AD ACCOUNT with a known campaign id is still rejected',
  run([raw({ ad_account_id: 'act_999' })]).rejected.length, 1)
check('missing ids rejected', run([raw({ campaign_id: null })]).rejected.length, 1)
check('date before launch rejected', run([raw({ stat_date: '2026-07-31' })]).rejected.length, 1)
check('future date rejected', run([raw({ stat_date: '2026-08-06' })]).rejected.length, 1)
check('malformed date rejected', run([raw({ stat_date: '08/04/2026' })]).rejected.length, 1)
check('impossible calendar date rejected', run([raw({ stat_date: '2026-02-31' })]).rejected.length, 1)
check('missing spend rejected', run([raw({ spend: null })]).rejected.length, 1)
check("non-numeric spend ('N/A') rejected — NOT coerced to 0", run([raw({ spend: 'N/A' })]).rejected.length, 1)
check('negative spend rejected', run([raw({ spend: -10 })]).rejected.length, 1)
check('date after tracking ended is rejected',
  validateRows(
    [raw({ campaign_id: '111222333', stat_date: '2026-07-21' })],
    CAMPAIGNS, TODAY,
  ).rejected.length, 1)
check('...but a date inside the tracked window is accepted',
  validateRows(
    [raw({ campaign_id: '111222333', stat_date: '2026-07-15', spend: 100, revenue: 200, purchases: 4, roas: 2, cpa: 25, landing_page_views: null, lp_conversion_rate: null })],
    CAMPAIGNS, TODAY,
  ).valid.length, 1)

console.log('\n--- validator: WARN, DON\'T DROP — the row is stored and flagged ---')
// This is the rule that keeps "bad data" distinguishable from "no campaign".
const badRoas = run([raw({ roas: 47 })])
check('inconsistent ROAS still yields a stored row', badRoas.valid.length, 1)
check('...and nothing is rejected', badRoas.rejected.length, 0)
check('...with exactly one warning', badRoas.valid[0].warnings.length, 1)
checkTrue('...naming the disagreement', badRoas.valid[0].warnings[0].includes('disagrees with revenue/spend'))

check('ROAS within 2% tolerance is NOT flagged', only([raw({ roas: 4.05 })]).warnings, [])
checkTrue('ROAS 10% off IS flagged', only([raw({ roas: 4.4 })]).warnings.length === 1)
checkTrue('inconsistent CPA is flagged',
  only([raw({ cpa: 99 })]).warnings.some(w => w.includes('CPA disagrees')))
checkTrue('CPA on a zero-purchase day is flagged',
  only([raw({ purchases: 0, revenue: 0, roas: 0, lp_conversion_rate: 0, cpa: 12.5 })]).warnings.some(w => w.includes('0 purchases')))
checkTrue('inconsistent LP conversion is flagged',
  only([raw({ lp_conversion_rate: 15 })]).warnings.some(w => w.includes('LP conversion')))
checkTrue('implausible ROAS is flagged',
  only([raw({ spend: 1, revenue: 1000, roas: 1000, cpa: 0.05 })]).warnings.some(w => w.includes('implausibly high')))
checkTrue('a rate over 100% is flagged as a units error',
  only([raw({ unique_outbound_ctr: 250 })]).warnings.some(w => w.includes('check units')))
checkTrue('revenue with 0 purchases is flagged',
  only([raw({ purchases: 0, cpa: null, lp_conversion_rate: 0 })]).warnings.some(w => w.includes('revenue reported with 0 purchases')))
checkTrue('incremental > total revenue is flagged',
  only([raw({ incremental_revenue: 5000 })]).warnings.some(w => w.includes('exceeds total revenue')))
checkTrue("today's partial day is flagged",
  only([raw({ stat_date: TODAY })], TODAY).warnings.some(w => w.includes('partial day')))
checkTrue('a non-default attribution window is flagged, not silently accepted',
  only([raw({ attribution_window: '28d_click' })]).warnings.some(w => w.includes('not the expected 7-day click')))
// Meta's own attribution_setting field reports the default window as
// '1d_view_7d_click'. Flagging that would have put a warning badge on every
// row from every default-configured account on day one.
check("Meta's native '1d_view_7d_click' is NOT flagged",
  only([raw({ attribution_window: '1d_view_7d_click' })]).warnings, [])
check('...and is stored verbatim',
  only([raw({ attribution_window: '1d_view_7d_click' })]).attribution_window, '1d_view_7d_click')
check("the other spelling '7d_click_1d_view' is also clean",
  only([raw({ attribution_window: '7d_click_1d_view' })]).warnings, [])
check('...and the window is still STORED so the chart step is explainable',
  only([raw({ attribution_window: '28d_click' })]).attribution_window, '28d_click')
checkTrue('an unrecognized window is flagged',
  only([raw({ attribution_window: 'made_up' })]).warnings.some(w => w.includes('unrecognized')))

console.log('\n--- validator: absent metrics stay null, they never become 0 ---')
const sparse = only([raw({
  incremental_revenue: null, landing_page_views: null,
  roas: null, cpa: null, unique_outbound_ctr: null, lp_conversion_rate: null,
})])
check('incremental null', sparse.incremental_revenue_cents, null)
check('LP views null', sparse.landing_page_views, null)
check('ROAS null', sparse.roas, null)
check('CPA null', sparse.cpa_cents, null)
check('CTR null', sparse.unique_outbound_ctr, null)
check('no warnings — absence is honest, not an error', sparse.warnings, [])
check("the string 'N/A' for an optional metric becomes null, not 0",
  only([raw({ unique_outbound_ctr: 'N/A' })]).unique_outbound_ctr, null)
check('missing purchases is warned AND stored as 0',
  only([raw({ purchases: null, cpa: null, lp_conversion_rate: null })]).purchases, 0)
checkTrue('...with the warning saying so',
  only([raw({ purchases: null, cpa: null, lp_conversion_rate: null })]).warnings.some(w => w.includes('purchases missing')))

console.log('\n--- validator: quoted numbers from an LLM are accepted ---')
const quoted = only([raw({ spend: '250.00', revenue: '1,000.00', purchases: '20', roas: '4.0' })])
check("'250.00' → 25000 cents", quoted.spend_cents, 25_000)
check("'1,000.00' → 100000 cents", quoted.revenue_cents, 100_000)
check("'20' → 20", quoted.purchases, 20)

console.log('\n--- validator: duplicate dates inside one payload ---')
const dupes = run([raw({ spend: 100 }), raw({ spend: 250 })])
check('collapsed to one row', dupes.valid.length, 1)
check('last one wins', dupes.valid[0].spend_cents, 25_000)
checkTrue('and the collision is reported, not hidden',
  dupes.valid[0].warnings.some(w => w.includes('duplicate row')))

// ---------------------------------------------------------------------------
// Ad-set-level tracking
// ---------------------------------------------------------------------------
//
// The failure this whole feature-within-a-feature exists to prevent: several
// clients run every marketing moment as an AD SET inside one evergreen
// campaign. Tracking the campaign and calling it one moment reports every
// moment in the bucket added together, under one moment's name — with a launch
// date months before that moment existed. Every individual number is real,
// which is precisely why no arithmetic check can catch it.

function adsetRaw(overrides: Partial<RawResultRow> = {}): RawResultRow {
  return {
    ad_account_id: 'act_10035647',
    campaign_id: '6987812298183',
    adset_id: '52530393856787',
    stat_date: '2026-08-04',
    spend: 100,
    revenue: 200,
    purchases: 4,
    roas: 2,
    cpa: 25,
    landing_page_views: null,
    lp_conversion_rate: null,
    unique_outbound_ctr: null,
    ...overrides,
  }
}

console.log('\n--- ad-set tracking: the right ad set matches ---')
const adsetOk = run([adsetRaw()])
check('1 valid, 0 rejected', [adsetOk.valid.length, adsetOk.rejected.length], [1, 0])
check("routed to Molly's tracking row, not the campaign", adsetOk.valid[0].tracked_campaign_id, 'tc-adset-molly')
check('no warnings', adsetOk.valid[0].warnings, [])

console.log('\n--- sibling ad sets in the SAME campaign stay separate ---')
const bothAdsets = run([
  adsetRaw({ spend: 100, revenue: 200 }),
  adsetRaw({ adset_id: '52527904953587', spend: 300, revenue: 900, purchases: 12, roas: 3, cpa: 25 }),
])
check('both stored', bothAdsets.valid.length, 2)
check('as two DIFFERENT tracked rows',
  bothAdsets.valid.map(r => r.tracked_campaign_id), ['tc-adset-molly', 'tc-adset-summer'])
// If the key ignored adset_id, these would collapse to one row on the same
// date and the second would silently overwrite the first.
check('not collapsed by the dedupe key', new Set(bothAdsets.valid.map(r => r.tracked_campaign_id)).size, 2)

console.log('\n--- THE BUG THIS PREVENTS: campaign totals sent for an ad-set-tracked campaign ---')
const campaignLevelSent = run([adsetRaw({ adset_id: null, spend: 2700, revenue: 5900 })])
check('REJECTED, not silently stored', [campaignLevelSent.valid.length, campaignLevelSent.rejected.length], [0, 1])
checkTrue('...and the reason says it is tracked per ad set',
  campaignLevelSent.rejected[0].reason.includes('tracked per AD SET'))
checkTrue('...and names the ad sets to pull instead',
  campaignLevelSent.rejected[0].reason.includes('52530393856787'))

console.log('\n--- an ad set links with its ID ALONE, no campaign id needed ---')
// The whole point of the identity change: campaign_id is context, not identity.
const bare = run([adsetRaw({ adset_id: '52520956981987', campaign_id: null, stat_date: '2026-07-04' })])
check('matched with no campaign_id at all', bare.valid.length, 1)
check('routed to the right tracked row', bare.valid[0].tracked_campaign_id, 'tc-adset-bare')
// And it still matches once the agent starts echoing campaign_id back, because
// the campaign id was never part of the key.
const bareWithCtx = run([adsetRaw({ adset_id: '52520956981987', campaign_id: '6987812298183', stat_date: '2026-07-04' })])
check('still matches once campaign_id is echoed back', bareWithCtx.valid.length, 1)
check('to the SAME tracked row — identity did not move',
  bareWithCtx.valid[0].tracked_campaign_id, 'tc-adset-bare')
// A wrong campaign id must not break matching either: it is not the identity.
const bareWrongCtx = run([adsetRaw({ adset_id: '52520956981987', campaign_id: '999999', stat_date: '2026-07-04' })])
check('a wrong campaign_id does not break the match', bareWrongCtx.valid.length, 1)

console.log('\n--- an ad set that is not tracked is rejected ---')
const unknownAdset = run([adsetRaw({ adset_id: '99999999999' })])
check('rejected', [unknownAdset.valid.length, unknownAdset.rejected.length], [0, 1])
checkTrue('reason names the ad set, not just the campaign',
  unknownAdset.rejected[0].reason.includes('No tracked ad set'))

console.log('\n--- an adset_id sent for a campaign-tracked row is rejected ---')
// The mirror image: tracking is whole-campaign, but the agent narrowed to an
// ad set. Accepting it would write one ad set's numbers as the campaign's.
const strayAdset = run([raw({ adset_id: '55555555555' })])
check('rejected', [strayAdset.valid.length, strayAdset.rejected.length], [0, 1])

console.log('\n--- campaign-level tracking still works untouched ---')
check('no adset_id, campaign-tracked → matches', run([raw()]).valid[0].tracked_campaign_id, CAMPAIGN_ID)
check('an undefined adset_id is the same as absent',
  run([raw({ adset_id: undefined })]).valid[0].tracked_campaign_id, CAMPAIGN_ID)
check('an empty-string adset_id is the same as absent',
  run([raw({ adset_id: '' })]).valid[0].tracked_campaign_id, CAMPAIGN_ID)

console.log('\n--- ad-set launch date is enforced independently of the campaign ---')
// The campaign started 2026-05-22; Molly's ad set started 2026-07-29. A date
// in between is real for the campaign and impossible for the moment.
check('2026-07-28 rejected (before the AD SET launched)',
  run([adsetRaw({ stat_date: '2026-07-28' })]).rejected.length, 1)
check('2026-07-29 accepted (launch day)',
  run([adsetRaw({ stat_date: '2026-07-29' })]).valid.length, 1)

console.log('\n--- campaignKey: one account + ONE identity id ---')
check('account + identity', campaignKey('act_1', '2'), 'act_1|2')
check('trims', campaignKey(' act_1 ', ' 2 '), 'act_1|2')
// Meta object ids are globally unique, so a campaign id and an ad set id are
// different values from the same namespace and can never collide.
checkTrue('a campaign id and an ad set id key differently',
  campaignKey('act_1', '6987812298183') !== campaignKey('act_1', '52530393856787'))
check('identityOf prefers the ad set',
  identityOf({ meta_adset_id: '525', meta_campaign_id: '698' }), '525')
check('identityOf falls back to the campaign',
  identityOf({ meta_adset_id: null, meta_campaign_id: '698' }), '698')

console.log('\n--- coercion primitives ---')
check("toNumber('1,234.5')", toNumber('1,234.5'), 1234.5)
check("toNumber('2.45%') strips the sign", toNumber('2.45%'), 2.45)
check("toNumber('null') → null", toNumber('null'), null)
check("toNumber('') → null", toNumber(''), null)
check('toNumber(NaN) → null', toNumber(NaN), null)
check('toNumber(true) → null', toNumber(true), null)
check('toNumber([]) → null', toNumber([]), null)
check("toInt('19.6') rounds", toInt('19.6'), 20)
check('isIsoDate ok', isIsoDate('2026-08-04'), true)
check('isIsoDate rejects Feb 31', isIsoDate('2026-02-31'), false)
check('isIsoDate rejects a timestamp', isIsoDate('2026-08-04T00:00:00Z'), false)
check('withinTolerance is RELATIVE', withinTolerance(1.01, 1.0), true)
check('...so a small absolute gap on a small value fails', withinTolerance(0.07, 0.05), false)

console.log('\n--- payload envelope ---')
check('non-object body rejected', 'error' in parsePayload('nope'), true)
check('missing rows rejected', 'error' in parsePayload({ reported_at: '2026-08-05T11:00:00Z' }), true)
check('empty rows rejected', 'error' in parsePayload({ rows: [] }), true)
check('oversized payload rejected', 'error' in parsePayload({ rows: new Array(5001).fill({}) }), true)
const okPayload = parsePayload({ reported_at: '2026-08-05T11:00:00Z', rows: [raw()] })
check('valid payload parses', 'payload' in okPayload, true)
check('reported_at normalized to ISO',
  'payload' in okPayload ? okPayload.payload.reported_at : null, '2026-08-05T11:00:00.000Z')
const noStamp = parsePayload({ rows: [raw()] })
checkTrue('missing reported_at falls back to the server clock, not to garbage',
  'payload' in noStamp && !Number.isNaN(Date.parse(noStamp.payload.reported_at)))
const badStamp = parsePayload({ reported_at: 'yesterday-ish', rows: [raw()] })
checkTrue('unparseable reported_at also falls back rather than being stored',
  'payload' in badStamp && !Number.isNaN(Date.parse(badStamp.payload.reported_at)))

// ---------------------------------------------------------------------------
// Upsert semantics — the restatement fix
// ---------------------------------------------------------------------------
//
// The DB enforces this with uq_campaign_daily_results_campaign_date. Simulated
// here against the same key so a regression in the key we build surfaces
// before deploy, not three weeks into a doubling daily table.

console.log('\n--- upsert on (tracked_campaign_id, stat_date) ---')

function applyUpsert(store: Map<string, ValidatedRow>, rows: ValidatedRow[]): Map<string, ValidatedRow> {
  for (const r of rows) store.set(`${r.tracked_campaign_id}|${r.stat_date}`, r)
  return store
}

const store = new Map<string, ValidatedRow>()
applyUpsert(store, run([raw()]).valid)
check('first pull writes 1 row', store.size, 1)

// Same day pulled again, unchanged — the daily re-pull of the trailing window.
applyUpsert(store, run([raw()]).valid)
check('IDENTICAL re-pull is still 1 row (idempotent, not appended)', store.size, 1)

// Meta restates: a week later Aug 4 reports higher revenue.
applyUpsert(store, run([raw({ revenue: 1400, roas: 5.6, cpa: 12.5 })]).valid)
check('restated re-pull is STILL 1 row', store.size, 1)
check('...and the new number won (update in place)',
  store.get(`${CAMPAIGN_ID}|2026-08-04`)?.revenue_cents, 140_000)

// A different day is a different row — the key must not collapse the campaign.
applyUpsert(store, run([raw({ stat_date: '2026-08-03', spend: 200, revenue: 400, purchases: 8, roas: 2, cpa: 25, landing_page_views: 700, lp_conversion_rate: 1.1429 })]).valid)
check('a second date adds a second row', store.size, 2)

console.log('\n--- restatement re-derives the totals it should ---')
// Before: 4 days totalling $2,250 revenue. After Aug 4 restates $1,000 → $1,400.
const restated = FIXTURE.map(r => r.stat_date === '2026-08-04' ? { ...r, revenue_cents: 140_000 } : r)
const restatedTotals = sumResults(restated)
check('revenue rises to $2,650', formatCents(restatedTotals.revenue_cents), '$2,650')
check('spend is unchanged at $700', formatCents(restatedTotals.spend_cents), '$700')
check('ROAS re-derives to 3.7857', restatedTotals.roas, 3.7857)
check('still 4 days — a restatement adds NO rows', restatedTotals.days, 4)

console.log('\n--- manual rows are the repair path ---')
// The agent must never overwrite a human correction. The endpoint enforces
// this by filtering source='manual' out of the upsert target set; here we
// assert the shape that filter depends on.
const manualRow = day({ stat_date: '2026-08-04', source: 'manual', revenue_cents: 999_999 })
const protectedIds = new Set([manualRow.stat_date])
const incoming = run([raw({ revenue: 1000 })]).valid
const writable = incoming.filter(r => !protectedIds.has(r.stat_date))
check('an agent row targeting a manual date is filtered out', writable.length, 0)
check('a manual row keeps source=manual', manualRow.source, 'manual')

console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`)
process.exit(fails === 0 ? 0 : 1)
