import type { ProofImage } from '@/data/case-studies/types'

// The ad-account export, framed like an app window and placed directly between
// the headline stats and the campaign snapshot — so a reader sees the source of
// the numbers right after reading them, and knows they aren't invented.
export default function ProofShot({ proof }: { proof: ProofImage }) {
  return (
    <section aria-label="Proof from the ad account" style={{ padding: '8px 0 64px' }}>
      <div className="pe-container">
        <p className="pe-eyebrow" style={{ marginBottom: 14 }}>
          Straight from the ad account
        </p>

        <figure className="pe-card" style={{ margin: 0, padding: 0, overflow: 'hidden' }}>
          {/* Window chrome so it reads as a real export, not a designed graphic */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '10px 14px',
              borderBottom: '1px solid var(--pe-border)',
              background: 'var(--pe-card-2)',
            }}
          >
            <span style={{ width: 10, height: 10, borderRadius: 100, background: '#ff5f57' }} />
            <span style={{ width: 10, height: 10, borderRadius: 100, background: '#febc2e' }} />
            <span style={{ width: 10, height: 10, borderRadius: 100, background: '#28c840' }} />
          </div>

          {/* Wide table screenshots scroll inside their own container so the page
              body never scrolls sideways on mobile. */}
          <div style={{ overflowX: 'auto', background: '#fff' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={proof.src}
              alt={proof.caption}
              loading="lazy"
              decoding="async"
              style={{ display: 'block', width: '100%', minWidth: 680, height: 'auto' }}
            />
          </div>
        </figure>

        <figcaption style={{ fontSize: 14, color: 'var(--pe-muted)', marginTop: 12 }}>
          {proof.caption}
        </figcaption>
      </div>
    </section>
  )
}
