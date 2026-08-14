import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { canEdit } from '@/lib/permissions'
import { getCachedProfiles } from '@/lib/profiles'
import { easternToday } from '@/lib/eastern'
import type { BillingPeriod, BillingSubscription, Brand, PipelineStatus } from '@/lib/types'
import { PIPELINE_STATUS_LABELS, PIPELINE_STATUS_ORDER, isJobEditor } from '@/lib/types'
import {
  derivePeriodState,
  formatCents,
  isCollected,
  isOutstanding,
  monthEnd,
  monthKeyOf,
  monthLabel,
  monthStart,
  shiftMonthKey,
} from '@/lib/billing'
import { buildDeliveryRows, type InvoiceRow, type MomentRow } from '@/lib/delivery'
import BillingMonthTable, { type BillingRow } from '@/components/financials/BillingMonthTable'
import DeliveryTracker from '@/components/financials/DeliveryTracker'
import ScheduleManager, { type ScheduleRow } from '@/components/financials/ScheduleManager'

const BD_COLORS: Record<PipelineStatus, string> = {
  intro_contact:  'var(--bd-intro)',
  discovery_call: 'var(--bd-discovery)',
  offer_prep:     'var(--bd-offer)',
  active:         'var(--bd-active)',
}

type BrandLite = Pick<Brand, 'id' | 'name' | 'is_active' | 'is_trial' | 'monthly_retainer' | 'start_date' | 'pipeline_status'>

// Migrations here are hand-run in the Supabase SQL editor, so the code can
// land before the tables exist. 42P01 = undefined_table: show the operator
// what to run instead of a 500.
const UNDEFINED_TABLE = '42P01'

