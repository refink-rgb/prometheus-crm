import type { StatComparison } from '@/data/case-studies/types'

export default function StatStrip({ stats }: { stats: StatComparison[] }) {
  return (
    <section aria-label="Headline results" style={{ padding: '64px 0' }}>
      <div className="pe-container">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 20,
          }}
        >
          {stats.map((s) => (
            <div key={s.label} className="pe-card" style={{ padding: 28 }}>
              <p className="pe-label" style={{ marginBottom: 18, minHeight: 28 }}>
                {s.label}
              </p>

              <div className="pe-stat-big" style={{ color: 'var(--pe-lime)' }}>
                {s.value}
              </div>

              {s.multiplier && (
                <div style={{ marginTop: 12 }}>
                  <span className="pe-chip">▲ {s.multiplier}</span>
                </div>
              )}

              <div
                style={{
                  marginTop: 18,
                  paddingTop: 16,
                  borderTop: '1px solid var(--pe-border)',
                  fontSize: 14,
                  color: 'var(--pe-muted)',
                }}
              >
                vs{' '}
                <strong style={{ color: 'var(--pe-off)', fontWeight: 600 }}>
                  {s.benchmarkValue}
                </strong>{' '}
                {s.benchmarkLabel}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
