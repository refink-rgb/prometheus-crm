'use client'

// Financial tab charts. Colors come from the --viz-cat-* tokens (validated per
// theme); forecast months render lighter so actuals and expectations never
// read the same. One y-axis per chart, always in dollars.

import {
  Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'

export interface RevenueChartMonth {
  month: string
  label: string
  existing: number
  reactivated: number
  newRev: number
  target: number | null
  churned: number
  churnedClients: number
  revenue: number
  forecast: boolean
}

const axisTick = { fill: 'var(--text-muted)', fontSize: 11 }
const axisLine = { stroke: 'var(--border)' }
const TOOLTIP_STYLE: React.CSSProperties = {
  background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 8,
  fontSize: 12, color: 'var(--text-primary)',
}
const dollars = (v: number) => (Math.abs(v) >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`)
const full = (v: unknown) => '$' + Math.round(Number(v)).toLocaleString('en-US')

export function MonthlyRevenueChart({ data }: { data: RevenueChartMonth[] }) {
  const hasTarget = data.some(d => d.target !== null)
  const forecastOpacity = (d: RevenueChartMonth) => (d.forecast ? 0.45 : 1)
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 4 }} barCategoryGap="28%">
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" tick={axisTick} axisLine={axisLine} tickLine={false} />
        <YAxis tick={axisTick} axisLine={axisLine} tickLine={false} width={52} tickFormatter={dollars} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          labelStyle={{ color: 'var(--text-primary)', fontWeight: 600 }}
          cursor={{ fill: 'color-mix(in srgb, var(--text-muted) 10%, transparent)' }}
          labelFormatter={(label, payload) => {
            const d = payload?.[0]?.payload as RevenueChartMonth | undefined
            return d ? `${label}${d.forecast ? ' (forecast)' : ''} · ${full(d.revenue)}` : String(label)
          }}
          formatter={(value, name) => [full(value), String(name)]}
        />
        <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text-muted)' }} />
        <Bar dataKey="existing" name="Existing" stackId="r" fill="var(--viz-cat-1)" stroke="var(--surface-1)" strokeWidth={1}>
          {data.map(d => <Cell key={d.month} fillOpacity={forecastOpacity(d)} />)}
        </Bar>
        <Bar dataKey="reactivated" name="Back from pause" stackId="r" fill="var(--viz-cat-3)" stroke="var(--surface-1)" strokeWidth={1}>
          {data.map(d => <Cell key={d.month} fillOpacity={forecastOpacity(d)} />)}
        </Bar>
        <Bar dataKey="newRev" name="New" stackId="r" fill="var(--viz-cat-2)" stroke="var(--surface-1)" strokeWidth={1} radius={[4, 4, 0, 0]}>
          {data.map(d => <Cell key={d.month} fillOpacity={forecastOpacity(d)} />)}
        </Bar>
        {hasTarget && (
          <Line
            dataKey="target" name="Target" type="linear" stroke="var(--text-secondary)" strokeWidth={2}
            strokeDasharray="5 4" dot={{ r: 4, fill: 'var(--surface-1)', strokeWidth: 2 }} connectNulls={false} isAnimationActive={false}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export function ChurnChart({ data }: { data: RevenueChartMonth[] }) {
  const rows = data.slice(1) // the sheet's first month has nothing to churn from
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 4 }} barCategoryGap="34%">
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" tick={axisTick} axisLine={axisLine} tickLine={false} />
        <YAxis tick={axisTick} axisLine={axisLine} tickLine={false} width={52} tickFormatter={dollars} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          labelStyle={{ color: 'var(--text-primary)', fontWeight: 600 }}
          cursor={{ fill: 'color-mix(in srgb, var(--text-muted) 10%, transparent)' }}
          formatter={(value, _name, item) => {
            const d = (item as { payload?: RevenueChartMonth }).payload
            return [`${full(value)} · ${d?.churnedClients ?? 0} client${d?.churnedClients === 1 ? '' : 's'}`, 'Churned']
          }}
          labelFormatter={(label, payload) => {
            const d = payload?.[0]?.payload as RevenueChartMonth | undefined
            return `${label}${d?.forecast ? ' (forecast)' : ''}`
          }}
        />
        <Bar dataKey="churned" name="Churned revenue" fill="var(--danger)" radius={[4, 4, 0, 0]}>
          {rows.map(d => <Cell key={d.month} fillOpacity={d.forecast ? 0.45 : 0.9} />)}
        </Bar>
      </ComposedChart>
    </ResponsiveContainer>
  )
}
