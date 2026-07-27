import type { ComparisonBar } from '@/data/case-studies/types'

function Bar({
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
  const pct = max > 0 ? Math.max(4, (value / max) * 100) : 0
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 8,
          gap: 12,
        }}
      >
        <span style={{ fontSize: 13, color: 'var(--pe-muted)' }}>{label}</span>
        <span
          style={{
            fontSize: 20,
            fontWeight: 600,
            letterSpacing: '-0.02em',
            color: highlight ? 'var(--pe-lime)' : 'var(--pe-off)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {display}
        </span>
      </div>
      <div
        style={{
          height: 14,
          borderRadius: 100,
          background: 'rgba(255,255,255,0.06)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            borderRadius: 100,
            background: highlight
              ? 'linear-gradient(90deg, var(--pe-teal), var(--pe-lime))'
              : 'rgba(255,255,255,0.22)',
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
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: 20,
          }}
        >
          {comparisons.map((c) => {
            const max = Math.max(c.campaign.value, c.rest.value)
            return (
              <div key={c.label} className="pe-card" style={{ padding: 28 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 12,
                    marginBottom: 22,
                  }}
                >
                  <h3
                    style={{
                      fontSize: 15,
                      fontWeight: 600,
                      color: 'var(--pe-white)',
                      margin: 0,
                      maxWidth: '70%',
                    }}
                  >
                    {c.label}
                  </h3>
                  <span className="pe-chip">{c.multiplier}</span>
                </div>
                <Bar
                  label={c.campaign.label}
                  value={c.campaign.value}
                  max={max}
                  display={c.campaign.display}
                  highlight
                />
                <Bar
                  label={c.rest.label}
                  value={c.rest.value}
                  max={max}
                  display={c.rest.display}
                  highlight={false}
                />
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
