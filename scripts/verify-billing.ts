// Checks for the billing date math in src/lib/billing.ts. No test framework in
// this repo, so this is a standalone script:
//
//   node --experimental-strip-types scripts/verify-billing.ts
//
// Exits non-zero on any failure. The fixture is the real signed-contract sheet
// (Giovane, 2026-07-31) with TODAY pinned to 2026-07-31, so the expected
// totals — 40 invoices due, $80,500 billed to date, $37,000 MRR — are the
// numbers that should show on /financials the day it was seeded.
//
// Worth re-running after touching anniversary/clamping logic. The Tea with Tae
// case (anchor 31) is the one that breaks under naive month arithmetic.

import {
  generatePeriods,
  anniversaryDate,
  derivePeriodState,
  monthEnd,
  monthKeyOf,
  shiftMonthKey,
  parseMoneyToCents,
  formatCents,
  type SubscriptionShape,
} from '../src/lib/billing.ts'

const SHEET: Array<[string, string, number]> = [
  ['All American Clothing', '2026-05-13', 200000],
  ['PixieLane', '2026-05-15', 200000],
  ['Mad Viking', '2026-05-18', 200000],
  ['Skinit', '2026-05-18', 200000],
  ['All Citizens', '2026-05-20', 200000],
  ['Noble', '2026-05-28', 200000],
  ['Strength Shop Europe', '2026-05-29', 200000],
  ['Tea with Tae', '2026-05-31', 200000],
  ['WOW Sports', '2026-06-02', 200000],
  ['Cosi Care', '2026-06-03', 200000],
  ['Cookt', '2026-06-03', 200000],
  ['The Conscious Bar', '2026-06-22', 250000],
  ['Esas Beauty', '2026-06-22', 150000],
  ['Obnoxious Golf', '2026-06-24', 200000],
  ['Contour Design', '2026-06-24', 200000],
  ['Mikokos', '2026-07-30', 250000],
  ['Ofir Beauty', '2026-07-28', 200000],
  ['Naboso', '2026-08-03', 250000],
]

const TODAY = '2026-07-31'
const HORIZON = monthEnd(shiftMonthKey(monthKeyOf(TODAY), 1))

function subFor(name: string, start: string, cents: number): SubscriptionShape {
  return {
    id: name, brand_id: name, amount_cents: cents, start_date: start,
    anchor_day: Number(start.slice(8, 10)), status: 'active',
    paused_from: null, paused_until: null, ended_at: null,
  }
}

let fails = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) fails++
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${ok ? '' : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`)
}

console.log('--- month-end anchor clamping (Tea with Tae, anchor 31) ---')
check('period 0 → 5/31', anniversaryDate('2026-05-31', 31, 0), '2026-05-31')
check('period 1 → 6/30 (clamped)', anniversaryDate('2026-05-31', 31, 1), '2026-06-30')
check('period 2 → 7/31 (snaps back, NOT 7/30)', anniversaryDate('2026-05-31', 31, 2), '2026-07-31')
check('period 9 → 2027-02-28 (short month)', anniversaryDate('2026-05-31', 31, 9), '2027-02-28')
check('leap year Feb 29', anniversaryDate('2028-01-31', 31, 1), '2028-02-29')
check('year rollover', anniversaryDate('2026-12-15', 15, 1), '2027-01-15')

console.log('\n--- invoices due to date, per client (as of 2026-07-31) ---')
let dueToDateCount = 0
let dueToDateCents = 0
let totalMrr = 0
for (const [name, start, cents] of SHEET) {
  const periods = generatePeriods(subFor(name, start, cents), HORIZON)
  const due = periods.filter(p => p.due_date <= TODAY)
  dueToDateCount += due.length
  dueToDateCents += due.reduce((s, p) => s + p.amount_cents, 0)
  totalMrr += cents
  console.log(`  ${name.padEnd(24)} ${due.length} due  [${due.map(p => p.due_date.slice(5)).join(', ') || '—'}]`)
}

console.log('\n--- totals ---')
check('MRR = $37,000', formatCents(totalMrr), '$37,000')
check('invoices due to date = 40', dueToDateCount, 40)
check('billed to date = $80,500', formatCents(dueToDateCents), '$80,500')

console.log('\n--- period_end has no gaps or overlaps (AAC) ---')
const aac = generatePeriods(subFor('AAC', '2026-05-13', 200000), HORIZON)
check('period 0 covers 5/13–6/12', [aac[0].period_start, aac[0].period_end], ['2026-05-13', '2026-06-12'])
check('period 1 starts the day after', aac[1].period_start, '2026-06-13')

console.log('\n--- derived states ---')
check('unpaid, due 3 days ago → due', derivePeriodState({ status: 'scheduled', due_date: '2026-07-28' }, TODAY), 'due')
check('unpaid, due 18 days ago → overdue', derivePeriodState({ status: 'scheduled', due_date: '2026-07-13' }, TODAY), 'overdue')
check('unpaid, due next week → upcoming', derivePeriodState({ status: 'scheduled', due_date: '2026-08-07' }, TODAY), 'upcoming')
check('paid stays paid', derivePeriodState({ status: 'paid', due_date: '2026-05-13' }, TODAY), 'paid')

console.log('\n--- churn: history survives, forward revenue stops ---')
const churned = { ...subFor('Churned', '2026-05-13', 200000), ended_at: '2026-07-01' }
const cp = generatePeriods(churned, HORIZON)
check('only 5/13 + 6/13 generated', cp.map(p => p.due_date), ['2026-05-13', '2026-06-13'])

console.log('\n--- pause: window suppressed, indexes keep their offset ---')
const paused = { ...subFor('Paused', '2026-05-13', 200000), paused_from: '2026-06-01', paused_until: '2026-07-01' }
const pp = generatePeriods(paused, HORIZON)
check('June skipped', pp.map(p => p.due_date), ['2026-05-13', '2026-07-13', '2026-08-13'])
check('indexes keep month offset (gap at 1)', pp.map(p => p.period_index), [0, 2, 3])

const openEnded = { ...subFor('Paused', '2026-05-13', 200000), paused_from: '2026-06-01', paused_until: null }
check('open-ended pause stops everything after', generatePeriods(openEnded, HORIZON).map(p => p.due_date), ['2026-05-13'])

console.log('\n--- money parsing ---')
check("'2,500' → 250000", parseMoneyToCents('2,500'), 250000)
check("'$2500.50' → 250050", parseMoneyToCents('$2500.50'), 250050)
check("'abc' → null", parseMoneyToCents('abc'), null)
check("'' → null", parseMoneyToCents(''), null)

console.log('\n--- future start date generates nothing before it ---')
check('Naboso has 0 due as of today',
  generatePeriods(subFor('Naboso', '2026-08-03', 250000), HORIZON).filter(p => p.due_date <= TODAY).length, 0)

console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`)
process.exit(fails === 0 ? 0 : 1)
