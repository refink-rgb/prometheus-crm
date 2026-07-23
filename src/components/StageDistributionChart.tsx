'use client'

import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ResponsiveContainer, LabelList } from 'recharts'
import type { Project } from '@/lib/types'
import { STAGE_LABELS, STAGE_COLORS, type Stage } from '@/lib/stageColors'

interface StageDistributionChartProps {
  projects: Project[]
}

const CHART_STAGES: Stage[] = ['brief', 'in_progress', 'internal_review', 'client_review', 'revisions', 'live']

export default function StageDistributionChart({ projects }: StageDistributionChartProps) {
  const active = projects.filter(p => !p.is_complete)

  const data = CHART_STAGES.map(stage => {
    const count = active.filter(p => p.lp_stage === stage || p.creatives_stage === stage).length
    return {
      stage,
      label: STAGE_LABELS[stage],
      count,
      color: STAGE_COLORS[stage].border,
    }
  })

  const maxCount = Math.max(1, ...data.map(d => d.count))

  return (
    <div style={{
      background: 'var(--surface-1)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: '18px 20px 12px',
    }}>
      <div style={{
        fontSize: 12, fontWeight: 700,
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        marginBottom: 4,
      }}>
        Stage Distribution
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 14 }}>
        Active projects per stage (LP and Creatives tracks combined)
      </div>

      <div style={{ width: '100%', height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 4, right: 40, left: 8, bottom: 4 }}
            barSize={22}
          >
            <XAxis
              type="number"
              domain={[0, Math.ceil(maxCount * 1.15)]}
              tick={{ fill: '#666', fontSize: 11 }}
              axisLine={{ stroke: 'rgba(120,120,120,0.25)' }}
              tickLine={false}
              allowDecimals={false}
            />
            <YAxis
              type="category"
              dataKey="label"
              tick={{ fill: '#ccc', fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              width={110}
            />
            <Tooltip
              cursor={{ fill: 'rgba(120,120,120,0.08)' }}
              contentStyle={{
                background: 'var(--surface-raised)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                fontSize: 12,
                color: 'var(--text-primary)',
              }}
              labelStyle={{ color: 'var(--text-primary)' }}
              itemStyle={{ color: 'var(--text-primary)' }}
              formatter={(value) => [`${Number(value)} project${Number(value) === 1 ? '' : 's'}`, 'Count']}
            />
            <Bar dataKey="count" radius={[3, 3, 3, 3]}>
              {data.map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
              <LabelList
                dataKey="count"
                position="right"
                fill="#ccc"
                fontSize={11}
                formatter={(v) => `${Number(v)} project${Number(v) === 1 ? '' : 's'}`}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