export default async function FinancialsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!(await canEdit(user?.email))) {
    redirect('/')
  }

  // LP/Creative editors can use the CRM but shouldn't see financial figures.
  const profiles = await getCachedProfiles()
  const myProfile = profiles.find(p => p.email === user?.email?.toLowerCase()) ?? null
  if (isJobEditor(myProfile)) {
    redirect('/')
  }

  const today = easternToday()
  const { month } = await searchParams
  const activeMonth = /^\d{4}-\d{2}$/.test(month ?? '') ? month! : monthKeyOf(today)

  const [{ data: brandRows }, subsResult, periodsResult, momentsResult] = await Promise.all([
    supabase
      .from('brands')
      .select('id, name, is_active, is_trial, monthly_retainer, start_date, pipeline_status'),
    supabase
      .from('billing_subscriptions')
      .select('id, brand_id, amount_cents, start_date, anchor_day, status, paused_from, paused_until, ended_at'),
    // ~18 clients × 12 months ≈ 200 rows/year. Small enough to aggregate in
    // memory; revisit with a SQL rollup if this ever passes a few thousand.
    supabase
      .from('billing_periods')
      .select('id, subscription_id, brand_id, period_start, period_end, due_date, amount_cents, status, paid_at, paid_amount_cents, reference')
      .order('due_date'),
    // Delivery tracker input. Completed projects are included on purpose —
    // shipped work is exactly what the tracker counts.
    supabase
      .from('projects')
      .select('id, brand_id, name, due_date, marketing_moment, is_complete, lp_stage, creatives_stage'),
  ])

  const migrationMissing =
    subsResult.error?.code === UNDEFINED_TABLE || periodsResult.error?.code === UNDEFINED_TABLE

  const allBrands = (brandRows ?? []) as BrandLite[]
  const brandName = new Map(allBrands.map(b => [b.id, b.name]))

  const subscriptions = (subsResult.data ?? []) as unknown as BillingSubscription[]
  const periods = (periodsResult.data ?? []) as unknown as Array<
    Pick<BillingPeriod, 'id' | 'subscription_id' | 'brand_id' | 'period_start' | 'period_end'
      | 'due_date' | 'amount_cents' | 'status' | 'paid_at' | 'paid_amount_cents' | 'reference'>
  >

  // --- KPIs ----------------------------------------------------------------

  // MRR = what recurs right now. Paused and ended clients are excluded — they
  // aren't billing this month.
  const mrrCents = subscriptions
    .filter(s => s.status === 'active')
    .reduce((sum, s) => sum + s.amount_cents, 0)

  // Collected to date spans EVERY period ever recorded, including churned and
  // deleted-from-active clients. Giovane's rule: churn stops forward revenue,
  // it never rewrites what was already banked. (The old page summed only
  // active clients here, so a churn silently erased their entire history.)
  const collectedToDateCents = periods
    .filter(p => p.status === 'paid')
    .reduce((sum, p) => sum + (p.paid_amount_cents ?? p.amount_cents), 0)

  const outstandingCents = periods
    .filter(p => p.status === 'scheduled' && p.due_date <= today)
    .reduce((sum, p) => sum + p.amount_cents, 0)

  // A real forecast: what is actually scheduled to bill next month, which
  // already accounts for pauses, churn, and clients whose first invoice hasn't
  // landed yet. The old page just printed MRR again.
  const nextMonthKey = shiftMonthKey(monthKeyOf(today), 1)
  const nextMonthStart = monthStart(nextMonthKey)
  const nextMonthEnd = monthEnd(nextMonthKey)
  const forecastCents = periods
    .filter(p => p.status === 'scheduled' && p.due_date >= nextMonthStart && p.due_date <= nextMonthEnd)
    .reduce((sum, p) => sum + p.amount_cents, 0)

  // --- Month view ----------------------------------------------------------

  const activeMonthStart = monthStart(activeMonth)
  const activeMonthEnd = monthEnd(activeMonth)
  const monthRows: BillingRow[] = periods
    .filter(p => p.due_date >= activeMonthStart && p.due_date <= activeMonthEnd)
    .map(p => ({
      periodId: p.id,
      brandId: p.brand_id,
      brandName: brandName.get(p.brand_id) ?? 'Unknown client',
      dueDate: p.due_date,
      amountCents: p.amount_cents,
      status: p.status,
      state: derivePeriodState({ status: p.status, due_date: p.due_date }, today),
      paidAt: p.paid_at,
      paidAmountCents: p.paid_amount_cents,
      reference: p.reference,
    }))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.brandName.localeCompare(b.brandName))

  // --- Moment delivery -----------------------------------------------------

  // Lifetime, not windowed: the quota comes from every invoice ever paid, so
  // the month cursor above deliberately doesn't move this section.
  const deliverySummary = buildDeliveryRows({
    brandNames: brandName,
    invoices: periods.map<InvoiceRow>(p => ({
      brand_id: p.brand_id,
      due_date: p.due_date,
      status: p.status,
    })),
    moments: (momentsResult.data ?? []) as unknown as MomentRow[],
    today,
  })

  // --- Schedules -----------------------------------------------------------

  const bySubscription = new Map<string, typeof periods>()
  for (const p of periods) {
    const list = bySubscription.get(p.subscription_id)
    if (list) list.push(p)
    else bySubscription.set(p.subscription_id, [p])
  }

  const scheduleRows: ScheduleRow[] = subscriptions
    .map(s => {
      const mine = bySubscription.get(s.id) ?? []
      const states = mine.map(p => ({ p, state: derivePeriodState({ status: p.status, due_date: p.due_date }, today) }))
      return {
        id: s.id,
        brandId: s.brand_id,
        brandName: brandName.get(s.brand_id) ?? 'Unknown client',
        amountCents: s.amount_cents,
        startDate: s.start_date,
        status: s.status,
        pausedFrom: s.paused_from,
        pausedUntil: s.paused_until,
        endedAt: s.ended_at,
        collectedCents: states
          .filter(({ state }) => isCollected(state))
          .reduce((sum, { p }) => sum + (p.paid_amount_cents ?? p.amount_cents), 0),
        outstandingCents: states
          .filter(({ state }) => isOutstanding(state))
          .reduce((sum, { p }) => sum + p.amount_cents, 0),
        unpaidCount: states.filter(({ state }) => isOutstanding(state)).length,
      }
    })
    .sort((a, b) =>
      Number(a.status === 'cancelled') - Number(b.status === 'cancelled') ||
      b.amountCents - a.amountCents ||
      a.brandName.localeCompare(b.brandName))

  // BD pipeline value grouped by stage (unchanged — still derived from brands).
  const bdStages = PIPELINE_STATUS_ORDER.map(status => {
    const brandsInStage = allBrands.filter(b => b.pipeline_status === status)
    const potentialMRR = brandsInStage.reduce((sum, b) => sum + (b.monthly_retainer ?? 0), 0)
    return { status, brands: brandsInStage, potentialMRR }
  })

  const activeCount = subscriptions.filter(s => s.status === 'active').length
  const pausedCount = subscriptions.filter(s => s.status === 'paused').length

  return (
    <div style={{ padding: 'var(--space-8) var(--space-8) var(--space-10)' }}>
      <div style={{ marginBottom: 'var(--space-5)' }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: 4 }}>
          Financials
        </h1>
        <p style={{ fontSize: 'var(--text-base)', color: 'var(--text-muted)' }}>
          {monthLabel(monthKeyOf(today))} · {activeCount} active client{activeCount !== 1 ? 's' : ''}
          {pausedCount > 0 ? ` · ${pausedCount} paused` : ''}
        </p>
      </div>

      {migrationMissing && (
        <div style={{
          padding: 'var(--space-4) var(--space-5)', marginBottom: 'var(--space-6)', borderRadius: 10,
          background: 'color-mix(in srgb, var(--warning) 10%, var(--surface-1))',
          border: '1px solid color-mix(in srgb, var(--warning) 35%, var(--border))',
          fontSize: 'var(--text-base)', color: 'var(--text-primary)', lineHeight: 1.6,
        }}>
          <strong>Billing tables not found.</strong> Run{' '}
          <code>supabase/migrations/20260731_add_billing.sql</code> in the Supabase SQL editor,
          then <code>supabase/seed_billing.sql</code> to load the signed-contract sheet. Everything
          below stays empty until then.
        </div>
      )}

      {/* KPI strip */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
        gap: 'var(--space-3)', marginBottom: 'var(--space-8)',
      }}>
        <FinKPI
          label="Monthly Recurring Revenue"
          value={formatCents(mrrCents)}
          sub={`${activeCount} active client${activeCount !== 1 ? 's' : ''}`}
          tone="accent"
        />
        <FinKPI
          label="Collected to Date"
          value={formatCents(collectedToDateCents)}
          sub="every payment ever recorded"
        />
        <FinKPI
          label="Outstanding"
          value={formatCents(outstandingCents)}
          sub={outstandingCents > 0 ? 'due and unpaid' : 'all caught up'}
          tone={outstandingCents > 0 ? 'danger' : 'default'}
        />
        <FinKPI
          label={`${monthLabel(nextMonthKey)} Forecast`}
          value={formatCents(forecastCents)}
          sub="invoices already scheduled"
        />
      </div>

      {/* Month billing control */}
      <section style={{ marginBottom: 36 }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 'var(--space-4)', gap: 'var(--space-3)',
        }}>
          <h2 style={{
            fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text-muted)',
            letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0,
          }}>
            Payments — {monthLabel(activeMonth)}
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <MonthNavLink month={shiftMonthKey(activeMonth, -1)} label="‹" title="Previous month" />
            {activeMonth !== monthKeyOf(today) && (
              <MonthNavLink month={monthKeyOf(today)} label="Today" />
            )}
            <MonthNavLink month={shiftMonthKey(activeMonth, 1)} label="›" title="Next month" />
          </div>
        </div>
        <BillingMonthTable rows={monthRows} monthLabel={monthLabel(activeMonth)} />
      </section>

      {/* Moment delivery against the retainer */}
      <section style={{ marginBottom: 36 }}>
        <DeliveryTracker summary={deliverySummary} />
      </section>

      {/* Schedule control */}
      <section style={{ marginBottom: 36 }}>
        <ScheduleManager rows={scheduleRows} today={today} />
      </section>

      {/* BD Pipeline Value */}
      <section>
        <h2 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 'var(--space-4)' }}>
          BD Pipeline Value
        </h2>
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 160px', gap: 'var(--space-4)', padding: 'var(--space-2) var(--space-5)', borderBottom: '1px solid var(--border)', background: 'var(--surface-raised)' }}>
            {['Stage', 'Brands', 'Potential MRR'].map(col => (
              <span key={col} style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{col}</span>
            ))}
          </div>
          {bdStages.map((s, i) => {
            const color = BD_COLORS[s.status]
            return (
              <div key={s.status} className="pipeline-row" style={{
                display: 'grid',
                gridTemplateColumns: '1fr 100px 160px',
                gap: 'var(--space-4)',
                padding: 'var(--space-3) var(--space-5)',
                borderBottom: i < bdStages.length - 1 ? '1px solid var(--border)' : 'none',
                alignItems: 'center',
              }}>
                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color, letterSpacing: '0.04em' }}>
                  {PIPELINE_STATUS_LABELS[s.status]}
                </span>
                <span style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {s.brands.length}
                </span>
                <span style={{ fontSize: 'var(--text-base)', fontWeight: 700, color: s.potentialMRR > 0 ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                  {'$' + s.potentialMRR.toLocaleString('en-US')}
                </span>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function MonthNavLink({ month, label, title }: { month: string; label: string; title?: string }) {
  return (
    <Link
      href={`/financials?month=${month}`}
      title={title}
      className="btn-secondary btn-sm"
      style={{ minWidth: 32, justifyContent: 'center' }}
    >
      {label}
    </Link>
  )
}

function FinKPI({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string
  value: string
  sub?: string
  tone?: 'default' | 'accent' | 'danger'
}) {
  const accentVar = tone === 'accent' ? 'var(--accent)' : tone === 'danger' ? 'var(--danger)' : null
  const bg = accentVar ? `color-mix(in srgb, ${accentVar} 8%, var(--surface-1))` : 'var(--surface-1)'
  const border = accentVar ? `color-mix(in srgb, ${accentVar} 30%, var(--border))` : 'var(--border)'
  const color = accentVar ?? 'var(--text-primary)'
  return (
    <div style={{
      background: bg, border: `1px solid ${border}`, borderRadius: 10,
      padding: 'var(--space-4) var(--space-5)',
    }}>
      <div style={{
        fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 'var(--space-2)',
      }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 6 }}>{sub}</div>
      )}
    </div>
  )
}
