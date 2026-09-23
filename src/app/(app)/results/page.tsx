import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { canEdit } from '@/lib/permissions'
import FreshnessStamp from '@/components/FreshnessStamp'
import { fetchLpDailyAll, fetchAccountDailyAll } from '@/lib/results-queries'
import {
  sumFunnel,
  deriveFunnelKpis,
  restOfAccount,
  shareOfAccountPct,
  formatCents,
  formatCentsCompact,
  formatRoas,
  formatPercent,
  shortDateLabel,
  type LpTracking,
  type FunnelDailyRow,
  type FunnelKpis,
} from '@/lib/results'

// The simplified Results view (Lucas, Sep 23 2026): one table row per tracked
// landing page, each KPI shown against the REST of that page's ad account —
// the same comparison the per-project Results tab makes, rolled up. The old
// campaign-card overview lives on at /results/campaigns.
//
// Reads every tracked page's full daily history plus the account series.
// ~70 trackings × ~90 days is small, but give it the same headroom as the
// campaign view so a cold read never trips the function timeout.
export const maxDuration = 60

interface TrackingRow extends LpTracking {
  projects: { id: string; name: string } | null
  brands: { id: string; name: string } | null
}

interface PageRow {
  tracking: TrackingRow
  hasData: boolean
  days: number
  spendCents: number
  revenueCents: number
  sharePct: number | null
  lp: FunnelKpis
  rest: FunnelKpis | null
  lpRows: FunnelDailyRow[]
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

  const rows: PageRow[] = trackings.map(t => {
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

    return {
      tracking: t,
      hasData: lpRows.length > 0,
      days: lpTotals.days,
      spendCents: lpTotals.spend_cents,
      revenueCents: lpTotals.revenue_cents,
      sharePct,
      lp: deriveFunnelKpis(lpTotals),
      rest,
      lpRows,
    }
  })

  // Pages with data first, biggest spenders on top; still-detecting pages
  // trail alphabetically so the table stays readable at 70 rows.
  rows.sort((a, b) => {
    if (a.hasData !== b.hasData) return a.hasData ? -1 : 1
    if (a.hasData) return b.spendCents - a.spendCents
    return clientOf(a).localeCompare(clientOf(b))
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
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 980 }}>
              <thead>
                <tr style={{ background: 'var(--surface-raised)' }}>
                  <th style={{ ...TH, textAlign: 'left', minWidth: 220 }}>Landing page</th>
                  <th style={{ ...TH, textAlign: 'left' }}>Launched</th>
                  <th style={TH}>Spend</th>
                  <th style={TH}>Revenue</th>
                  <th style={TH}>ROAS</th>
                  <th style={TH}>CPM</th>
                  <th style={TH}>CTR</th>
                  <th style={TH}>CVR</th>
                  <th style={{ ...TH, textAlign: 'left' }}>Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => <Row key={r.tracking.id} r={r} nowMs={nowMs} />)}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Under each KPI: the <strong>rest of that ad account</strong> over the same days.
            Green = the page beats the rest of the account on that metric (for CPM, cheaper).
            Pages marked “detecting ads” are enrolled but the engine hasn&apos;t matched any ads yet.
          </div>
        </div>
      )}
    </div>
  )
}

function clientOf(r: PageRow): string {
  return r.tracking.brands?.name ?? 'Unknown brand'
}

