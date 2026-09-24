import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { canEdit } from '@/lib/permissions'
import ResultsTable, { type ResultsTableRow } from '@/components/ResultsTable'
import { fetchLpDailyAll, fetchAccountDailyAll } from '@/lib/results-queries'
import {
  sumFunnel,
  deriveFunnelKpis,
  restOfAccount,
  shareOfAccountPct,
  formatCents,
  type LpTracking,
  type FunnelDailyRow,
  type FunnelKpis,
} from '@/lib/results'

// The simplified Results view (Lucas, Sep 23 2026): one table row per tracked
// landing page, each KPI shown against the REST of that page's ad account —
// the same comparison the per-project Results tab makes, rolled up. The old
// campaign-card overview lives on at /results/campaigns. All fetching and
// math happens here; ResultsTable (client) only filters and renders.
//
// Reads every tracked page's full daily history plus the account series.
// ~70 trackings × ~90 days is small, but give it the same headroom as the
// campaign view so a cold read never trips the function timeout.
export const maxDuration = 60

interface TrackingRow extends LpTracking {
  projects: { id: string; name: string } | null
  brands: { id: string; name: string } | null
}

export default async function ResultsPage() {
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) redirect('/')

  const { data: trackingRaw, error: trackingErr } = await supabase
    .from('lp_tracking')
    .select('id, project_id, brand_id, meta_ad_account_id, lp_url, launched_on, ended_on, created_at, projects(id, name), brands(id, name)')

  // 42P01 = table doesn't exist; migrations here are hand-run in the Supabase
  // SQL editor, so name the file instead of rendering a broken page.
  if (trackingErr?.code === '42P01') return <SetupNotice />

  const trackings = (trackingRaw ?? []) as unknown as TrackingRow[]

  const launched = trackings.filter(t => t.launched_on !== null)
  const accountIds = [...new Set(launched.map(t => t.meta_ad_account_id))]
  const minSince = launched.reduce(
    (min, t) => (t.launched_on! < min ? t.launched_on! : min),
    '9999-12-31',
  )

  const [lpDaily, accountDaily] = await Promise.all([
    fetchLpDailyAll(supabase, trackings.map(t => t.id)),
    accountIds.length > 0 && minSince !== '9999-12-31'
      ? fetchAccountDailyAll(supabase, accountIds, minSince)
      : Promise.resolve([]),
  ])

  const lpByTracking = new Map<string, FunnelDailyRow[]>()
  for (const row of lpDaily) {
    const list = lpByTracking.get(row.lp_tracking_id)
    if (list) list.push(row)
    else lpByTracking.set(row.lp_tracking_id, [row])
  }
  const accountByAcct = new Map<string, FunnelDailyRow[]>()
  for (const row of accountDaily) {
    const list = accountByAcct.get(row.meta_ad_account_id)
    if (list) list.push(row)
    else accountByAcct.set(row.meta_ad_account_id, [row])
  }

  const rows: ResultsTableRow[] = trackings.map(t => {
    const lpRows = lpByTracking.get(t.id) ?? []
    const lpTotals = sumFunnel(lpRows)

    // Window the shared account series to THIS tracking's live window, same
    // rule as the project tab: the comparison must cover the same days.
    let rest: FunnelKpis | null = null
    let sharePct: number | null = null
    if (t.launched_on && lpRows.length > 0) {
      const acctRows = (accountByAcct.get(t.meta_ad_account_id) ?? []).filter(r =>
        r.stat_date >= t.launched_on! && (!t.ended_on || r.stat_date <= t.ended_on))
      if (acctRows.length > 0) {
        const acctTotals = sumFunnel(acctRows)
        rest = deriveFunnelKpis(restOfAccount(acctTotals, lpTotals).totals)
        sharePct = shareOfAccountPct(lpTotals.spend_cents, acctTotals.spend_cents)
      }
    }

    // Collapse the daily rows into the two maxes the freshness stamp reads,
    // so the client isn't shipped thousands of rows to compute a badge.
    let freshness: { stat_date: string; reported_at: string } | null = null
    for (const r of lpRows) {
      if (!freshness) freshness = { stat_date: r.stat_date, reported_at: r.reported_at }
      else {
        if (r.stat_date > freshness.stat_date) freshness.stat_date = r.stat_date
        if (r.reported_at > freshness.reported_at) freshness.reported_at = r.reported_at
      }
    }

    return {
      id: t.id,
      brand: t.brands?.name ?? 'Unknown brand',
      title: t.projects?.name ?? t.lp_url.replace(/^https?:\/\/(www\.)?/, ''),
      href: t.projects ? `/preview/project/${t.projects.id}` : null,
      launchedOn: t.launched_on,
      endedOn: t.ended_on,
      hasData: lpRows.length > 0,
      days: lpTotals.days,
      spendCents: lpTotals.spend_cents,
      revenueCents: lpTotals.revenue_cents,
      sharePct,
      lp: deriveFunnelKpis(lpTotals),
      rest,
      freshness,
    }
  })

  // Pages with data first, biggest spenders on top; still-detecting pages
  // trail alphabetically so the table stays readable at 70 rows.
  rows.sort((a, b) => {
    if (a.hasData !== b.hasData) return a.hasData ? -1 : 1
    if (a.hasData) return b.spendCents - a.spendCents
    return a.brand.localeCompare(b.brand)
  })

  const withData = rows.filter(r => r.hasData)
  const totalSpend = withData.reduce((s, r) => s + r.spendCents, 0)
  const totalRevenue = withData.reduce((s, r) => s + r.revenueCents, 0)
  const nowMs = new Date().getTime()

  return (
    <div style={{ padding: 'var(--space-6) 32px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap', marginBottom: 'var(--space-5)' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 'var(--space-2)' }}>
            Results
          </h1>
          <p style={{ fontSize: 'var(--text-base)', color: 'var(--text-muted)', lineHeight: 1.6 }}>
            {trackings.length === 0
              ? 'One row per tracked landing page, compared against the rest of its ad account.'
              : <>
                  {withData.length} of {trackings.length} tracked page{trackings.length === 1 ? '' : 's'} reporting
                  {' · '}{formatCents(totalSpend)} spend · {formatCents(totalRevenue)} revenue
                  {' · '}each KPI vs the rest of that page&apos;s ad account, 7-day-click
                </>}
          </p>
        </div>
        <Link href="/results/campaigns" style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none', whiteSpace: 'nowrap' }}>
          Campaign view →
        </Link>
      </div>

      {trackings.length === 0 ? (
        <EmptyState />
      ) : (
        <ResultsTable rows={rows} nowMs={nowMs} />
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <div style={{
      background: 'var(--surface-1)',
      border: '1px dashed var(--border-strong)',
      borderRadius: 12,
      padding: '24px 28px',
      color: 'var(--text-muted)',
      fontSize: 13,
      lineHeight: 1.7,
      maxWidth: 640,
    }}>
      <strong style={{ color: 'var(--text-primary)' }}>No landing pages are being tracked yet.</strong>
      <p style={{ marginTop: 8 }}>
        Open a project&apos;s <strong>Results</strong> tab and start tracking — pick the brand&apos;s
        ad account and the engine discovers the page&apos;s ads, its launch date, and pulls daily
        results from Meta on its own.
      </p>
    </div>
  )
}

function SetupNotice() {
  return (
    <div style={{ padding: 'var(--space-6) 32px 40px' }}>
      <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 'var(--space-4)' }}>
        Results
      </h1>
      <div style={{
        background: 'var(--surface-1)',
        border: '1px dashed var(--border-strong)',
        borderRadius: 12,
        padding: '24px 28px',
        color: 'var(--text-muted)',
        fontSize: 13,
        lineHeight: 1.7,
        maxWidth: 640,
      }}>
        <strong style={{ color: 'var(--text-primary)' }}>The LP results tables don&apos;t exist yet.</strong>
        <p style={{ marginTop: 8 }}>
          Run <code style={{ fontFamily: 'monospace', fontSize: 12 }}>supabase/migrations/20260915_add_lp_results.sql</code>{' '}
          in the Supabase SQL editor, then reload. Migrations in this repo are applied by hand,
          so this page can appear before its schema does.
        </p>
      </div>
    </div>
  )
}
