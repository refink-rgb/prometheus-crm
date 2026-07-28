import type { ClosingCta as ClosingCtaData } from '@/data/case-studies/types'

export default function ClosingCta({ cta }: { cta: ClosingCtaData }) {
  const hasHref = Boolean(cta.href)
  return (
    <section
      aria-label="Get started"
      style={{
        padding: '80px 0 96px',
        background:
          'radial-gradient(100% 120% at 50% 120%, rgba(0,228,230,0.14) 0%, rgba(211,240,95,0.08) 40%, transparent 70%), var(--pe-navy)',
        borderTop: '1px solid var(--pe-border)',
      }}
    >
      <div className="pe-container" style={{ textAlign: 'center' }}>
        <h2
          style={{
            fontSize: 'clamp(36px, 6.5vw, 68px)',
            fontWeight: 700,
            letterSpacing: '-0.03em',
            margin: '0 0 18px',
            color: 'var(--pe-white)',
          }}
        >
          {cta.headline}
        </h2>
        {/* The guarantee — the actual hook. Large and lime so it reads as the offer. */}
        <p
          style={{
            fontSize: 'clamp(20px, 3vw, 28px)',
            fontWeight: 600,
            lineHeight: 1.35,
            letterSpacing: '-0.01em',
            color: 'var(--pe-lime)',
            maxWidth: 720,
            margin: '0 auto 40px',
          }}
        >
          {cta.body}
        </p>

        {/* Oversized, glowing pill so the CTA is the loudest thing on the section. */}
        {(() => {
          const btnStyle: React.CSSProperties = {
            fontSize: 'clamp(20px, 2.4vw, 24px)',
            fontWeight: 600,
            padding: '20px 56px',
            boxShadow: '0 0 0 1px rgba(211,240,95,0.5), 0 12px 40px rgba(0,228,230,0.35)',
          }
          return hasHref ? (
            <a className="pe-btn" href={cta.href!} target="_blank" rel="noopener noreferrer" style={btnStyle}>
              {cta.buttonLabel} →
            </a>
          ) : (
            <span className="pe-btn" role="text" style={btnStyle}>
              {cta.buttonLabel}
            </span>
          )
        })()}
      </div>
    </section>
  )
}
