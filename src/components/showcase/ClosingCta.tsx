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
            fontSize: 'clamp(30px, 5vw, 52px)',
            fontWeight: 600,
            letterSpacing: '-0.02em',
            margin: '0 0 16px',
            color: 'var(--pe-white)',
          }}
        >
          {cta.headline}
        </h2>
        <p
          style={{
            fontSize: 18,
            lineHeight: 1.5,
            color: 'var(--pe-off)',
            maxWidth: 560,
            margin: '0 auto 36px',
          }}
        >
          {cta.body}
        </p>

        {hasHref ? (
          <a className="pe-btn" href={cta.href!}>
            {cta.buttonLabel}
          </a>
        ) : (
          // No link by design (e.g. "Message me") → a styled, non-interactive CTA label.
          <span className="pe-btn" role="text">
            {cta.buttonLabel}
          </span>
        )}
      </div>
    </section>
  )
}
