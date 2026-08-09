'use server'

// Billing server actions — the /financials control surface.
//
// Kept out of actions.ts (already 1400+ lines and owned by the Production
// Cycle), same reasoning as offer-actions.ts.
//
// Two invariants hold across every action here:
//   1. A recorded payment is never destroyed by an automated path. Pausing,
//      ending, or deleting a schedule only ever removes periods still sitting
//      at status 'scheduled'. Anything paid/waived/void is history.
//   2. Period regeneration is idempotent — the unique index
//      (subscription_id, period_index) means a double-fire is a no-op upsert,
//      not a second invoice for the same month.

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { canEdit } from '@/lib/permissions'
import { getCachedProfiles } from '@/lib/profiles'
import { isJobEditor } from '@/lib/types'
import { easternToday } from '@/lib/eastern'
import {
  generatePeriods,
  monthEnd,
  monthKeyOf,
  shiftMonthKey,
  parseMoneyToCents,
  type StoredPeriodStatus,
  type SubscriptionShape,
} from '@/lib/billing'

// Periods are always materialized through the end of NEXT month, so the month
// view can page one month forward and still show real rows. Matches the
// horizon in supabase/seed_billing.sql.
function generationHorizon(todayIso: string): string {
  return monthEnd(shiftMonthKey(monthKeyOf(todayIso), 1))
}

// /financials is gated twice: canEdit() like every mutating action, plus a
// job-editor check — LP/creative editors use the CRM but must not see or
// touch money (same rule the page itself enforces).
async function requireFinanceUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  const profiles = await getCachedProfiles()
  const profile = profiles.find(p => p.email === user.email?.toLowerCase()) ?? null
  if (isJobEditor(profile)) throw new Error('Not authorized.')

  return { supabase, user }
}

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

const SUBSCRIPTION_COLUMNS =
  'id, brand_id, amount_cents, start_date, anchor_day, status, paused_from, paused_until, ended_at'

async function loadSubscription(supabase: SupabaseClient, id: string): Promise<SubscriptionShape> {
  const { data, error } = await supabase
    .from('billing_subscriptions')
    .select(SUBSCRIPTION_COLUMNS)
    .eq('id', id)
    .single()
  if (error || !data) throw new Error('Billing schedule not found.')
  return data as unknown as SubscriptionShape
}

// Bring one subscription's periods in line with its current settings.
//
// Adds any missing period, and removes periods that should no longer exist
// (suppressed by a pause window or by churn) — but ONLY where status is still
// 'scheduled'. A paid month inside a newly-drawn pause window stays put; the
// money was collected and deleting it would corrupt collected-to-date.
export async function syncPeriodsFor(
  supabase: SupabaseClient,
  sub: SubscriptionShape,
  todayIso: string,
): Promise<{ created: number; removed: number }> {
  const expected = sub.status === 'cancelled'
    ? generatePeriods({ ...sub, ended_at: sub.ended_at ?? todayIso }, generationHorizon(todayIso))
    : generatePeriods(sub, generationHorizon(todayIso))

  const { data: existingRows, error: readErr } = await supabase
    .from('billing_periods')
    .select('id, period_index, status')
    .eq('subscription_id', sub.id)
  if (readErr) throw new Error(`Could not read billing periods: ${readErr.message}`)

  const existing = (existingRows ?? []) as Array<{ id: string; period_index: number; status: StoredPeriodStatus }>
  const existingIndexes = new Set(existing.map(p => p.period_index))
  const expectedIndexes = new Set(expected.map(p => p.period_index))

  const toInsert = expected
    .filter(p => !existingIndexes.has(p.period_index))
    .map(p => ({
      subscription_id: sub.id,
      brand_id: sub.brand_id,
      period_index: p.period_index,
      period_start: p.period_start,
      period_end: p.period_end,
      due_date: p.due_date,
      amount_cents: p.amount_cents,
      status: 'scheduled' as const,
    }))

  if (toInsert.length > 0) {
    const { error } = await supabase
      .from('billing_periods')
      .upsert(toInsert, { onConflict: 'subscription_id,period_index', ignoreDuplicates: true })
    if (error) throw new Error(`Could not create billing periods: ${error.message}`)
  }

  // Invariant 1 — only unpaid rows are ever swept.
  const toRemove = existing
    .filter(p => !expectedIndexes.has(p.period_index) && p.status === 'scheduled')
    .map(p => p.id)

  if (toRemove.length > 0) {
    const { error } = await supabase.from('billing_periods').delete().in('id', toRemove)
    if (error) throw new Error(`Could not remove billing periods: ${error.message}`)
  }

  return { created: toInsert.length, removed: toRemove.length }
}

