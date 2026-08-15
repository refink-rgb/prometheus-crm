// Checks for the moment-delivery math in src/lib/delivery.ts. No test framework
// in this repo, so this is a standalone script:
//
//   node --import jiti/register scripts/verify-delivery.ts
//
// (jiti rather than --experimental-strip-types, which verify-billing.ts uses:
// delivery.ts imports normalizeStage from ./types, and node's bare stripper
// can't resolve an extensionless TS specifier. jiti ships with Next.)
//
// Exits non-zero on any failure.
//
// The rule under test is one line — paid invoices × 2 = moments owed, minus
// moments delivered = the balance — so what's worth pinning down is which
// invoices and which projects are allowed to count:
//
//   * only invoices actually PAID buy moments (not scheduled, waived, or void)
//   * a project is delivered if it's archived complete OR live on both tracks,
//     including legacy rows still holding the retired 'done' stage
//   * no date is involved anywhere, so a moment that slipped months still pays
//     down the same debt

import { buildDeliveryRows, isMomentDelivered, MOMENTS_PER_INVOICE } from '../src/lib/delivery'
import type { InvoiceRow, MomentRow } from '../src/lib/delivery'

const TODAY = '2026-08-20'

const inv = (brand: string, due: string, status: InvoiceRow['status']): InvoiceRow =>
  ({ brand_id: brand, due_date: due, status })

const project = (
  id: string, brand: string, name: string,
  stages: Partial<Pick<MomentRow, 'is_complete' | 'lp_stage' | 'creatives_stage'>>,
): MomentRow => ({
  id, brand_id: brand, name, due_date: '2026-06-01', marketing_moment: 1,
  is_complete: false, lp_stage: 'brief', creatives_stage: 'brief', ...stages,
})

const invoices: InvoiceRow[] = [
  // Client A: 3 paid, 1 due and unpaid. Buys 6 moments.
  inv('a', '2026-05-13', 'paid'), inv('a', '2026-06-13', 'paid'), inv('a', '2026-07-13', 'paid'),
  inv('a', '2026-08-13', 'scheduled'),
  // Client B: 2 paid, plus a waived and a void one that must buy nothing, plus
  // a future invoice that isn't due yet. Buys 4 moments.
  inv('b', '2026-05-18', 'paid'), inv('b', '2026-06-18', 'paid'),
  inv('b', '2026-07-18', 'waived'), inv('b', '2026-08-18', 'void'),
  inv('b', '2026-09-18', 'scheduled'),
  // Client C has never paid — must not appear at all.
  inv('c', '2026-08-01', 'scheduled'),
  // Client D: 2 paid, nothing in flight — a real gap with nothing behind it.
  inv('d', '2026-06-10', 'paid'), inv('d', '2026-07-10', 'paid'),
]

const moments: MomentRow[] = [
  // Client A: 4 delivered by various routes, 1 still in flight. Owes 6 → -2.
  project('a1', 'a', 'live both tracks',   { lp_stage: 'live', creatives_stage: 'live' }),
  project('a2', 'a', 'archived complete',  { is_complete: true, lp_stage: 'live', creatives_stage: 'live' }),
  project('a3', 'a', "legacy 'done'",      { lp_stage: 'done', creatives_stage: 'done' }),
  project('a4', 'a', 'archived, odd stage',{ is_complete: true, lp_stage: 'revisions', creatives_stage: 'live' }),
  project('a5', 'a', 'still in progress',  { lp_stage: 'in_progress', creatives_stage: 'ready' }),
  // Half-shipped is NOT shipped.
  project('a6', 'a', 'lp live only',       { lp_stage: 'live', creatives_stage: 'client_review' }),
  // Client B: 5 delivered against 4 owed → one ahead.
  project('b1', 'b', 'live', { lp_stage: 'live', creatives_stage: 'live' }),
  project('b2', 'b', 'live', { lp_stage: 'live', creatives_stage: 'live' }),
  project('b3', 'b', 'live', { lp_stage: 'live', creatives_stage: 'live' }),
  project('b4', 'b', 'live', { lp_stage: 'live', creatives_stage: 'live' }),
  project('b5', 'b', 'live', { lp_stage: 'live', creatives_stage: 'live' }),
  // Client C has work but has paid nothing.
  project('c1', 'c', 'live', { lp_stage: 'live', creatives_stage: 'live' }),
  // Client D: 4 owed, 1 delivered, nothing briefed → 3 still to create.
  project('d1', 'd', 'live', { lp_stage: 'live', creatives_stage: 'live' }),
]

const summary = buildDeliveryRows({
  brandNames: new Map([
    ['a', 'American Clothing'], ['b', 'Tea with Tae'],
    ['c', 'Never Paid Co'], ['d', 'Nothing Briefed Co'],
  ]),
  invoices,
  moments,
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

const byBrand = new Map(summary.rows.map(r => [r.brandId, r]))
const a = byBrand.get('a')!
const b = byBrand.get('b')!

check('moments per invoice', MOMENTS_PER_INVOICE, 2)

// --- What counts as delivered ----------------------------------------------
check('both tracks live is delivered', isMomentDelivered(moments[0]), true)
check('archived complete is delivered', isMomentDelivered(moments[1]), true)
check("legacy 'done' is delivered", isMomentDelivered(moments[2]), true)
check('archived wins over a stale stage', isMomentDelivered(moments[3]), true)
check('mid-pipeline is not delivered', isMomentDelivered(moments[4]), false)
check('one track live is not delivered', isMomentDelivered(moments[5]), false)

// --- Which invoices buy moments --------------------------------------------
check('A: paid invoices', a.invoicesPaid, 3)
check('A: owed is paid × 2', a.momentsOwed, 6)
check('A: due-but-unpaid counted separately', a.invoicesUnpaid, 1)
check('B: waived and void buy nothing', b.invoicesPaid, 2)
check('B: owed', b.momentsOwed, 4)
check('B: a future invoice is not yet unpaid', b.invoicesUnpaid, 0)
check('a client who never paid is not listed', byBrand.has('c'), false)

// --- The balance ------------------------------------------------------------
// balance = owed − delivered − in flight. Briefed work is spoken for, so what
// is left is the work that still has to be created.
const d = byBrand.get('d')!

check('A: delivered', a.momentsDelivered, 4)
check('A: in flight', a.momentsInFlight, 2)
check('A: in-flight work closes the gap', a.balance, 0)
check('D: a gap with nothing briefed stays a gap', [d.momentsOwed, d.momentsDelivered, d.momentsInFlight, d.balance], [4, 1, 0, 3])
check('B: more delivered than paid for', [b.momentsDelivered, b.momentsInFlight, b.balance], [5, 0, -1])
check('biggest gap sorts first', summary.rows.map(r => r.brandId), ['d', 'a', 'b'])

// --- Roll-up ----------------------------------------------------------------
check('total paid invoices', summary.invoicesPaid, 7)
check('total owed', summary.momentsOwed, 14)
check('total delivered', summary.momentsDelivered, 10)
check('total in flight', summary.momentsInFlight, 2)
check("a client's surplus does not cancel another's gap", summary.momentsStillOwed, 3)
check('clients behind', summary.clientsBehind, 1)

// Nothing paid anywhere → nothing owed, and no rows to show.
const unpaid = buildDeliveryRows({
  brandNames: new Map([['a', 'American Clothing']]),
  invoices: invoices.map(i => ({ ...i, status: 'scheduled' as const })),
  moments,
  today: TODAY,
})
check('no paid invoices means no rows', unpaid.rows.length, 0)
check('no paid invoices means nothing owed', unpaid.momentsStillOwed, 0)

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
