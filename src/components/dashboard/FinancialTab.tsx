import type { DashboardData } from '@/lib/dashboard/load'
import { oddsBand } from '@/lib/dashboard/ops'
import RevenueUpload from './RevenueUpload'
import { ChurnChart, MonthlyRevenueChart, type RevenueChartMonth } from './RevenueCharts'
import {
  BrandLink, Empty, HBars, Kpi, KpiGrid, MiniTable, Panel, PanelGrid, SectionTitle,
  fmtMoney, fmtPct, monthName,
} from './ui'

export default function FinancialTab({ data }: { data: DashboardData }) {
  const { revenue, upload, today } = data
  const defaultYear = revenue?.months[0] ? Number(revenue.months[0].month.slice(0, 4)) : Number(today.slice(0, 4))

  return (
    <div>
      <RevenueUpload defaultYear={defaultYear} lastUpload={upload} />

      {data.revenueTablesMissing && (
        <div style={{
          padding: 'var(--space-4) var(--space-5)', marginBottom: 'var(--space-6)', borderRadius: 10, lineHeight: 1.6,
          background: 'color-mix(in srgb, var(--warning) 10%, var(--surface-1))',
          border: '1px solid color-mix(in srgb, var(--warning) 35%, var(--border))', fontSize: 'var(--text-base)',
        }}>
          <strong>Revenue tables not found.</strong> Run <code>supabase/migrations/20261102b_revenue_sheet.sql</code> in
          the Supabase SQL editor, then upload the revenue sheet.
        </div>
      )}

      {!revenue ? (
        !data.revenueTablesMissing && <Empty>Upload the revenue sheet to see revenue, churn and forecasts here.</Empty>
      ) : (
        <FinancialBody data={data} />
      )}

      {upload && upload.unmatched.length > 0 && (
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 'var(--space-6)', lineHeight: 1.6 }}>
          Not linked to a CRM brand ({upload.unmatched.length}): {upload.unmatched.join(', ')}. Their revenue counts above,
          but delays, offers and results can&apos;t be tied to them on the other tabs.
        </p>
      )}
    </div>
  )
}

