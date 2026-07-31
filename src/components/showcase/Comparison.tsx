import type { ComparisonBar } from '@/data/case-studies/types'

const CHART_H = 200 // px available for the tallest column
const BAR_W = 84

function Column({
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
  const h = max > 0 ? Math.max(12, (value / max) * CHART_H) : 0
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, minWidth: 0 }}>
      {/* Bars bottom-align: fixed-height box, content pushed to the bottom */}
      <div style={{ height: CHART_H + 44, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center' }}>
        <span
          style={{
            fontSize: highlight ? 'clamp(22px, 3vw, 30px)' : 'clamp(18px, 2.4vw, 22px)',
            fontWeight: 600,
            letterSpacing: '-0.02em',
            color: highlight ? 'var(--pe-lime)' : 'var(--pe-muted)',
            fontVariantNumeric: 'tabular-nums',
            marginBottom: 10,
            lineHeight: 1,
          }}
        >
          {display}
        </span>
        <div
          style={{
            width: BAR_W,
            maxWidth: '70%',
            height: h,
            borderRadius: '10px 10px 0 0',
            background: highlight ? 'linear-gradient(0deg, var(--pe-teal), var(--pe-lime))' : 'rgba(255,255,255,0.14)',
            boxShadow: highlight ? '0 0 30px rgba(211,240,95,0.28)' : undefined,
          }}
        />
      </div>
      <span style={{ fontSize: 13, color: highlight ? 'var(--pe-off)' : 'var(--pe-muted)', fontWeight: highlight ? 600 : 400, marginTop: 12, textAlign: 'center' }}>
        {label}
      </span>
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

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
          {comparisons.map((c) => {
            const max = Math.max(c.campaign.value, c.rest.value)
            const big = c.multiplier.replace('~', '').replace(/x/i, '×')
            return (
              <div key={c.label} className="pe-card" style={{ padding: 28 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--pe-muted)', margin: 0, maxWidth: '62%' }}>{c.label}</h3>
                  {/* Prominent multiple */}
                  <span
                    style={{
                      flexShrink: 0,
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
                    {big} higher
                  </span>
                </div>

                {/* Vertical column chart — the height gap makes the difference obvious */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-end',
                    justifyContent: 'center',
                    gap: 'clamp(24px, 8%, 64px)',
                    padding: '8px 8px 0',
                    borderBottom: '1px solid var(--pe-border)',
                  }}
                >
                  <Column label={c.campaign.label} value={c.campaign.value} max={max} display={c.campaign.display} highlight />
                  <Column label={c.rest.label} value={c.rest.value} max={max} display={c.rest.display} highlight={false} />
                </div>

                {/* The "so what" a bare chart can't carry. */}
                {c.note?.trim() ? (
                  <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--pe-muted)', margin: '18px 0 0' }}>
                    {c.note}
                  </p>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
