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
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, gap: 12 }}>
        <span style={{ fontSize: 13, color: highlight ? 'var(--pe-off)' : 'var(--pe-muted)', fontWeight: highlight ? 600 : 400 }}>
          {label}
        </span>
        <span
          style={{
            fontSize: highlight ? 26 : 20,
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
      <div style={{ height: highlight ? 16 : 10, borderRadius: 100, background: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            borderRadius: 100,
            background: highlight ? 'linear-gradient(90deg, var(--pe-teal), var(--pe-lime))' : 'rgba(255,255,255,0.18)',
            boxShadow: highlight ? '0 0 24px rgba(211,240,95,0.25)' : undefined,
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
            // Hero multiple, e.g. "~1.7x" → "1.7×"
            const big = c.multiplier.replace('~', '').replace(/x/i, '×')
            return (
              <div key={c.label} className="pe-card" style={{ padding: 28 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--pe-muted)', margin: '0 0 12px' }}>{c.label}</h3>

                {/* Hero multiple — makes the size of the gap unmistakable */}
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 24 }}>
                  <span
                    style={{
                      fontSize: 'clamp(48px, 9vw, 72px)',
                      fontWeight: 700,
                      letterSpacing: '-0.04em',
                      lineHeight: 0.9,
                      color: 'var(--pe-lime)',
                    }}
                  >
                    {big}
                  </span>
                  <span style={{ fontSize: 16, fontWeight: 500, color: 'var(--pe-off)', maxWidth: 120 }}>
                    higher than the rest of the account
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
