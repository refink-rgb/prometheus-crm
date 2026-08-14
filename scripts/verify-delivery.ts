// Checks for the moment-delivery math in src/lib/delivery.ts. No test framework
// in this repo, so this is a standalone script:
//
//   node --import jiti/register scripts/verify-delivery.ts
//
// (jiti rather than --experimental-strip-types, which verify-billing.ts uses:
// delivery.ts imports normalizeStage from ./types, and node's bare stripper
// can't resolve an extensionless TS specifier. jiti ships with Next.)
//
// Exits non-zero on any failure. The fixture mirrors the shape of Giovane's
// tracking sheet — a client that started 5/13, hit 2/2 in its first cycle,
// closed the second short, and caught up in the third — because the cases
// worth protecting are the ones that sheet made visible:
//
//   * A moment counts in the cycle it SHIPPED in, not the one it was aimed at,
//     so a closed month can never heal itself retroactively.
//   * An unshipped moment stays in its planned cycle, so the gap is visible
//     before it becomes a miss.
//   * Waived/void cycles buy no moments at all.

import { buildDeliveryRows, buildLiveDateMap, MOMENTS_PER_CYCLE } from '../src/lib/delivery'
import type { CycleRow, MomentRow } from '../src/lib/delivery'

const BRAND = 'brand-a'
const TODAY = '2026-08-20'

const cycles: CycleRow[] = [
  { brand_id: BRAND, period_start: '2026-05-13', period_end: '2026-06-12', due_date: '2026-05-13', status: 'paid' },
  { brand_id: BRAND, period_start: '2026-06-13', period_end: '2026-07-12', due_date: '2026-06-13', status: 'paid' },
  { brand_id: BRAND, period_start: '2026-07-13', period_end: '2026-08-12', due_date: '2026-07-13', status: 'paid' },
  { brand_id: BRAND, period_start: '2026-08-13', period_end: '2026-09-12', due_date: '2026-08-13', status: 'scheduled' },
]

const live = (id: string) => ({ id, brand_id: BRAND, is_complete: false, lp_stage: 'live', creatives_stage: 'live' })
const wip  = (id: string) => ({ id, brand_id: BRAND, is_complete: false, lp_stage: 'in_progress', creatives_stage: 'brief' })

const moments: MomentRow[] = [
  // Cycle 1 (May 13 – Jun 12): both shipped on time.
  { ...live('m1'), name: 'May · M1', due_date: '2026-05-20', marketing_moment: 1 },
  { ...live('m2'), name: 'May · M2', due_date: '2026-06-05', marketing_moment: 2 },
  // Cycle 2 (Jun 13 – Jul 12): one shipped, one still in flight past the
  // cycle end, and one that slipped OUT of the cycle entirely (m5 below).
  { ...live('m3'), name: 'Jun · M1', due_date: '2026-06-25', marketing_moment: 1 },
  { ...wip('m4'),  name: 'Jun · M2', due_date: '2026-07-05', marketing_moment: 2 },
  // Aimed at cycle 2 (due Jul 10) but shipped Jul 25 — must land in cycle 3
  // and be flagged late, leaving cycle 2 short.
  { ...live('m5'), name: 'Jun · M3 (slipped)', due_date: '2026-07-10', marketing_moment: 2 },
  // Cycle 3: shipped Aug 2, ahead of its Aug 5 target.
  { ...live('m6'), name: 'Jul · M1', due_date: '2026-08-05', marketing_moment: 1 },
  // Cycle 4 (Aug 13 – Sep 12, still open): only one briefed against a quota
  // of two — structurally short, not merely unfinished.
  { ...wip('m7'),  name: 'Aug · M1', due_date: '2026-08-28', marketing_moment: 1 },
]

const liveDates = buildLiveDateMap(
  [
    { card_id: 'm1', created_at: '2026-05-20T18:00:00Z' },
    { card_id: 'm2', created_at: '2026-06-05T18:00:00Z' },
    { card_id: 'm3', created_at: '2026-06-25T18:00:00Z' },
    { card_id: 'm5', created_at: '2026-07-25T18:00:00Z' },
    // Bounced back to revisions and relaunched — the LATER date is the real
    // ship date, so the map must keep the max, not the first seen.
    { card_id: 'm6', created_at: '2026-08-02T18:00:00Z' },
    { card_id: 'm6', created_at: '2026-07-30T18:00:00Z' },
  ],
  iso => iso.slice(0, 10),
)

const summary = buildDeliveryRows({
  brandNames: new Map([[BRAND, 'American Clothing']]),
  cycles,
  moments,
  liveDates,
  monthKeys: ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08'],
  today: TODAY,
})

let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}: ${JSON.stringify(actual)}` +
    (ok ? '' : ` (expected ${JSON.stringify(expected)})`)
  )
}

const row = summary.rows[0]
const byMonth = new Map(row.cells.map(c => [c.monthKey, c]))
const cell = (k: string) => byMonth.get(k)!

check('quota per cycle', MOMENTS_PER_CYCLE, 2)
check('Apr (pre-start) has no cycle', cell('2026-04').state, 'no_cycle')
check('May cycle met', [cell('2026-05').delivered, cell('2026-05').owed, cell('2026-05').state], [2, 2, 'met'])
check('Jun cycle closed short', [cell('2026-06').delivered, cell('2026-06').owed, cell('2026-06').state], [1, 2, 'behind'])
check('Jun keeps the never-shipped moment', cell('2026-06').moments.map(m => m.id), ['m3', 'm4'])
check('slipped moment counts in Jul, not Jun', cell('2026-07').moments.map(m => m.id), ['m6', 'm5'])
check('Jul cycle met by catch-up', [cell('2026-07').delivered, cell('2026-07').state], [2, 'met'])
check('slipped moment flagged late', cell('2026-07').moments.find(m => m.id === 'm5')!.late, true)
check('early moment not flagged late', cell('2026-07').moments.find(m => m.id === 'm6')!.late, false)
check('relaunch keeps the LATER ship date', liveDates.get('m6'), '2026-08-02')
check('Aug cycle open and under-briefed', [cell('2026-08').delivered, cell('2026-08').inFlight, cell('2026-08').state], [0, 1, 'at_risk'])
check('open cycle not counted as closed', cell('2026-08').closed, false)
check('owed across closed cycles', row.owedToDate, 6)
check('delivered across closed cycles', row.deliveredToDate, 5)
check('balance is one moment in debt', row.balance, -1)
check('moments owed', summary.momentsOwed, 1)
check('clients behind', summary.clientsBehind, 1)
check('current-month progress', [summary.deliveredThisMonth, summary.owedThisMonth], [0, 2])

// Waived/void cycles were never really sold, so they buy no moments — a client
// whose every cycle is waived drops out of the tracker entirely.
const waived = buildDeliveryRows({
  brandNames: new Map([[BRAND, 'American Clothing']]),
  cycles: cycles.map(c => ({ ...c, status: 'waived' as const })),
  moments, liveDates, monthKeys: ['2026-06'], today: TODAY,
})
check('all-waived client drops out', waived.rows.length, 0)

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
