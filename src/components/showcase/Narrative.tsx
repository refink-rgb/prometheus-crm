import type { NarrativeSection } from '@/data/case-studies/types'

export default function Narrative({ sections }: { sections: NarrativeSection[] }) {
  return (
    <section aria-label="Case study narrative" style={{ padding: '24px 0 72px' }}>
      <div className="pe-container">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 28,
          }}
        >
          {sections.map((section, i) => (
            <article key={section.heading}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  marginBottom: 14,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--pe-teal)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h2
                  style={{
                    fontSize: 22,
                    fontWeight: 600,
                    letterSpacing: '-0.02em',
                    margin: 0,
                    color: 'var(--pe-white)',
                  }}
                >
                  {section.heading}
                </h2>
              </div>
              {section.paragraphs.map((p, j) => (
                <p
                  key={j}
                  style={{
                    fontSize: 16,
                    lineHeight: 1.6,
                    color: 'var(--pe-off)',
                    margin: '0 0 14px',
                    fontWeight: 400,
                  }}
                >
                  {p}
                </p>
              ))}
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