function revalidateFinancials() {
  revalidatePath('/financials')
}

// ---------------------------------------------------------------------------
// Payment check-off — the core of the month view
// ---------------------------------------------------------------------------

export async function markPeriodPaid(
  periodId: string,
  opts?: { paidAt?: string; amountCents?: number; reference?: string },
): Promise<void> {
  const { supabase, user } = await requireFinanceUser()

  const { data: period, error: readErr } = await supabase
    .from('billing_periods')
    .select('id, amount_cents')
    .eq('id', periodId)
    .single()
  if (readErr || !period) throw new Error('Billing period not found.')

  const { error } = await supabase
    .from('billing_periods')
    .update({
      status: 'paid',
      paid_at: opts?.paidAt ?? easternToday(),
      // Defaults to the full invoiced amount; a partial payment passes its own.
      paid_amount_cents: opts?.amountCents ?? period.amount_cents,
      reference: opts?.reference ?? null,
      marked_by: user.id,
      marked_at: new Date().toISOString(),
    })
    .eq('id', periodId)
  if (error) throw new Error(`Could not mark paid: ${error.message}`)

  revalidateFinancials()
}

// Undo — back to unpaid, clearing the payment record entirely.
export async function markPeriodUnpaid(periodId: string): Promise<void> {
  const { supabase, user } = await requireFinanceUser()

  const { error } = await supabase
    .from('billing_periods')
    .update({
      status: 'scheduled',
      paid_at: null,
      paid_amount_cents: null,
      reference: null,
      marked_by: user.id,
      marked_at: new Date().toISOString(),
    })
    .eq('id', periodId)
  if (error) throw new Error(`Could not undo: ${error.message}`)

  revalidateFinancials()
}

// 'waived' = comped on purpose (shows in history, collects $0).
// 'void'   = billed in error (excluded from both collected and outstanding).
export async function setPeriodStatus(periodId: string, status: 'waived' | 'void' | 'scheduled'): Promise<void> {
  const { supabase, user } = await requireFinanceUser()

  const { error } = await supabase
    .from('billing_periods')
    .update({
      status,
      paid_at: null,
      paid_amount_cents: null,
      marked_by: user.id,
      marked_at: new Date().toISOString(),
    })
    .eq('id', periodId)
  if (error) throw new Error(`Could not update period: ${error.message}`)

  revalidateFinancials()
}

export async function updatePeriodAmount(periodId: string, rawAmount: string): Promise<void> {
  const { supabase } = await requireFinanceUser()

  const cents = parseMoneyToCents(rawAmount)
  if (cents === null || cents < 0) throw new Error('Enter a valid amount, e.g. 2000 or 2,500.')

  const { error } = await supabase
    .from('billing_periods')
    .update({ amount_cents: cents })
    .eq('id', periodId)
  if (error) throw new Error(`Could not update amount: ${error.message}`)

  revalidateFinancials()
}

// ---------------------------------------------------------------------------
// Schedule control — pause / resume / end / delete
// ---------------------------------------------------------------------------

export async function pauseSubscription(
  subscriptionId: string,
  pausedFrom: string,
  pausedUntil?: string | null,
): Promise<void> {
  const { supabase } = await requireFinanceUser()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pausedFrom)) throw new Error('Pause start date is required.')
  if (pausedUntil && pausedUntil <= pausedFrom) throw new Error('Pause end must be after the pause start.')

  const { error } = await supabase
    .from('billing_subscriptions')
    .update({ status: 'paused', paused_from: pausedFrom, paused_until: pausedUntil || null })
    .eq('id', subscriptionId)
  if (error) throw new Error(`Could not pause billing: ${error.message}`)

  // Sweeps unpaid invoices that fall inside the new pause window.
  const sub = await loadSubscription(supabase, subscriptionId)
  await syncPeriodsFor(supabase, sub, easternToday())

  revalidateFinancials()
}

export async function resumeSubscription(subscriptionId: string): Promise<void> {
  const { supabase } = await requireFinanceUser()

  const { error } = await supabase
    .from('billing_subscriptions')
    .update({ status: 'active', paused_from: null, paused_until: null, ended_at: null })
    .eq('id', subscriptionId)
  if (error) throw new Error(`Could not resume billing: ${error.message}`)

  // Re-materializes any month the pause had suppressed.
  const sub = await loadSubscription(supabase, subscriptionId)
  await syncPeriodsFor(supabase, sub, easternToday())

  revalidateFinancials()
}

