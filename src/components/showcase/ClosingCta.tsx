import type { ClosingCta as ClosingCtaData } from '@/data/case-studies/types'

// Fallback for reports stored before `note` existed, so the guarantee is always
// explained in plain English rather than left as a bare claim.
const DEFAULT_NOTE =
  'Every dollar you put into a marketing moment comes back in revenue. If it doesn’t, you don’t pay for the work. That’s the deal.'

export default function ClosingCta({ cta }: { cta: ClosingCtaData }) {
  const hasHref = Boolean(cta.href)
  const note = cta.note || DEFAULT_NOTE

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
            margin: '0 0 32px',
            color: 'var(--pe-white)',
          }}
        >
          {cta.headline}
        </h2>

        {/* The guarantee, framed as an actual guarantee: a bordered seal with a
            label, the promise, and a plain-English restatement of the terms.
            Reads as a commitment someone stands behind — not a tagline. */}
        <div
          style={{
            maxWidth: 720,
            margin: '0 auto 40px',
            padding: 'clamp(24px, 4vw, 36px)',
            borderRadius: 24,
            border: '1px solid rgba(211,240,95,0.45)',
            background: 'rgba(211,240,95,0.06)',
            textAlign: 'left',
          }}
        >
          {/* Seal label */}
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 14px',
              borderRadius: 100,
              background: 'var(--pe-lime)',
              color: 'var(--pe-navy)',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              marginBottom: 18,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M12 2l7 3v6c0 4.5-3 8.5-7 11-4-2.5-7-6.5-7-11V5l7-3z"
                fill="currentColor"
                opacity="0.25"
              />
              <path
                d="M12 2l7 3v6c0 4.5-3 8.5-7 11-4-2.5-7-6.5-7-11V5l7-3z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <path d="M8.6 11.8l2.3 2.3 4.5-4.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Our guarantee
          </span>

          {/* The promise */}
          <p
            style={{
              fontSize: 'clamp(22px, 3.4vw, 32px)',
              fontWeight: 700,
              lineHeight: 1.25,
              letterSpacing: '-0.02em',
              color: 'var(--pe-lime)',
              margin: '0 0 16px',
            }}
          >
            {cta.body}
          </p>

          {/* What that actually means, in plain language */}
          <p
            style={{
              fontSize: 'clamp(15px, 1.8vw, 18px)',
              lineHeight: 1.6,
              color: 'var(--pe-off)',
              margin: 0,
            }}
          >
            {note}
          </p>
        </div>

        {/* Glowing pill so the CTA is the loudest action on the section. */}
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