function Row({ r, nowMs }: { r: PageRow; nowMs: number }) {
  const t = r.tracking
  const live = t.ended_on === null
  const href = t.projects ? `/preview/project/${t.projects.id}` : null
  const title = t.projects?.name ?? t.lp_url.replace(/^https?:\/\/(www\.)?/, '')

  return (
    <tr style={{ borderTop: '1px solid var(--border)', opacity: r.hasData ? 1 : 0.65 }}>
      <td style={{ ...TD, maxWidth: 320 }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{clientOf(r)}</div>
        {href ? (
          <Link href={href} style={{ fontWeight: 600, color: 'var(--text-primary)', textDecoration: 'none' }}>
            {title}
          </Link>
        ) : (
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{title}</span>
        )}
        {r.sharePct !== null && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
            {formatPercent(r.sharePct, 1)} of account spend
          </div>
        )}
      </td>
      <td style={{ ...TD, whiteSpace: 'nowrap' }}>
        {t.launched_on ? (
          <>
            <div>{shortDateLabel(t.launched_on)}</div>
            <div style={{ fontSize: 10, color: live ? 'var(--success)' : 'var(--text-muted)', marginTop: 2 }}>
              {live ? `live · day ${r.days || '–'}` : `ended ${shortDateLabel(t.ended_on!)}`}
            </div>
          </>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>detecting ads…</span>
        )}
      </td>
      <td style={TD_NUM}>{r.hasData ? formatCentsCompact(r.spendCents) : '—'}</td>
      <td style={TD_NUM}>{r.hasData ? formatCentsCompact(r.revenueCents) : '—'}</td>
      <KpiCell value={fmtRoas(r.lp.roas)} rest={fmtRoas(r.rest?.roas ?? null)} verdict={verdict(r.lp.roas, r.rest?.roas ?? null, 'higher')} />
      <KpiCell value={fmtCents(r.lp.cpm_cents)} rest={fmtCents(r.rest?.cpm_cents ?? null)} verdict={verdict(r.lp.cpm_cents, r.rest?.cpm_cents ?? null, 'lower')} />
      <KpiCell value={fmtPct(r.lp.ctr)} rest={fmtPct(r.rest?.ctr ?? null)} verdict={verdict(r.lp.ctr, r.rest?.ctr ?? null, 'higher')} />
      <KpiCell value={fmtPct(r.lp.cvr)} rest={fmtPct(r.rest?.cvr ?? null)} verdict={verdict(r.lp.cvr, r.rest?.cvr ?? null, 'higher')} />
      <td style={{ ...TD, whiteSpace: 'nowrap' }}>
        {r.hasData ? <FreshnessStamp rows={r.lpRows} nowMs={nowMs} /> : <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>—</span>}
      </td>
    </tr>
  )
}

// A KPI cell: the page's own figure, with the rest-of-account figure beneath
// it, colored by whether the page is winning that metric.
function KpiCell({ value, rest, verdict }: { value: string; rest: string; verdict: 'good' | 'bad' | null }) {
  return (
    <td style={TD_NUM}>
      <div style={{
        fontWeight: 600,
        color: verdict === 'good' ? 'var(--success)' : verdict === 'bad' ? 'var(--danger)' : 'var(--text-primary)',
      }}>
        {value}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
        {rest === '—' ? ' ' : `rest ${rest}`}
      </div>
    </td>
  )
}

type Verdict = 'good' | 'bad' | null
function verdict(lp: number | null, rest: number | null, better: 'higher' | 'lower'): Verdict {
  if (lp === null || rest === null) return null
  if (lp === rest) return null
  const lpWins = better === 'higher' ? lp > rest : lp < rest
  return lpWins ? 'good' : 'bad'
}

const fmtRoas = (v: number | null) => (v === null ? '—' : formatRoas(v))
const fmtCents = (v: number | null) => (v === null ? '—' : formatCents(v))
const fmtPct = (v: number | null) => (v === null ? '—' : formatPercent(v))

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

const TH: React.CSSProperties = {
  padding: '10px 14px', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
  textTransform: 'uppercase', color: 'var(--text-muted)', textAlign: 'right', whiteSpace: 'nowrap',
}
const TD: React.CSSProperties = { padding: '10px 14px', textAlign: 'left', verticalAlign: 'top' }
const TD_NUM: React.CSSProperties = {
  padding: '10px 14px', textAlign: 'right', verticalAlign: 'top',
  fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
}