// Churn. Stops future revenue; collected history is untouched — that's the
// whole distinction from deleteSubscription() below.
export async function endSubscription(subscriptionId: string, endedAt?: string): Promise<void> {
  const { supabase } = await requireFinanceUser()
  const effective = endedAt && /^\d{4}-\d{2}-\d{2}$/.test(endedAt) ? endedAt : easternToday()

  const { error } = await supabase
    .from('billing_subscriptions')
    .update({ status: 'cancelled', ended_at: effective, paused_from: null, paused_until: null })
    .eq('id', subscriptionId)
  if (error) throw new Error(`Could not end billing: ${error.message}`)

  const sub = await loadSubscription(supabase, subscriptionId)
  await syncPeriodsFor(supabase, sub, easternToday())

  revalidateFinancials()
}

// Hard delete — schedule AND all its history, including payments (ON DELETE
// CASCADE). For a schedule created in error. Churn should use
// endSubscription() instead; the UI says so at the confirm step.
export async function deleteSubscription(subscriptionId: string): Promise<void> {
  const { supabase } = await requireFinanceUser()

  const { error } = await supabase
    .from('billing_subscriptions')
    .delete()
    .eq('id', subscriptionId)
  if (error) throw new Error(`Could not delete billing schedule: ${error.message}`)

  revalidateFinancials()
}

// A price change applies going forward only: already-issued invoices keep the
// amount that was actually billed.
export async function updateSubscriptionAmount(subscriptionId: string, rawAmount: string): Promise<void> {
  const { supabase } = await requireFinanceUser()

  const cents = parseMoneyToCents(rawAmount)
  if (cents === null || cents <= 0) throw new Error('Enter a valid amount, e.g. 2000 or 2,500.')

  const { error } = await supabase
    .from('billing_subscriptions')
    .update({ amount_cents: cents })
    .eq('id', subscriptionId)
  if (error) throw new Error(`Could not update retainer: ${error.message}`)

  const today = easternToday()
  const { error: periodErr } = await supabase
    .from('billing_periods')
    .update({ amount_cents: cents })
    .eq('subscription_id', subscriptionId)
    .eq('status', 'scheduled')
    .gt('due_date', today)
  if (periodErr) throw new Error(`Could not update upcoming invoices: ${periodErr.message}`)

  // Keep brands.monthly_retainer (used by the dashboard + BD pipeline) in step.
  const sub = await loadSubscription(supabase, subscriptionId)
  await supabase.from('brands').update({ monthly_retainer: cents / 100 }).eq('id', sub.brand_id)

  revalidateFinancials()
}

// ---------------------------------------------------------------------------
// Create + backfill
// ---------------------------------------------------------------------------

export async function createSubscription(formData: FormData): Promise<void> {
  const { supabase, user } = await requireFinanceUser()

  const brandId = (formData.get('brand_id') as string)?.trim()
  const startDate = (formData.get('start_date') as string)?.trim()
  const cents = parseMoneyToCents((formData.get('amount') as string) ?? '')

  if (!brandId) throw new Error('Pick a client.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error('Start date is required.')
  if (cents === null || cents <= 0) throw new Error('Enter a valid monthly amount, e.g. 2000.')

  const { data, error } = await supabase
    .from('billing_subscriptions')
    .insert({
      brand_id: brandId,
      amount_cents: cents,
      start_date: startDate,
      anchor_day: Number(startDate.slice(8, 10)),
      status: 'active',
      created_by: user.id,
    })
    .select(SUBSCRIPTION_COLUMNS)
    .single()

  if (error) {
    if (error.code === '23505') throw new Error('That client already has a billing schedule.')
    throw new Error(`Could not create billing schedule: ${error.message}`)
  }

  await syncPeriodsFor(supabase, data as unknown as SubscriptionShape, easternToday())
  await supabase
    .from('brands')
    .update({ monthly_retainer: cents / 100, start_date: startDate })
    .eq('id', brandId)

  revalidateFinancials()
}

// Manual catch-up for every schedule. The daily cron does this too — this is
// the button for when you don't want to wait until tomorrow (e.g. right after
// seeding, or after correcting a start date).
export async function syncAllBillingPeriods(): Promise<{ created: number; removed: number }> {
  const { supabase } = await requireFinanceUser()
  const today = easternToday()

  const { data, error } = await supabase
    .from('billing_subscriptions')
    .select(SUBSCRIPTION_COLUMNS)
  if (error) throw new Error(`Could not load billing schedules: ${error.message}`)

  let created = 0
  let removed = 0
  for (const sub of (data ?? []) as unknown as SubscriptionShape[]) {
    const result = await syncPeriodsFor(supabase, sub, today)
    created += result.created
    removed += result.removed
  }

  revalidateFinancials()
  return { created, removed }
}
