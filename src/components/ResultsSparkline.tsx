import type { CumulativePoint } from '@/lib/results'
import { formatCentsCompact, shortDateLabel } from '@/lib/results'

// A small revenue/spend sparkline for the campaign card. Inline SVG rather
// than Recharts: the card renders one of these per live campaign, and a server
// component with no JS beats shipping a chart runtime for something this size.
// The per-campaign detail page uses Recharts, where the interaction earns it.
//
// Bars are the SPREAD between revenue and spend per day, drawn on a shared
// scale so the two series are comparable by eye — the whole question a
// sparkline answers here is "is the green line above the orange one".

const HEIGHT = 40

export default function ResultsSparkline({ points }: { points: readonly CumulativePoint[] }) {
  if (points.length === 0) return null

  // One day isn't a trend. Say the number instead of drawing a single dot that
  // implies a shape.
  if (points.length === 1) {
    return (
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        One day recorded — {shortDateLabel(points[0].stat_date)}: {formatCentsCompact(points[0].revenue_cents)} revenue
        on {formatCentsCompact(points[0].spend_cents)} spend.
      </div>
    )
  }

  const max = Math.max(1, ...points.map(p => Math.max(p.revenue_cents, p.spend_cents)))
  const width = 100
  const step = width / (points.length - 1)

  const revenuePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${(i * step).toFixed(2)} ${(HEIGHT - (p.revenue_cents / max) * HEIGHT).toFixed(2)}`)
    .join(' ')
  const spendPath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${(i * step).toFixed(2)} ${(HEIGHT - (p.spend_cents / max) * HEIGHT).toFixed(2)}`)
    .join(' ')

  const first = points[0]
  const last = points[points.length - 1]

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${HEIGHT}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: HEIGHT, display: 'block', overflow: 'visible' }}
        role="img"
        aria-label={`Daily revenue and spend from ${shortDateLabel(first.stat_date)} to ${shortDateLabel(last.stat_date)}`}
      >
        <path d={spendPath} fill="none" stroke="var(--accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" opacity="0.85" />
        <path d={revenuePath} fill="none" stroke="var(--viz-ontime)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', marginTop: 6, fontSize: 10, color: 'var(--text-muted)' }}>
        {/* Direct labels — a sparkline this small has no room for a legend, and
            a legend elsewhere makes the reader hold a mapping in their head. */}
        <span>
          <span style={{ color: 'var(--viz-ontime)', fontWeight: 700 }}>—</span> revenue{' '}
          <span style={{ color: 'var(--accent)', fontWeight: 700, marginLeft: 6 }}>—</span> spend
        </span>
        <span>{shortDateLabel(first.stat_date)} – {shortDateLabel(last.stat_date)}</span>
      </div>
    </div>
  )
}
