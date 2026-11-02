import Link from 'next/link'
import type { DashboardData } from '@/lib/dashboard/load'
import { CLIENT_WAIT_DAYS, DELAY_DAYS, OFFER_APPROVAL_DAY } from '@/lib/dashboard/ops'
import { OFFER_STAGE_LABELS, type OfferStage } from '@/lib/types'
import {
  BrandLink, Empty, Kpi, KpiGrid, MiniTable, Panel, PanelGrid, Pill, SectionTitle, fmtPct, monthName,
} from './ui'

const PUNCTUALITY = [
  { key: 'onTime', label: 'On time', color: 'var(--viz-ontime)' },
  { key: 'late', label: '1–4 days late', color: 'var(--viz-slip-1)' },
  { key: 'delayed', label: `${DELAY_DAYS}+ days late`, color: 'var(--viz-slip-3)' },
  { key: 'upcoming', label: 'Not due yet', color: 'var(--viz-neutral)' },
] as const

const shortDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

export default function ManagementTab({ data, children }: { data: DashboardData; children?: React.ReactNode }) {
  const m = data.management
  const longWaits = m.clientWaits.filter(w => w.days > CLIENT_WAIT_DAYS)
  const maxMonth = Math.max(1, ...m.punctuality.map(p => p.onTime + p.late + p.delayed + p.upcoming))
  const behind = m.delivery.filter(d => d.expected > 0 && d.delivered + d.inFlight < d.expected)

  return (
    <div>
      <SectionTitle title="Delivery health" subtitle={`"Delayed" means ${DELAY_DAYS}+ days past the project's LIVE date.`} />
      <KpiGrid>
        <Kpi label="Delayed clients" value={fmtPct(m.delayedClientRate)}
          tone={m.delayedClients > 0 ? 'bad' : 'good'}
          sub={`${m.delayedClients} of ${m.activeClients} active clients have a delayed project`} />
        <Kpi label="Projects delayed now" value={String(m.delayedNow.length)}
          tone={m.delayedNow.length > 0 ? 'bad' : 'good'}
          sub={m.delayedNow[0] ? `worst: ${m.delayedNow[0].daysLate} days (${m.delayedNow[0].brandName})` : 'nothing past the 5-day line'} />
        <Kpi label={`Delayed in ${monthName(data.today.slice(0, 7), 'long')}`} value={fmtPct(m.delayedThisMonthRate)}
          tone={m.delayedThisMonth > 0 ? 'warn' : 'default'}
          sub={`${m.delayedThisMonth} of ${m.dueThisMonth} projects due so far`} />
        <Kpi label="On-time launches" value={fmtPct(m.onTimeRate90)}
          sub={m.avgDaysLate !== null ? `last 3 months · late ones average ${m.avgDaysLate} days` : 'last 3 months'} />
        <Kpi label="Offers approved on time" value={fmtPct(m.offerOnTimeRate)}
          sub={`by the ${OFFER_APPROVAL_DAY}th, last 3 months`} />
        <Kpi label="Offers late now" value={String(m.lateOffers.length)}
          tone={m.lateOffers.length > 0 ? 'warn' : 'good'}
          sub={`this month: ${m.offersThisMonth.approved} of ${m.offersThisMonth.total} approved`} />
        <Kpi label="Waiting on client" value={String(longWaits.length)}
          tone={longWaits.length > 0 ? 'warn' : 'default'}
          sub={`in client review over ${CLIENT_WAIT_DAYS} days · ${m.clientWaits.length} in review total`} />
        <Kpi label="Clients behind on moments" value={String(behind.length)}
          tone={behind.length > 0 ? 'warn' : 'default'}
          sub="MM clients with fewer than 2 moments live or in flight this month" />
      </KpiGrid>

      <div style={{ marginBottom: 'var(--space-6)' }}>
        <Panel title="Launch punctuality by month" subtitle="Projects grouped by the month of their LIVE date">
          <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap', marginBottom: 'var(--space-3)' }}>
            {PUNCTUALITY.map(s => (
              <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)' }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color }} />{s.label}
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {m.punctuality.map(p => {
              const total = p.onTime + p.late + p.delayed + p.upcoming
              return (
                <div key={p.month} style={{ display: 'grid', gridTemplateColumns: '64px 1fr 120px', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{monthName(p.month)} {p.month.slice(2, 4)}</span>
                  <div style={{ display: 'flex', gap: 2, height: 16 }}>
                    {total === 0 && <div style={{ flex: 1, borderRadius: 4, border: '1px dashed var(--border)' }} />}
                    {PUNCTUALITY.map(s => {
                      const v = p[s.key]
                      if (!v) return null
                      return (
                        <div key={s.key} title={`${s.label}: ${v}`}
                          style={{ width: `${(v / maxMonth) * 100}%`, background: s.color, borderRadius: 3, minWidth: 4 }} />
                      )
                    })}
                  </div>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {total === 0 ? 'no projects' : `${p.onTime}/${total - p.upcoming} on time${p.delayed ? ` · ${p.delayed} delayed` : ''}`}
                  </span>
                </div>
              )
            })}
          </div>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 'var(--space-3)' }}>
            Launch dates come from the stage log, which started July 17. Projects shipped before that count as on time.
          </p>
        </Panel>
      </div>

      <PanelGrid min={420}>
        <Panel title="Most delayed projects" subtitle={`Still not live, ${DELAY_DAYS}+ days past the LIVE date`}>
          {m.delayedNow.length === 0 ? <Empty>No delayed projects.</Empty> : (
            <MiniTable
              columns={['Client', 'Project', 'Due', 'Late', 'Stage']}
              align={['left', 'left', 'left', 'right', 'left']}
              rows={m.delayedNow.slice(0, 15).map(t => [
                <BrandLink key="b" brandId={t.brandId}>{t.brandName}</BrandLink>,
                <Link key="p" href={`/brands/${t.brandId}/projects/${t.id}`} style={{ color: 'var(--text-primary)' }}>{t.name}</Link>,
                shortDate(t.dueDate),
                <Pill key="d" tone={t.daysLate >= 10 ? 'bad' : 'warn'}>{t.daysLate}d</Pill>,
                <span key="s" style={{ color: 'var(--text-secondary)' }}>{t.stageLabel}</span>,
              ])}
            />
          )}
        </Panel>
        <Panel title="Late offers" subtitle={`Not approved by the ${OFFER_APPROVAL_DAY}th of their month`}>
          {m.lateOffers.length === 0 ? <Empty>Every offer due so far is approved.</Empty> : (
            <MiniTable
              columns={['Client', 'Offer', 'Stage', 'Late']}
              align={['left', 'left', 'left', 'right']}
              rows={m.lateOffers.slice(0, 15).map(o => [
                <BrandLink key="b" brandId={o.brandId}>{o.brandName}</BrandLink>,
                <Link key="o" href="/offers" style={{ color: 'var(--text-primary)' }}>{o.name}</Link>,
                <span key="s" style={{ color: 'var(--text-secondary)' }}>{OFFER_STAGE_LABELS[o.stage as OfferStage] ?? o.stage}</span>,
                <Pill key="d" tone={o.daysLate >= 10 ? 'bad' : 'warn'}>{o.daysLate}d</Pill>,
              ])}
            />
          )}
        </Panel>
      </PanelGrid>

      <PanelGrid min={420}>
        <Panel title="Waiting on client" subtitle="Time since each track went to client review">
          {m.clientWaits.length === 0 ? <Empty>Nothing in client review.</Empty> : (
            <MiniTable
              columns={['Client', 'Project', 'Track', 'Waiting']}
              align={['left', 'left', 'left', 'right']}
              rows={m.clientWaits.slice(0, 15).map(w => [
                <BrandLink key="b" brandId={w.brandId}>{w.brandName}</BrandLink>,
                <Link key="p" href={`/brands/${w.brandId}/projects/${w.projectId}`} style={{ color: 'var(--text-primary)' }}>{w.projectName}</Link>,
                w.track,
                <Pill key="d" tone={w.days > CLIENT_WAIT_DAYS ? 'warn' : 'default'}>{w.days}d</Pill>,
              ])}
            />
          )}
        </Panel>
        <Panel title={`Moments this month · ${monthName(data.today.slice(0, 7), 'long')}`}
          subtitle={data.revenue ? 'Live or in flight per client. MM clients are owed 2.' : 'Upload the revenue sheet to see who is owed moments.'}>
          {m.delivery.length === 0 ? <Empty>No moments due this month.</Empty> : (
            <MiniTable
              columns={['Client', 'Live', 'In flight', 'Owed']}
              align={['left', 'right', 'right', 'right']}
              rows={m.delivery.slice(0, 40).map(d => {
                const short = d.expected > 0 && d.delivered + d.inFlight < d.expected
                return [
                  <BrandLink key="b" brandId={d.brandId}>{d.clientName}</BrandLink>,
                  d.delivered,
                  d.inFlight,
                  d.expected > 0
                    ? <Pill key="e" tone={short ? 'warn' : d.delivered >= d.expected ? 'good' : 'default'}>{d.delivered}/{d.expected}</Pill>
                    : <span key="e" style={{ color: 'var(--text-muted)' }}>—</span>,
                ]
              })}
            />
          )}
        </Panel>
      </PanelGrid>

      {children && (
        <div style={{ marginTop: 'var(--space-8)' }}>
          <SectionTitle title="Production flow" subtitle="Build times, load per producer and slips, from the last 60 days of stage changes." />
          {children}
        </div>
      )}
    </div>
  )
}
