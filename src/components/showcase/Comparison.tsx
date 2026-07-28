import type { ComparisonBar } from '@/data/case-studies/types'

function Row({
  label,
  value,
  max,
  display,
  highlight,
}: {
  label: string
  value: number
  max: number
  display: string
  highlight: boolean
}) {
  const pct = max > 0 ? Math.max(6, (value / max) * 100) : 0
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, gap: 12 }}>
        <span style={{ fontSize: 13, color: highlight ? 'var(--pe-off)' : 'var(--pe-muted)', fontWeight: highlight ? 600 : 400 }}>
          {label}
        </span>
        <span
          style={{
            fontSize: highlight ? 30 : 22,
            fontWeight: 600,
            letterSpacing: '-0.02em',
            color: highlight ? 'var(--pe-lime)' : 'var(--pe-muted)',
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1,
          }}
        >
          {display}
        </span>
      </div>
      <div style={{ height: highlight ? 18 : 12, borderRadius: 100, background: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            borderRadius: 100,
            background: highlight
              ? 'linear-gradient(90deg, var(--pe-teal), var(--pe-lime))'
              : 'rgba(255,255,255,0.18)',
            boxShadow: highlight ? '0 0 24px rgba(211,240,95,0.25)' : undefined,
            transition: 'width .3s ease',
          }}
        />
      </div>
    </div>
  )
}

export default function Comparison({ comparisons }: { comparisons: ComparisonBar[] }) {
  return (
    <section aria-label="Comparisons" style={{ padding: '24px 0 72px' }}>
      <div className="pe-container">
        <p className="pe-eyebrow" style={{ marginBottom: 10 }}>
          The gap, side by side
        </p>
        <h2
          style={{
            fontSize: 'clamp(24px, 3.4vw, 34px)',
            fontWeight: 600,
            letterSpacing: '-0.02em',
            margin: '0 0 28px',
            color: 'var(--pe-white)',
          }}
        >
          How far ahead of the account it ran
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
          {comparisons.map((c) => {
            const max = Math.max(c.campaign.value, c.rest.value)
            return (
              <div key={c.label} className="pe-card" style={{ padding: 28 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 26 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--pe-white)', margin: 0, maxWidth: '66%' }}>
                    {c.label}
                  </h3>
                  {/* Prominent multiple badge */}
                  <span
                    style={{
                      flexShrink: 0,
                      display: 'inline-flex',
                      alignItems: 'baseline',
                      gap: 4,
                      padding: '8px 16px',
                      borderRadius: 100,
                      background: 'var(--pe-lime)',
                      color: 'var(--pe-navy)',
                      fontWeight: 700,
                      fontSize: 20,
                      letterSpacing: '-0.02em',
                      lineHeight: 1,
                    }}
                  >
                    {c.multiplier}
                  </span>
                </div>
                <Row label={c.campaign.label} value={c.campaign.value} max={max} display={c.campaign.display} highlight />
                <Row label={c.rest.label} value={c.rest.value} max={max} display={c.rest.display} highlight={false} />
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