function FinancialBody({ data }: { data: DashboardData }) {
  const revenue = data.revenue!
  const cur = revenue.current
  const prev = revenue.previous
  const next = revenue.next
  const curLabel = monthName(revenue.currentMonth, 'long')

  if (!cur) {
    return <Empty>The uploaded sheet has no column for {curLabel}. Upload a sheet that covers this month.</Empty>
  }

  // Renewal odds, weighted by what each client bills this month.
  const billing = data.concerns.filter(c => c.currentCents > 0)
  const atRisk = billing.filter(c => oddsBand(c.renewalOdds) === 'at_risk')
  const atRiskCents = atRisk.reduce((s, c) => s + c.currentCents, 0)
  const weightTotal = billing.reduce((s, c) => s + c.currentCents, 0)
  const weightedOdds = weightTotal > 0 ? billing.reduce((s, c) => s + c.renewalOdds * c.currentCents, 0) / weightTotal : null

  const vsPrev = prev && prev.revenueCents > 0 ? cur.revenueCents / prev.revenueCents - 1 : null
  const targetPct = cur.targetCents ? cur.revenueCents / cur.targetCents : null

  const chart: RevenueChartMonth[] = revenue.months.map(m => ({
    month: m.month,
    label: monthName(m.month),
    existing: m.existingCents / 100,
    reactivated: m.reactivatedCents / 100,
    newRev: m.newCents / 100,
    target: m.targetCents !== null ? m.targetCents / 100 : null,
    churned: m.churnedCents / 100,
    churnedClients: m.churnedClients.length,
    revenue: m.revenueCents / 100,
    forecast: m.isForecast,
  }))

  const top = [...revenue.clients].filter(c => c.currentCents > 0).sort((a, b) => b.currentCents - a.currentCents).slice(0, 10)
  const leaving = revenue.clients.filter(c => c.currentCents > 0 && next && c.nextCents === 0)
  const lostThisMonth = revenue.clients.filter(c => c.prevCents > 0 && c.currentCents === 0)
  const serviceTotal = Object.values(cur.byService).reduce((a, b) => a + b, 0)

  return (
    <>
      <SectionTitle title={`${curLabel} at a glance`} subtitle="Current month from the latest sheet. Later months are the sheet's forecast." />
      <KpiGrid>
        <Kpi
          label={`${curLabel} revenue`}
          value={fmtMoney(cur.revenueCents)}
          tone="accent"
          sub={<>
            {cur.targetCents ? <>{fmtPct(targetPct)} of {fmtMoney(cur.targetCents)} target · </> : null}
            {vsPrev !== null ? `${vsPrev >= 0 ? '+' : ''}${fmtPct(vsPrev)} vs ${monthName(prev!.month)}` : `${cur.activeClients} clients`}
          </>}
        />
        <Kpi label="Existing revenue" value={fmtMoney(cur.existingCents + cur.reactivatedCents)}
          sub={cur.reactivatedCents > 0 ? `incl. ${fmtMoney(cur.reactivatedCents)} back from pause` : 'billed last month too'} />
        <Kpi label="New revenue" value={fmtMoney(cur.newCents)}
          tone={cur.newCents > 0 ? 'good' : 'default'}
          sub={`${cur.newClients.length} new client${cur.newClients.length === 1 ? '' : 's'}`} />
        <Kpi label="Churned revenue" value={fmtMoney(cur.churnedCents)}
          tone={cur.churnedCents > 0 ? 'bad' : 'default'}
          sub={`${fmtPct(cur.revenueChurnRate, 1)} of last month · ${cur.churnedClients.length} client${cur.churnedClients.length === 1 ? '' : 's'}`} />
        <Kpi label="Net revenue retention" value={fmtPct(cur.netRetention)}
          tone={cur.netRetention !== null && cur.netRetention < 0.9 ? 'warn' : 'default'}
          sub="what last month's clients bill now" />
        <Kpi label="Renewal likelihood" value={weightedOdds !== null ? `${Math.round(weightedOdds)}%` : '—'}
          tone={weightedOdds !== null && weightedOdds < 75 ? 'warn' : 'good'}
          sub="average across clients, weighted by fee" />
        <Kpi label="Revenue at risk" value={fmtMoney(atRiskCents)}
          tone={atRiskCents > 0 ? 'bad' : 'default'}
          sub={`${atRisk.length} client${atRisk.length === 1 ? '' : 's'} under 50% renewal odds`} />
        {next && (
          <Kpi label={`${monthName(next.month, 'long')} forecast`} value={fmtMoney(next.revenueCents)}
            sub={next.targetCents ? `${fmtPct(next.revenueCents / next.targetCents)} of ${fmtMoney(next.targetCents)} target` : `${next.activeClients} clients`} />
        )}
      </KpiGrid>

      <div style={{ marginBottom: 'var(--space-6)' }}>
        <Panel title="Revenue by month" subtitle="Existing, back from pause and new revenue, against the monthly target. Faded bars are forecast.">
          <MonthlyRevenueChart data={chart} />
          <div style={{ marginTop: 'var(--space-4)' }}>
            <MiniTable
              columns={['Month', 'Revenue', 'Target', '% of target', 'New', 'Existing', 'Churned', 'Churn', 'Clients']}
              align={['left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right']}
              rows={revenue.months.map(m => [
                <span key="m" style={{ color: m.isForecast ? 'var(--text-secondary)' : undefined }}>
                  {monthName(m.month)} {m.month.slice(0, 4)}{m.isForecast ? ' · forecast' : m.month === revenue.currentMonth ? ' · now' : ''}
                </span>,
                fmtMoney(m.revenueCents),
                m.targetCents ? fmtMoney(m.targetCents) : '—',
                m.targetCents ? fmtPct(m.revenueCents / m.targetCents) : '—',
                fmtMoney(m.newCents),
                fmtMoney(m.existingCents + m.reactivatedCents),
                m.churnedCents > 0 ? fmtMoney(m.churnedCents) : '—',
                fmtPct(m.revenueChurnRate, 1),
                m.activeClients,
              ])}
            />
          </div>
        </Panel>
      </div>

      <PanelGrid>
        <Panel title="Churn by month" subtitle="Revenue lost from clients or services that stopped billing">
          <ChurnChart data={chart} />
        </Panel>
        <Panel title={`Top clients · ${curLabel}`} subtitle="All services combined">
          {top.length === 0 ? <Empty>No revenue this month.</Empty> : (
            <HBars
              data={top.map(c => ({ key: c.key, label: c.name, value: c.currentCents }))}
              format={fmtMoney}
            />
          )}
        </Panel>
      </PanelGrid>

      <PanelGrid>
        <Panel title={`Revenue by service · ${curLabel}`}>
          {serviceTotal === 0 ? <Empty>No revenue this month.</Empty> : (
            <>
              <div style={{ display: 'flex', height: 14, borderRadius: 4, overflow: 'hidden', gap: 2, marginBottom: 'var(--space-3)' }}>
                {revenue.services.filter(s => cur.byService[s]).map((s, i) => (
                  <div key={s} title={`${s}: ${fmtMoney(cur.byService[s])}`}
                    style={{ flex: cur.byService[s], background: `var(--viz-cat-${(i % 3) + 1})` }} />
                ))}
              </div>
              <MiniTable
                columns={['Service', 'Revenue', 'Share', ...(prev ? [`vs ${monthName(prev.month)}`] : [])]}
                align={['left', 'right', 'right', 'right']}
                rows={revenue.services.filter(s => cur.byService[s] || prev?.byService[s]).map((s, i) => [
                  <span key="s" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: `var(--viz-cat-${(i % 3) + 1})` }} />
                    {s === 'MM' ? 'MM · Marketing Moments' : s}
                  </span>,
                  fmtMoney(cur.byService[s] ?? 0),
                  fmtPct((cur.byService[s] ?? 0) / serviceTotal),
                  ...(prev ? [fmtMoney((cur.byService[s] ?? 0) - (prev.byService[s] ?? 0))] : []),
                ])}
              />
            </>
          )}
        </Panel>
        <Panel title="Client movement" subtitle={`Who stopped in ${curLabel}, and who isn't in the sheet next month`}>
          <MiniTable
            columns={['Client', 'Change', 'Amount']}
            align={['left', 'left', 'right']}
            rows={[
              ...lostThisMonth.map(c => [
                <BrandLink key="n" brandId={c.brandIds[0] ?? null}>{c.name}</BrandLink>,
                `Stopped in ${monthName(revenue.currentMonth)}`,
                <span key="a" style={{ color: 'var(--danger)' }}>−{fmtMoney(c.prevCents)}</span>,
              ]),
              ...leaving.map(c => [
                <BrandLink key="n" brandId={c.brandIds[0] ?? null}>{c.name}</BrandLink>,
                `Not in ${next ? monthName(next.month) : 'next month'}`,
                <span key="a" style={{ color: 'var(--warning)' }}>−{fmtMoney(c.currentCents)}</span>,
              ]),
              ...cur.newClients.map(name => {
                const c = revenue.clients.find(x => x.name === name)
                return [
                  <BrandLink key="n" brandId={c?.brandIds[0] ?? null}>{name}</BrandLink>,
                  `New in ${monthName(revenue.currentMonth)}`,
                  <span key="a" style={{ color: 'var(--success)' }}>+{fmtMoney(c?.currentCents ?? 0)}</span>,
                ]
              }),
            ]}
          />
          {lostThisMonth.length + leaving.length + cur.newClients.length === 0 && <Empty>No clients started or stopped.</Empty>}
        </Panel>
      </PanelGrid>
    </>
  )
}
