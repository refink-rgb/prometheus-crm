// Small presentational pieces shared by the Dashboard tabs. No hooks, so they
// render from server and client components alike.

import Link from 'next/link'

export type Tone = 'default' | 'accent' | 'good' | 'warn' | 'bad'

const TONE_VAR: Record<Tone, string | null> = {
  default: null,
  accent: 'var(--accent)',
  good: 'var(--success)',
  warn: 'var(--warning)',
  bad: 'var(--danger)',
}

export function Kpi({ label, value, sub, tone = 'default' }: { label: string; value: string; sub?: React.ReactNode; tone?: Tone }) {
  const v = TONE_VAR[tone]
  return (
    <div style={{
      background: v ? `color-mix(in srgb, ${v} 7%, var(--surface-1))` : 'var(--surface-1)',
      border: `1px solid ${v ? `color-mix(in srgb, ${v} 30%, var(--border))` : 'var(--border)'}`,
      borderRadius: 10,
      padding: 'var(--space-4) var(--space-5)',
      minWidth: 0,
    }}>
      <div style={{
        fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 'var(--space-2)',
      }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', lineHeight: 1.15 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.45 }}>{sub}</div>}
    </div>
  )
}

export function KpiGrid({ children, min = 190 }: { children: React.ReactNode; min?: number }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`,
      gap: 'var(--space-3)', marginBottom: 'var(--space-6)',
    }}>
      {children}
    </div>
  )
}

export function SectionTitle({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 'var(--space-3)', marginBottom: 'var(--space-3)', flexWrap: 'wrap' }}>
      <div>
        <h2 style={{
          fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text-muted)',
          letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0,
        }}>
          {title}
        </h2>
        {subtitle && <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: 4 }}>{subtitle}</p>}
      </div>
      {right}
    </div>
  )
}

export function Panel({ title, subtitle, children, right }: { title: string; subtitle?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 12,
      padding: 'var(--space-4) var(--space-5)', minWidth: 0,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
        <div>
          <h3 style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>{title}</h3>
          {subtitle && <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 3 }}>{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </div>
  )
}

export function PanelGrid({ children, min = 340 }: { children: React.ReactNode; min?: number }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(min(${min}px, 100%), 1fr))`,
      gap: 'var(--space-5)', marginBottom: 'var(--space-6)',
    }}>
      {children}
    </div>
  )
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', padding: 'var(--space-3) 0' }}>{children}</p>
}

/** A simple table: header labels + rows of cells. */
export function MiniTable({ columns, rows, align }: {
  columns: string[]
  rows: React.ReactNode[][]
  align?: Array<'left' | 'right'>
}) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={c} style={{
                textAlign: align?.[i] ?? 'left', padding: '6px 8px', whiteSpace: 'nowrap',
                fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em',
                borderBottom: '1px solid var(--border)',
              }}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((cell, ci) => (
                <td key={ci} style={{
                  textAlign: align?.[ci] ?? 'left', padding: '7px 8px', color: 'var(--text-primary)',
                  borderBottom: ri < rows.length - 1 ? '1px solid var(--border)' : 'none',
                  fontVariantNumeric: 'tabular-nums',
                }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function BrandLink({ brandId, children }: { brandId: string | null; children: React.ReactNode }) {
  if (!brandId) return <>{children}</>
  return <Link href={`/brands/${brandId}`} style={{ color: 'var(--text-primary)', textDecoration: 'none', fontWeight: 600 }}>{children}</Link>
}

/** Horizontal bars with direct labels: one series, so no legend. */
export function HBars({ data, format, colorVar = '--viz-cat-1', max: maxIn }: {
  data: Array<{ label: React.ReactNode; value: number; key: string }>
  format: (v: number) => string
  colorVar?: string
  max?: number
}) {
  const max = maxIn ?? Math.max(1, ...data.map(d => d.value))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {data.map(d => (
        <div key={d.key} title={`${typeof d.label === 'string' ? d.label : ''} ${format(d.value)}`}
          style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 34%) 1fr auto', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</span>
          <div style={{ height: 10, background: 'var(--surface-2)', borderRadius: 4 }}>
            <div style={{ width: `${Math.max(2, (d.value / max) * 100)}%`, height: '100%', background: `var(${colorVar})`, borderRadius: 4 }} />
          </div>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)', fontWeight: 600, fontVariantNumeric: 'tabular-nums', minWidth: 56, textAlign: 'right' }}>{format(d.value)}</span>
        </div>
      ))}
    </div>
  )
}

export function Pill({ children, tone = 'default' }: { children: React.ReactNode; tone?: Tone }) {
  const v = TONE_VAR[tone] ?? 'var(--text-muted)'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999,
      fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
      color: 'var(--text-primary)',
      background: `color-mix(in srgb, ${v} 14%, transparent)`,
      border: `1px solid color-mix(in srgb, ${v} 40%, transparent)`,
    }}>
      {children}
    </span>
  )
}

export const fmtMoney = (cents: number) => '$' + Math.round(cents / 100).toLocaleString('en-US')
export const fmtMoneyShort = (cents: number) => {
  const d = cents / 100
  if (Math.abs(d) >= 1000) return '$' + (d / 1000).toFixed(d >= 100_000 ? 0 : 1).replace(/\.0$/, '') + 'k'
  return '$' + Math.round(d)
}
export const fmtPct = (r: number | null, digits = 0) => (r === null ? '—' : `${(r * 100).toFixed(digits)}%`)
export function monthName(key: string, style: 'long' | 'short' = 'short'): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: style, timeZone: 'UTC' })
}
