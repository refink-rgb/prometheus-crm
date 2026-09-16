'use client'

// The client link's view of the Results tab — rendered on /review/[token]
// ONLY when projects.results_client_visible is true (the "push to client"
// button on the internal tab). Read-only: the tiles and charts, none of the
// matched-ads management.
//
// Reuses the internal tab's tile/chart components so the number the client
// quotes back on a call is the number the team sees.

import { useMemo } from 'react'
import {
  sumFunnel, deriveFunnelKpis, restOfAccount, shareOfAccountPct, safeRoas,
  formatCents, formatCentsCompact, formatPercent, formatRoas, shortDateLabel,
  type FunnelDailyRow,
} from '@/lib/results'
import { ResultsTile, ResultsCompareTile, ResultsChartPair, ResultsTileGroup } from '@/components/ProjectResultsPanel'

export default function ClientResultsSection({
  lpDaily,
  accountDaily,
}: {
  lpDaily: FunnelDailyRow[]
  accountDaily: FunnelDailyRow[]
}) {
  const { lpTotals, lpKpis, restKpis, sharePct, revenueSharePct, chartData, dataThrough } = useMemo(() => {
    const lpTotals = sumFunnel(lpDaily)
    const accountTotals = sumFunnel(accountDaily)
    const rest = restOfAccount(accountTotals, lpTotals)
    const sorted = [...lpDaily].sort((a, b) => a.stat_date.localeCompare(b.stat_date))
    // Cumulative ROAS for the line, daily in the tooltip — same reasoning as
    // the internal tab (a tiny-spend outlier day must not bend the chart).
    let cumSpend = 0
    let cumRevenue = 0
    const chartData: Array<{ label: string; spend: number; roas: number | null; roasDaily: number | null }> = []
    for (const r of sorted) {
      cumSpend += r.spend_cents
      cumRevenue += r.revenue_cents
      chartData.push({
        label: shortDateLabel(r.stat_date),
        spend: r.spend_cents / 100,
        roas: safeRoas(cumRevenue, cumSpend),
        roasDaily: safeRoas(r.revenue_cents, r.spend_cents),
      })
    }
    return {
      lpTotals,
      lpKpis: deriveFunnelKpis(lpTotals),
      restKpis: deriveFunnelKpis(rest.totals),
      sharePct: shareOfAccountPct(lpTotals.spend_cents, accountTotals.spend_cents),
      revenueSharePct: shareOfAccountPct(lpTotals.revenue_cents, accountTotals.revenue_cents),
      chartData,
      dataThrough: sorted.length > 0 ? sorted[sorted.length - 1].stat_date : null,
    }
  }, [lpDaily, accountDaily])

  if (lpDaily.length === 0) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <ResultsTileGroup label="Overall">
          <ResultsTile
            label="Spend"
            value={formatCentsCompact(lpTotals.spend_cents)}
            sub={sharePct !== null ? `${formatPercent(sharePct, 1)} of total ad account spend` : 'this landing page’s ads'}
          />
          <ResultsTile
            label="Revenue"
            value={formatCentsCompact(lpTotals.revenue_cents)}
            sub={revenueSharePct !== null ? `${formatPercent(revenueSharePct, 1)} of account revenue · purchase value, 7-day click` : 'purchase conversion value, 7-day click'}
          />
          <ResultsCompareTile label="ROAS" lp={lpKpis} rest={restKpis} metric="roas" goodWhenHigher format={v => formatRoas(v)} />
          <ResultsCompareTile label="AOV" lp={lpKpis} rest={restKpis} metric="aov_cents" goodWhenHigher format={v => formatCents(v)} />
        </ResultsTileGroup>
        <ResultsTileGroup label="Creative">
          <ResultsCompareTile label="CPM" lp={lpKpis} rest={restKpis} metric="cpm_cents" goodWhenHigher={false} format={v => formatCents(v)} />
          <ResultsCompareTile label="CTR" lp={lpKpis} rest={restKpis} metric="ctr" goodWhenHigher format={v => formatPercent(v)} />
            <ResultsCompareTile label="CPC" lp={lpKpis} rest={restKpis} metric="cpc_cents" goodWhenHigher={false} format={v => formatCents(v)} />
        </ResultsTileGroup>
        <ResultsTileGroup label="Landing Page">
          <ResultsCompareTile label="CVR" lp={lpKpis} rest={restKpis} metric="cvr" goodWhenHigher format={v => formatPercent(v)} />
          <ResultsCompareTile label="Click-to-checkout rate" lp={lpKpis} rest={restKpis} metric="click_to_checkout" goodWhenHigher format={v => formatPercent(v, 1)} />
          <ResultsCompareTile label="Checkout conversion rate" lp={lpKpis} rest={restKpis} metric="checkout_cvr" goodWhenHigher format={v => formatPercent(v, 1)} />
        </ResultsTileGroup>
      </div>

      <section className="card" style={{ padding: '18px 20px' }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>
          Spend vs. ROAS, day by day
        </h3>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 'var(--space-4)' }}>
          This landing page&apos;s ads only. &ldquo;Rest of account&rdquo; above compares against
          everything else running in the same ad account over the same period.
        </p>
        <ResultsChartPair data={chartData} />
      </section>

      {dataThrough && (
        <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          Data through {shortDateLabel(dataThrough)} · Meta attributed, 7-day click · updated daily
        </p>
      )}
    </div>
  )
}
