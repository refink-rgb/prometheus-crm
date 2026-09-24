'use client'

// The /results table: sticky header, client-side brand + launch-month
// filters. The server page does all the fetching and math and hands this a
// fully-computed, serializable row model — this component only filters and
// renders, so the filters are instant (no round trip).

import { useMemo, useState } from 'react'
import Link from 'next/link'
import FreshnessStamp from '@/components/FreshnessStamp'
import {
  formatCents,
  formatCentsCompact,
  formatRoas,
  formatPercent,
  shortDateLabel,
  type FunnelKpis,
} from '@/lib/results'

export interface ResultsTableRow {
  id: string
  brand: string
  title: string
  href: string | null
  launchedOn: string | null
  endedOn: string | null
  hasData: boolean
  days: number
  spendCents: number
  revenueCents: number
  sharePct: number | null
  lp: FunnelKpis
  rest: FunnelKpis | null
  // Max stat_date and max reported_at across the page's daily rows, collapsed
  // server-side so 70 pages don't ship thousands of rows to the client just
  // to compute a stamp.
  freshness: { stat_date: string; reported_at: string } | null
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-')
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`
}

export default function ResultsTable({ rows, nowMs }: { rows: ResultsTableRow[]; nowMs: number }) {
  const [brand, setBrand] = useState('')
  const [month, setMonth] = useState('')

  const brands = useMemo(() => [...new Set(rows.map(r => r.brand))].sort(), [rows])
  const months = useMemo(
    () => [...new Set(rows.filter(r => r.launchedOn).map(r => r.launchedOn!.slice(0, 7)))].sort().reverse(),
    [rows],
  )

  const visible = rows.filter(r =>
    (!brand || r.brand === brand) &&
    (!month || (r.launchedOn ?? '').slice(0, 7) === month))

  const spend = visible.reduce((s, r) => s + r.spendCents, 0)
  const revenue = visible.reduce((s, r) => s + r.revenueCents, 0)
  const filtered = !!brand || !!month

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-3)', flexWrap: 'wrap' }}>
        <select value={brand} onChange={e => setBrand(e.target.value)} style={SELECT}>
          <option value="">All brands</option>
          {brands.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={month} onChange={e => setMonth(e.target.value)} style={SELECT}>
          <option value="">All launch months</option>
          {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        {filtered && (
          <>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {visible.length} page{visible.length === 1 ? '' : 's'} · {formatCents(spend)} spend · {formatCents(revenue)} revenue
            </span>
            <button
              onClick={() => { setBrand(''); setMonth('') }}
              style={{
                fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none',
                cursor: 'pointer', padding: 0,
              }}
            >
              Clear
            </button>
          </>
        )}
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {/* The vertical scroll container is what the sticky header pins to —
            the page itself keeps its normal scroll. */}
        <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 240px)' }}>
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 13, minWidth: 980 }}>
            <thead>
              <tr>
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
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ ...TD, textAlign: 'center', padding: '28px 14px', color: 'var(--text-muted)' }}>
                    No tracked pages match these filters.
                  </td>
                </tr>
              ) : (
                visible.map(r => <Row key={r.id} r={r} nowMs={nowMs} />)
              )}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Under each KPI: the <strong>rest of that ad account</strong> over the same days.
          Green = the page beats the rest of the account on that metric (for CPM, cheaper).
          Pages marked &ldquo;detecting ads&rdquo; are enrolled but the engine hasn&apos;t matched any ads yet.
        </div>
      </div>
    </>
  )
}

function Row({ r, nowMs }: { r: ResultsTableRow; nowMs: number }) {
  const live = r.endedOn === null

  return (
    <tr style={{ opacity: r.hasData ? 1 : 0.65 }}>
      <td style={{ ...TD, maxWidth: 320 }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{r.brand}</div>
        {r.href ? (
          <Link href={r.href} style={{ fontWeight: 600, color: 'var(--text-primary)', textDecoration: 'none' }}>
            {r.title}
          </Link>
        ) : (
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.title}</span>
        )}
        {r.sharePct !== null && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
            {formatPercent(r.sharePct, 1)} of account spend
          </div>
        )}
      </td>
      <td style={{ ...TD, whiteSpace: 'nowrap' }}>
        {r.launchedOn ? (
          <>
            <div>{shortDateLabel(r.launchedOn)}</div>
            <div style={{ fontSize: 10, color: live ? 'var(--success)' : 'var(--text-muted)', marginTop: 2 }}>
              {live ? `live · day ${r.days || '–'}` : `ended ${shortDateLabel(r.endedOn!)}`}
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
        {r.freshness ? <FreshnessStamp rows={[r.freshness]} nowMs={nowMs} /> : <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>—</span>}
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

const SELECT: React.CSSProperties = {
  fontSize: 12,
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px solid var(--border-strong)',
  background: 'var(--surface-1)',
  color: 'var(--text-primary)',
}

const TH: React.CSSProperties = {
  // sticky needs an opaque background or the rows show through as they pass
  // beneath; the border rides borderBottom because a <tr> border doesn't
  // stick with the cells under borderCollapse: separate.
  position: 'sticky', top: 0, zIndex: 2, background: 'var(--surface-raised)',
  borderBottom: '1px solid var(--border)',
  padding: '10px 14px', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
  textTransform: 'uppercase', color: 'var(--text-muted)', textAlign: 'right', whiteSpace: 'nowrap',
}
const TD: React.CSSProperties = {
  padding: '10px 14px', textAlign: 'left', verticalAlign: 'top',
  borderTop: '1px solid var(--border)',
}
const TD_NUM: React.CSSProperties = {
  ...TD, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
}
