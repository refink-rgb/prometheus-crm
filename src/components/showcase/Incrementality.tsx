'use client'

import { useState } from 'react'
import type { Incrementality as IncrementalityData } from '@/data/case-studies/types'
import { DEFAULT_INCREMENTALITY } from '@/data/case-studies/buildReport'

// Answers the first question a sharp reader asks: "sure, but did you actually
// ADD revenue, or just move it around?" Presented as an accordion so the page
// stays scannable and the reader opens only what they want to interrogate.
// Falls back to the shared default so reports stored before this section
// existed still render it.
export default function Incrementality({ data }: { data?: IncrementalityData | null }) {
  const d = data ?? DEFAULT_INCREMENTALITY
  // First row open on load so the section never reads as an empty stack.
  const [openIndex, setOpenIndex] = useState<number | null>(0)

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

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 860 }}>
          {d.points.map((p, i) => {
            const isOpen = i === openIndex
            const panelId = `incr-panel-${i}`
            const buttonId = `incr-button-${i}`
            return (
              <div
                key={p.title}
                style={{
                  borderRadius: 16,
                  border: `1px solid ${isOpen ? 'var(--pe-lime)' : 'var(--pe-border)'}`,
                  background: isOpen ? 'rgba(211,240,95,0.05)' : 'transparent',
                  overflow: 'hidden',
                  transition: 'border-color .18s ease, background .18s ease',
                }}
              >
                <button
                  id={buttonId}
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => setOpenIndex(isOpen ? null : i)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 16,
                    padding: '20px 24px',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    font: 'inherit',
                  }}
                >
                  <span
                    style={{
                      fontSize: 'clamp(16px, 2vw, 19px)',
                      fontWeight: 600,
                      letterSpacing: '-0.01em',
                      color: 'var(--pe-white)',
                    }}
                  >
                    {p.title}
                  </span>
                  {/* Plus / minus toggle, drawn so it never depends on a font glyph */}
                  <span
                    aria-hidden
                    style={{
                      flexShrink: 0,
                      position: 'relative',
                      width: 20,
                      height: 20,
                      color: 'var(--pe-lime)',
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute',
                        top: '50%',
                        left: 0,
                        width: 20,
                        height: 2.5,
                        borderRadius: 2,
                        background: 'currentColor',
                        transform: 'translateY(-50%)',
                      }}
                    />
                    <span
                      style={{
                        position: 'absolute',
                        left: '50%',
                        top: 0,
                        width: 2.5,
                        height: 20,
                        borderRadius: 2,
                        background: 'currentColor',
                        transform: `translateX(-50%) rotate(${isOpen ? '90deg' : '0deg'})`,
                        opacity: isOpen ? 0 : 1,
                        transition: 'transform .2s ease, opacity .2s ease',
                      }}
                    />
                  </span>
                </button>

                {isOpen && (
                  <div id={panelId} role="region" aria-labelledby={buttonId} style={{ padding: '0 24px 22px' }}>
                    <p style={{ fontSize: 16, lineHeight: 1.65, color: 'var(--pe-off)', margin: 0, maxWidth: 680 }}>
                      {p.body}
                    </p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
