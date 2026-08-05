'use client'

// Day-over-day charts for one campaign. Recharts (already a dependency at
// 3.9.1, and in optimizePackageImports) — the interaction earns it here, where
// the reader wants to hover a specific day. The overview cards use a plain
// inline SVG sparkline instead, since one chart runtime per card is not worth
// it for a shape you read at a glance.
//
// Colors come from the --viz-* tokens in globals.css, which were validated per
// theme against the actual surfaces. Both charts are read in light and dark.

import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts'
import type { CumulativePoint } from '@/lib/results'
import { formatCents, formatCentsCompact, formatRoas, shortDateLabel } from '@/lib/results'

interface ChartDatum {
  date: string
  label: string
  spend: number
  revenue: number
  cumulativeRoas: number | null
}

export default function CampaignDailyCharts({ points }: { points: readonly CumulativePoint[] }) {
  if (points.length === 0) return null

  const data: ChartDatum[] = points.map(p => ({
    date: p.stat_date,
    label: shortDateLabel(p.stat_date),
    // Dollars for the axis — cents on a Y axis produce unreadable ticks. The
    // underlying values stay integer cents everywhere else; this conversion
    // exists only at the render boundary.
    spend: p.spend_cents / 100,
    revenue: p.revenue_cents / 100,
    cumulativeRoas: p.cumulative_roas,
  }))

  const axisTick = { fill: 'var(--text-muted)', fontSize: 11 }
  const axisLine = { stroke: 'var(--border)' }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 'var(--space-5)' }}>
      <Panel
        title="Daily spend and revenue"
        subtitle="One bar pair per day, in dollars"
      >
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" tick={axisTick} axisLine={axisLine} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={axisTick} axisLine={axisLine} tickLine={false} width={56} tickFormatter={dollarsTick} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelStyle={{ color: 'var(--text-primary)', fontWeight: 600 }}
              formatter={(value, name) => [formatCents(toCents(value)), String(name)]}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text-muted)' }} />
            <Bar dataKey="spend" name="Spend" fill="var(--accent)" radius={[2, 2, 0, 0]} />
            <Bar dataKey="revenue" name="Revenue" fill="var(--viz-ontime)" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Panel>

      <Panel
        title="Cumulative ROAS"
        subtitle="Running revenue ÷ running spend since launch"
      >
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" tick={axisTick} axisLine={axisLine} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={axisTick} axisLine={axisLine} tickLine={false} width={44} tickFormatter={(v: number) => `${v}x`} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelStyle={{ color: 'var(--text-primary)', fontWeight: 600 }}
              formatter={(value) => [formatRoas(toNumberOrNull(value)), 'Cumulative ROAS']}
            />
            {/* connectNulls is deliberately OFF: a day with zero spend has no
                ROAS, and bridging the gap would draw a number that was never
                measured. */}
            <Line
              type="monotone"
              dataKey="cumulativeRoas"
              stroke="var(--viz-series)"
              strokeWidth={2}
              dot={false}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </Panel>
    </div>
  )
}

const TOOLTIP_STYLE: React.CSSProperties = {
  background: 'var(--surface-raised)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontSize: 12,
  color: 'var(--text-secondary)',
}

function dollarsTick(v: number): string {
  return formatCentsCompact(Math.round(v * 100))
}

// Recharts hands tooltip formatters a loose ValueType (string | number | array
// | undefined). Both helpers below narrow it to null rather than to 0 — the
// formatters render null as an em dash, so an unreadable value never becomes a
// confident-looking zero in a tooltip.
function toNumberOrNull(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

function toCents(v: unknown): number | null {
  const n = toNumberOrNull(v)
  return n === null ? null : Math.round(n * 100)
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--surface-1)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: '16px 18px 10px',
    }}>
      <div style={{
        fontSize: 12, fontWeight: 700, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3,
      }}>
        {title}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>{subtitle}</div>
      {children}
    </div>
  )
}
