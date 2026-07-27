'use client'

import { useState } from 'react'
import type { LandingShowcase } from '@/data/case-studies/types'

export default function LpShowcase({ landing }: { landing: LandingShowcase }) {
  const { image, hotspots } = landing
  const [activeId, setActiveId] = useState<string | null>(hotspots[0]?.id ?? null)
  const active = hotspots.find((h) => h.id === activeId) ?? null
  const hasHotspots = hotspots.length > 0

  return (
    <section aria-label="Landing page walkthrough" style={{ padding: '24px 0 72px' }}>
      <div className="pe-container">
        <p className="pe-eyebrow" style={{ marginBottom: 10 }}>
          The landing page we built
        </p>
        <h2
          style={{
            fontSize: 'clamp(24px, 3.4vw, 34px)',
            fontWeight: 600,
            letterSpacing: '-0.02em',
            margin: '0 0 8px',
            color: 'var(--pe-white)',
          }}
        >
          Every conversion element, on purpose
        </h2>
        <p style={{ fontSize: 15, color: 'var(--pe-muted)', margin: '0 0 28px' }}>
          {hasHotspots
            ? 'Tap a marker to see what each element does and why it was built that way.'
            : 'The page we designed and built for the offer.'}
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: hasHotspots ? 'minmax(0, 1.35fr) minmax(0, 1fr)' : '1fr',
            gap: 24,
            alignItems: 'start',
            maxWidth: hasHotspots ? undefined : 760,
            margin: hasHotspots ? undefined : '0 auto',
          }}
          className="pe-lp-grid"
        >
          {/* Device frame + scrollable screenshot */}
          <div className="pe-card" style={{ padding: 0 }}>
            {/* Browser chrome so it reads like a real page, not a flat image */}
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
              <span
                style={{
                  marginLeft: 10,
                  fontSize: 12,
                  color: 'var(--pe-muted)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                the-offer.example / landing
              </span>
            </div>

            <div
              style={{
                position: 'relative',
                maxHeight: 560,
                overflowY: 'auto',
                background: 'var(--pe-navy)',
              }}
            >
              {/* Positioning box: hotspots are % of this box, so they track the
                  image on any viewport. */}
              <div style={{ position: 'relative', width: '100%' }}>
                {image.src ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={image.src}
                    alt={image.alt}
                    loading="lazy"
                    decoding="async"
                    style={{ display: 'block', width: '100%', height: 'auto' }}
                  />
                ) : (
                  <RedactedLpPlaceholder />
                )}

                {hotspots.map((h) => {
                  const isActive = h.id === activeId
                  return (
                    <button
                      key={h.id}
                      type="button"
                      aria-label={`${h.number}. ${h.title}`}
                      aria-pressed={isActive}
                      onClick={() => setActiveId(h.id)}
                      onMouseEnter={() => setActiveId(h.id)}
                      onFocus={() => setActiveId(h.id)}
                      className="focus-ring-pill"
                      style={{
                        position: 'absolute',
                        left: `${h.xPct}%`,
                        top: `${h.yPct}%`,
                        transform: 'translate(-50%, -50%)',
                        width: 34,
                        height: 34,
                        borderRadius: 100,
                        border: '2px solid var(--pe-navy)',
                        background: isActive ? 'var(--pe-lime)' : 'var(--pe-teal)',
                        color: 'var(--pe-navy)',
                        fontWeight: 700,
                        fontSize: 15,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: isActive
                          ? '0 0 0 6px rgba(211,240,95,0.25)'
                          : '0 2px 10px rgba(0,0,0,0.4)',
                        transition: 'background .15s, box-shadow .15s',
                      }}
                    >
                      {h.number}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Callout — rendered outside the scroll container so it never clips,
              works on touch, and updates on hover/focus/click. Omitted entirely
              when the report has no annotation hotspots (image-only LP). */}
          {hasHotspots && (
          <div
            className="pe-card"
            style={{ padding: 24, position: 'sticky', top: 24 }}
            aria-live="polite"
          >
            {active ? (
              <>
                <span className="pe-chip" style={{ background: 'var(--pe-teal)' }}>
                  {active.number}
                </span>
                <h3
                  style={{
                    fontSize: 20,
                    fontWeight: 600,
                    letterSpacing: '-0.02em',
                    margin: '14px 0 10px',
                    color: 'var(--pe-white)',
                  }}
                >
                  {active.title}
                </h3>
                <p style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--pe-off)', margin: 0 }}>
                  {active.body}
                </p>
              </>
            ) : (
              <p style={{ color: 'var(--pe-muted)', margin: 0 }}>Select a marker to learn more.</p>
            )}

            {/* Quick index — also keyboard reachable */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 20 }}>
              {hotspots.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => setActiveId(h.id)}
                  aria-pressed={h.id === activeId}
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    padding: '6px 12px',
                    borderRadius: 100,
                    border: '1px solid var(--pe-border)',
                    background: h.id === activeId ? 'var(--pe-lime)' : 'transparent',
                    color: h.id === activeId ? 'var(--pe-navy)' : 'var(--pe-off)',
                    cursor: 'pointer',
                  }}
                >
                  {h.number}. {h.title}
                </button>
              ))}
            </div>
          </div>
          )}
        </div>
      </div>

      <style
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: `@media (max-width:820px){.${'pe-lp-grid'}{grid-template-columns:1fr !important;}}`,
        }}
      />
    </section>
  )
}

// Neutral stand-in shown until a REDACTED screenshot derivative is supplied.
// Deliberately carries no brand marks — abstract page blocks only.
function RedactedLpPlaceholder() {
  return (
    <div
      aria-hidden
      style={{
        width: '100%',
        height: 900,
        background:
          'linear-gradient(180deg, #143349 0%, #0F2536 100%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 22,
        padding: '40px 32px',
      }}
    >
      <div style={{ height: 44, width: '38%', borderRadius: 10, background: 'rgba(255,255,255,0.10)' }} />
      <div style={{ height: 220, borderRadius: 16, background: 'rgba(255,255,255,0.06)' }} />
      <div style={{ height: 20, width: '70%', borderRadius: 8, background: 'rgba(255,255,255,0.08)' }} />
      <div style={{ height: 20, width: '55%', borderRadius: 8, background: 'rgba(255,255,255,0.06)' }} />
      <div style={{ height: 160, borderRadius: 16, background: 'rgba(255,255,255,0.05)' }} />
      <div style={{ height: 48, width: '46%', borderRadius: 100, background: 'rgba(0,228,230,0.18)' }} />
      <div style={{ height: 140, borderRadius: 16, background: 'rgba(255,255,255,0.05)' }} />
      <div
        style={{
          marginTop: 'auto',
          fontSize: 12,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--pe-muted)',
        }}
      >
        Redacted preview · screenshot pending
      </div>
    </div>
  )
}
