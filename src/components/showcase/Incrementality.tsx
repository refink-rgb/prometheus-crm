import type { Incrementality as IncrementalityData } from '@/data/case-studies/types'
import { DEFAULT_INCREMENTALITY } from '@/data/case-studies/buildReport'

// Answers the first question a sharp reader asks: "sure, but did you actually
// ADD revenue, or just move it around?" Falls back to the shared default so
// reports stored before this section existed still render it.
export default function Incrementality({ data }: { data?: IncrementalityData | null }) {
  const d = data ?? DEFAULT_INCREMENTALITY

  return (
    <section aria-label="Is this incremental" style={{ padding: '24px 0 72px' }}>
      <div className="pe-container">
        <p className="pe-eyebrow" style={{ marginBottom: 10 }}>
          {d.question}
        </p>
        <h2
          style={{
            fontSize: 'clamp(24px, 3.4vw, 34px)',
            fontWeight: 600,
            letterSpacing: '-0.02em',
            margin: '0 0 28px',
            color: 'var(--pe-white)',
            maxWidth: 780,
          }}
        >
          {d.answer}
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
          {d.points.map((p, i) => (
            <div key={p.title} className="pe-card" style={{ padding: 28 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <span
                  style={{
                    flexShrink: 0,
                    width: 30,
                    height: 30,
                    borderRadius: 100,
                    background: 'var(--pe-lime)',
                    color: 'var(--pe-navy)',
                    fontSize: 14,
                    fontWeight: 700,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h3 style={{ fontSize: 18, fontWeight: 600, color: 'var(--pe-white)', margin: 0, letterSpacing: '-0.01em' }}>
                  {p.title}
                </h3>
              </div>
              <p style={{ fontSize: 15, lineHeight: 1.65, color: 'var(--pe-off)', margin: 0 }}>{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
