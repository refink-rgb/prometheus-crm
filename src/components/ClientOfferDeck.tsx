'use client'

import { useState, useTransition } from 'react'
import { approveOfferAsClient, requestOfferChangesAsClient } from '@/lib/client-offer-actions'

export interface ClientOfferSlide {
  id: string
  monthLabel: string
  momentSlot: number
  title: string
  /** The AI-written pitch — the body of the slide. */
  message: string | null
  mechanics: string | null
  product: string | null
  retailPrice: string | null
  pageType: string | null
  /** A note this client already sent about this offer, if any. */
  pendingNote: { by: string | null; note: string; at: string | null } | null
  /** Set only when the moment has competing candidates: "Option 1 of 2". */
  optionLabel: string | null
}

export default function ClientOfferDeck({
  token,
  slides,
}: {
  token: string
  slides: ClientOfferSlide[]
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {slides.map((slide, index) => (
        <OfferSlide
          key={slide.id}
          token={token}
          slide={slide}
          index={index}
          total={slides.length}
        />
      ))}
    </div>
  )
}

function OfferSlide({
  token,
  slide,
  index,
  total,
}: {
  token: string
  slide: ClientOfferSlide
  index: number
  total: number
}) {
  const [isPending, startTransition] = useTransition()
  const [mode, setMode] = useState<null | 'approve' | 'changes'>(null)
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<null | 'approved' | 'sent'>(null)

  function submitApproval() {
    setError(null)
    startTransition(async () => {
      try {
        await approveOfferAsClient(token, slide.id, name)
        setDone('approved')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
      }
    })
  }

  function submitChanges() {
    setError(null)
    startTransition(async () => {
      try {
        await requestOfferChangesAsClient(token, slide.id, name, note)
        setDone('sent')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
      }
    })
  }

  // The details worth showing beside the pitch. Anything blank is dropped
  // rather than rendered as an empty row — a client shouldn't see our gaps.
  const facts = [
    ['Offer type', slide.mechanics],
    ['Product', slide.product],
    ['Price', slide.retailPrice],
    ['Landing page', slide.pageType],
  ].filter(([, value]) => value) as [string, string][]

  return (
    <article style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 16,
      overflow: 'hidden',
      boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
    }}>
      {/* Slide header — reads like a deck: which moment, and where in the set */}
      <div style={{
        padding: '14px 28px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface-2)',
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      }}>
        <span style={{
          fontSize: 'var(--text-2xs)', fontWeight: 700, letterSpacing: '0.08em',
          textTransform: 'uppercase', color: 'var(--accent)',
        }}>
          {slide.monthLabel} · Moment {slide.momentSlot}
        </span>
        {slide.optionLabel && (
          <span
            title="We've put more than one option in front of you for this moment. Approve the one you want."
            style={{
              fontSize: 'var(--text-2xs)', fontWeight: 700, whiteSpace: 'nowrap',
              color: 'var(--text-secondary)', background: 'var(--surface)',
              border: '1px solid var(--border)', borderRadius: 20, padding: '2px 9px',
            }}
          >
            {slide.optionLabel}
          </span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
          {index + 1} of {total}
        </span>
      </div>

      <div style={{ padding: '28px 28px 8px' }}>
        <h2 style={{
          fontSize: 26, fontWeight: 800, color: 'var(--text-primary)',
          letterSpacing: '-0.02em', lineHeight: 1.2, marginBottom: 18,
        }}>
          {slide.title}
        </h2>

        {/* The pitch itself. */}
        {slide.message?.trim() ? (
          <div style={{
            fontSize: 16, lineHeight: 1.7, color: 'var(--text-primary)',
            whiteSpace: 'pre-wrap', marginBottom: 22,
          }}>
            {slide.message}
          </div>
        ) : (
          <p style={{ fontSize: 15, color: 'var(--text-muted)', marginBottom: 22 }}>
            Full details to follow — reach out to your strategist if anything is unclear.
          </p>
        )}

        {facts.length > 0 && (
          <dl style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 14, padding: '16px 18px', marginBottom: 4,
            background: 'var(--surface-2)', borderRadius: 12,
          }}>
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt style={{
                  fontSize: 'var(--text-2xs)', fontWeight: 700, letterSpacing: '0.07em',
                  textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4,
                }}>
                  {label}
                </dt>
                <dd style={{ fontSize: 'var(--text-base)', color: 'var(--text-primary)', fontWeight: 600 }}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {slide.pendingNote && !done && (
          <div style={{
            marginTop: 16,
            background: 'color-mix(in srgb, var(--warning) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--warning) 30%, transparent)',
            borderRadius: 10, padding: '12px 16px',
            fontSize: 'var(--text-base)', color: 'var(--text-secondary)', lineHeight: 1.55,
          }}>
            <strong style={{ color: 'var(--warning)' }}>
              You asked for changes{slide.pendingNote.by ? ` (${slide.pendingNote.by})` : ''}
            </strong>
            <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{slide.pendingNote.note}</div>
            <div style={{ marginTop: 6, fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
              We&rsquo;re on it. You can still approve below if you&rsquo;d rather go ahead as-is.
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: '16px 28px 24px' }}>
        {done === 'approved' ? (
          <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--success)' }}>
            ✓ Approved — thank you. We&rsquo;ll start building this moment.
          </p>
        ) : done === 'sent' ? (
          <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--warning)' }}>
            ✓ Sent — your strategist will come back to you on this one.
          </p>
        ) : (
          <>
            {error && (
              <p role="alert" style={{ fontSize: 'var(--text-base)', color: 'var(--danger)', marginBottom: 12 }}>
                {error}
              </p>
            )}

            {mode === null ? (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => setMode('approve')} style={approveBtn}>
                  Approve this offer
                </button>
                <button type="button" onClick={() => setMode('changes')} style={ghostBtn}>
                  Request changes
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <label htmlFor={`name-${slide.id}`} style={labelStyle}>Your name</label>
                <input
                  id={`name-${slide.id}`}
                  value={name}
                  onChange={e => setName(e.target.value)}
                  autoFocus
                  placeholder="So we know who signed off"
                  style={inputStyle}
                />

                {mode === 'changes' && (
                  <>
                    <label htmlFor={`note-${slide.id}`} style={labelStyle}>What would you like changed?</label>
                    <textarea
                      id={`note-${slide.id}`}
                      value={note}
                      onChange={e => setNote(e.target.value)}
                      rows={4}
                      placeholder="Tell us what to adjust and we'll come back with a revised offer."
                      style={{ ...inputStyle, resize: 'vertical' }}
                    />
                  </>
                )}

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 2 }}>
                  <button
                    type="button"
                    disabled={isPending || !name.trim() || (mode === 'changes' && !note.trim())}
                    onClick={mode === 'approve' ? submitApproval : submitChanges}
                    style={{
                      ...(mode === 'approve' ? approveBtn : warnBtn),
                      opacity: isPending || !name.trim() || (mode === 'changes' && !note.trim()) ? 0.5 : 1,
                    }}
                  >
                    {isPending
                      ? 'Sending…'
                      : mode === 'approve' ? 'Confirm approval' : 'Send to my strategist'}
                  </button>
                  <button type="button" onClick={() => { setMode(null); setError(null) }} style={ghostBtn}>
                    Cancel
                  </button>
                </div>

                {mode === 'approve' && (
                  <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: 2 }}>
                    Approving confirms this offer and we&rsquo;ll begin production on it.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </article>
  )
}

const labelStyle: React.CSSProperties = {
  fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-secondary)',
}
const inputStyle: React.CSSProperties = {
  width: '100%', fontSize: 'var(--text-base)', padding: '10px 12px',
  borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--surface-2)', color: 'var(--text-primary)',
}
const baseBtn: React.CSSProperties = {
  padding: '11px 20px', borderRadius: 9, fontSize: 15,
  fontWeight: 600, cursor: 'pointer', border: '1px solid transparent',
}
const approveBtn: React.CSSProperties = {
  ...baseBtn, background: 'var(--success)', color: '#fff',
}
const warnBtn: React.CSSProperties = {
  ...baseBtn, background: 'var(--warning)', color: '#1a1a1a',
}
const ghostBtn: React.CSSProperties = {
  ...baseBtn, background: 'transparent',
  borderColor: 'var(--border)', color: 'var(--text-muted)', fontWeight: 500,
}
