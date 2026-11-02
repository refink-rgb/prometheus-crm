'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { CONCERN_LABELS, oddsBand, type ClientConcern, type ConcernKind } from '@/lib/dashboard/ops'
import { Empty, Kpi, KpiGrid, Pill, SectionTitle, fmtMoney, type Tone } from './ui'

const KIND_ORDER: ConcernKind[] = ['leaving', 'fee_drop', 'delayed_project', 'late_offer', 'weak_launch', 'low_roas', 'waiting_client']

const KIND_TONE: Record<ConcernKind, Tone> = {
  leaving: 'bad',
  fee_drop: 'warn',
  delayed_project: 'bad',
  late_offer: 'warn',
  weak_launch: 'bad',
  low_roas: 'warn',
  waiting_client: 'default',
}

const BAND: Record<ReturnType<typeof oddsBand>, { label: string; tone: Tone; color: string }> = {
  healthy: { label: 'Healthy', tone: 'good', color: 'var(--success)' },
  watch: { label: 'Watch', tone: 'warn', color: 'var(--warning)' },
  at_risk: { label: 'At risk', tone: 'bad', color: 'var(--danger)' },
}

export default function ConcernsTab({ concerns, showMoney }: { concerns: ClientConcern[]; showMoney: boolean }) {
  const flagged = useMemo(() => concerns.filter(c => c.flags.length > 0), [concerns])
  const [filter, setFilter] = useState<ConcernKind | 'all'>('all')

  const counts = useMemo(() => {
    const out = new Map<ConcernKind, number>()
    for (const c of flagged) for (const k of new Set(c.flags.map(f => f.kind))) out.set(k, (out.get(k) ?? 0) + 1)
    return out
  }, [flagged])

  const shown = filter === 'all' ? flagged : flagged.filter(c => c.flags.some(f => f.kind === filter))
  const atRisk = flagged.filter(c => oddsBand(c.renewalOdds) === 'at_risk')
  const stake = flagged.reduce((s, c) => s + c.currentCents, 0)

  return (
    <div>
      <KpiGrid>
        <Kpi label="Clients with concerns" value={String(flagged.length)} tone={flagged.length > 0 ? 'warn' : 'good'}
          sub={`of ${concerns.length} clients checked`} />
        <Kpi label="At risk" value={String(atRisk.length)} tone={atRisk.length > 0 ? 'bad' : 'good'} sub="renewal odds under 50%" />
        {showMoney && <Kpi label="Revenue at stake" value={fmtMoney(stake)} sub="this month's fees of the clients below" />}
        <Kpi label="Delayed projects" value={String(counts.get('delayed_project') ?? 0)} sub="clients with a project 5+ days late" />
        <Kpi label="Weak results" value={String((counts.get('weak_launch') ?? 0) + (counts.get('low_roas') ?? 0))}
          sub="clients with a weak launch or low ROAS" />
      </KpiGrid>

      <SectionTitle
        title="Most concerned clients"
        subtitle="Lowest renewal odds first. Each client starts at 100% and loses points for every problem listed."
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 'var(--space-4)' }}>
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>All · {flagged.length}</FilterChip>
        {KIND_ORDER.filter(k => counts.get(k)).map(k => (
          <FilterChip key={k} active={filter === k} onClick={() => setFilter(k)}>
            {CONCERN_LABELS[k]} · {counts.get(k)}
          </FilterChip>
        ))}
      </div>

      {shown.length === 0 ? (
        <Empty>{flagged.length === 0 ? 'No client has a concern right now.' : 'No client matches this filter.'}</Empty>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {shown.map(c => <ConcernRow key={c.key} c={c} showMoney={showMoney} />)}
        </div>
      )}

      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 'var(--space-5)', lineHeight: 1.6 }}>
        Points off: leaving next month −90 · project delayed −20 (−5 for each extra) · weak launch (under $2,000 in the first 5–7 days) −20 ·
        fee drop −15 · ROAS under break-even (or 2.0 when the brand has no cost of delivery set) −15 · offer late −10 · waiting on client
        5+ days −5. Results checks only cover launches with Results tracking from the last 30 days.
      </p>
    </div>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} style={{
      padding: '4px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer',
      color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
      background: active ? 'var(--accent-muted)' : 'var(--surface-1)',
      border: `1px solid ${active ? 'color-mix(in srgb, var(--accent) 45%, transparent)' : 'var(--border)'}`,
    }}>
      {children}
    </button>
  )
}

function ConcernRow({ c, showMoney }: { c: ClientConcern; showMoney: boolean }) {
  const band = BAND[oddsBand(c.renewalOdds)]
  const name = c.brandId
    ? <Link href={`/brands/${c.brandId}`} style={{ color: 'var(--text-primary)', textDecoration: 'none' }}>{c.name}</Link>
    : c.name
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'minmax(170px, 230px) minmax(0, 1fr)', gap: 'var(--space-4)',
      background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 10,
      padding: 'var(--space-3) var(--space-4)',
    }} className="concern-row">
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 'var(--text-md)', fontWeight: 700, marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--surface-2)' }}>
            <div style={{ width: `${c.renewalOdds}%`, height: '100%', borderRadius: 4, background: band.color }} />
          </div>
          <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{c.renewalOdds}%</span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
          <Pill tone={band.tone}>{band.label}</Pill>
          {showMoney && c.currentCents > 0 && <span>{fmtMoney(c.currentCents)}/mo</span>}
          {c.services.length > 0 && <span>{c.services.join(' + ')}</span>}
        </div>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        {c.flags.map((f, i) => (
          <li key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
            <Pill tone={KIND_TONE[f.kind]}>{CONCERN_LABELS[f.kind]}</Pill>
            <span style={{ minWidth: 0 }}>{f.label}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
