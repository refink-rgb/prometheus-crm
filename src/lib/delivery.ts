// Moment delivery tracking — "how many moments do I owe this client?"
//
// One rule, and everything falls out of it:
//
//     every invoice the client PAID buys 2 moments.
//
// So the debt is `invoices_paid × 2 − moments_delivered`. Nothing else feeds
// it. Deliberately NOT part of the calculation:
//
//   * WHEN a moment shipped. Delivery is a lifetime count against a lifetime
//     quota, so a moment that slipped from July into August still pays down
//     the same debt. This is what makes the number trustworthy — the CRM has
//     no reliable ship date for anything completed before the event log
//     started (2026-07-17), and bucketing by month forced that missing date
//     to matter.
//
//   * Invoices that are merely scheduled, waived, or void. The client hasn't
//     paid for those, so they buy nothing. They're counted separately and
//     shown as context, never folded into what's owed.
//
// Nothing here calls `new Date()` — callers pass Eastern today, same contract
// as billing.ts and eastern.ts.
//
// No schema change: derived from `billing_periods` and `projects`.

import { normalizeStage } from './types'
import type { StoredPeriodStatus } from './billing'

// What one paid invoice buys. Every client is on the same 2-moment retainer
// today; if that ever splits per contract, this is the single place it needs
// to become a per-subscription column.
export const MOMENTS_PER_INVOICE = 2

// --- Inputs -----------------------------------------------------------------

export interface MomentRow {
  id: string
  brand_id: string
  name: string
  due_date: string | null
  marketing_moment: number | null
  is_complete: boolean
  lp_stage: string
  creatives_stage: string
}

export interface InvoiceRow {
  brand_id: string
  due_date: string
  status: StoredPeriodStatus
}

// --- Derived shapes ---------------------------------------------------------

export interface DeliveryRow {
  brandId: string
  brandName: string
  // Invoices actually paid, and the quota they bought.
  invoicesPaid: number
  momentsOwed: number
  // Invoices already due but not yet paid. Context only — they buy nothing
  // until the money lands, but they say what the quota is about to become.
  invoicesUnpaid: number
  momentsDelivered: number
  // Briefed but not shipped. Not delivery, but it says whether the gap is
  // already being worked or hasn't been started.
  momentsInFlight: number
  // Positive = moments still to deliver. Negative = delivered ahead of what
  // has been paid for.
  balance: number
}

export interface DeliverySummary {
  rows: DeliveryRow[]
  invoicesPaid: number
  momentsOwed: number
  momentsDelivered: number
  // Total moments still to deliver, across every client with a gap.
  momentsStillOwed: number
  clientsBehind: number
}

// --- Delivery detection -----------------------------------------------------

// A moment is delivered once BOTH tracks are live. `is_complete` also counts:
// markProjectComplete forces both stages to 'live', and archived rows written
// before that are still genuinely shipped work. normalizeStage keeps the
// retired 'done' stage (removed 2026-08-02) readable on legacy rows.
export function isMomentDelivered(m: MomentRow): boolean {
  if (m.is_complete) return true
  return normalizeStage(m.lp_stage) === 'live' && normalizeStage(m.creatives_stage) === 'live'
}

// --- Assembly ---------------------------------------------------------------

export function buildDeliveryRows(input: {
  brandNames: Map<string, string>
  invoices: InvoiceRow[]
  moments: MomentRow[]
  today: string
}): DeliverySummary {
  const { brandNames, invoices, moments, today } = input

  const paidByBrand = new Map<string, number>()
  const unpaidByBrand = new Map<string, number>()

  for (const inv of invoices) {
    if (inv.status === 'paid') {
      paidByBrand.set(inv.brand_id, (paidByBrand.get(inv.brand_id) ?? 0) + 1)
      continue
    }
    // Waived and void were never collected and never will be — they buy
    // nothing and they aren't outstanding either. Only a scheduled invoice
    // whose date has arrived is money genuinely still expected.
    if (inv.status === 'scheduled' && inv.due_date <= today) {
      unpaidByBrand.set(inv.brand_id, (unpaidByBrand.get(inv.brand_id) ?? 0) + 1)
    }
  }

  const deliveredByBrand = new Map<string, number>()
  const inFlightByBrand = new Map<string, number>()
  for (const m of moments) {
    const bucket = isMomentDelivered(m) ? deliveredByBrand : inFlightByBrand
    bucket.set(m.brand_id, (bucket.get(m.brand_id) ?? 0) + 1)
  }

  // Rows come from who has paid — a brand with no paid invoice has bought no
  // moments, so there is nothing to be behind on.
  const rows: DeliveryRow[] = [...paidByBrand.entries()].map(([brandId, invoicesPaid]) => {
    const momentsOwed = invoicesPaid * MOMENTS_PER_INVOICE
    const momentsDelivered = deliveredByBrand.get(brandId) ?? 0
    return {
      brandId,
      brandName: brandNames.get(brandId) ?? 'Unknown client',
      invoicesPaid,
      momentsOwed,
      invoicesUnpaid: unpaidByBrand.get(brandId) ?? 0,
      momentsDelivered,
      momentsInFlight: inFlightByBrand.get(brandId) ?? 0,
      balance: momentsOwed - momentsDelivered,
    }
  })

  // Biggest debt first — this view exists to surface who is owed work.
  rows.sort((a, b) => b.balance - a.balance || a.brandName.localeCompare(b.brandName))

  return {
    rows,
    invoicesPaid: rows.reduce((sum, r) => sum + r.invoicesPaid, 0),
    momentsOwed: rows.reduce((sum, r) => sum + r.momentsOwed, 0),
    momentsDelivered: rows.reduce((sum, r) => sum + r.momentsDelivered, 0),
    momentsStillOwed: rows.reduce((sum, r) => sum + Math.max(0, r.balance), 0),
    clientsBehind: rows.filter(r => r.balance > 0).length,
  }
}
