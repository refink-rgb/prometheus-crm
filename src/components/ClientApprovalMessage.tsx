'use client'

// The client approval message panel on an offer card.
//
// Three states in one component: empty (never generated), generated, and
// dirty (hand-edited, unsaved). The textarea is controlled here — unlike the
// offer form's uncontrolled fields — because we need to know whether the text
// differs from what's saved, which is what makes the regenerate warning and
// the unsaved-changes marker possible. It's one field, so the re-render cost
// that drove ProjectEditForm's uncontrolled pattern doesn't apply.

import { useState, useTransition } from 'react'
import { generateApprovalMessage, saveApprovalMessage } from '@/lib/offer-actions'

export default function ClientApprovalMessage({
  cardId,
  initialMessage,
  isEditor,
}: {
  cardId: string
  initialMessage: string | null
  isEditor: boolean
}) {
  const [message, setMessage] = useState(initialMessage ?? '')
  // What's actually in the DB — the baseline the dirty check compares against.
  const [saved, setSaved] = useState(initialMessage ?? '')
  const [isPending, startTransition] = useTransition()
  const [busy, setBusy] = useState<'generate' | 'save' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [confirmingRegen, setConfirmingRegen] = useState(false)
  // Figures the generator couldn't trace back to the card. Reported per
  // generation, so a reload clears them — the check runs at write time, not on
  // stored text.
  const [unverified, setUnverified] = useState<string[]>([])

  const dirty = message !== saved
  const hasMessage = saved.trim().length > 0
  // Drop a flag as soon as its figure is gone from the text, so the warning
  // shrinks while the strategist fixes them rather than nagging after the fact.
  const activeUnverified = unverified.filter(n => message.includes(n))

  function generate() {
    setError(null)
    setConfirmingRegen(false)
    setBusy('generate')
    startTransition(async () => {
      try {
        const { text, unverifiedNumbers } = await generateApprovalMessage(cardId)
        setMessage(text)
        setSaved(text)
        setUnverified(unverifiedNumbers)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to generate the message.')
      } finally {
        setBusy(null)
      }
    })
  }

  // Regenerating over edited text throws away work, so it asks first. Over
  // untouched text there's nothing to lose, so it doesn't.
  function requestGenerate() {
    if (hasMessage) setConfirmingRegen(true)
    else generate()
  }

  function save() {
    setError(null)
    setBusy('save')
    startTransition(async () => {
      try {
        await saveApprovalMessage(cardId, message)
        setSaved(message)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save.')
      } finally {
        setBusy(null)
      }
    })
  }

  async function copy() {
    await navigator.clipboard.writeText(message)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  const sectionTitle: React.CSSProperties = {
    fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text-muted)',
    textTransform: 'uppercase', letterSpacing: '0.08em',
    margin: 0,
  }

  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        flexWrap: 'wrap', marginBottom: 14,
      }}>
        <h2 style={sectionTitle}>Client Approval Message</h2>
        {dirty && (
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontStyle: 'italic' }}>
            unsaved changes
          </span>
        )}
      </div>

      {!hasMessage && !message && (
        <p style={{
          fontSize: 'var(--text-sm)', color: 'var(--text-muted)',
          margin: '0 0 14px', lineHeight: 1.5,
        }}>
          Builds the approval message from this card — the offer, the problem it solves,
          the success target and the guardrails. Fill those in first; the more that&apos;s
          there, the less generic it reads.
        </p>
      )}

      {activeUnverified.length > 0 && (
        <div
          role="alert"
          style={{
            background: 'color-mix(in srgb, var(--warning) 8%, var(--surface))',
            border: '1px solid color-mix(in srgb, var(--warning) 35%, transparent)',
            borderRadius: 10, padding: '10px 14px', marginBottom: 12,
            fontSize: 'var(--text-sm)', lineHeight: 1.5,
          }}
        >
          <strong style={{ fontWeight: 700 }}>Check these figures before sending: </strong>
          {activeUnverified.join(', ')}
          <span style={{ color: 'var(--text-muted)' }}>
            {' '}— they aren&apos;t on this card, so they may be invented. Fix or delete them.
          </span>
        </div>
      )}

      <textarea
        value={message}
        onChange={e => setMessage(e.target.value)}
        disabled={!isEditor || isPending}
        rows={hasMessage || message ? 18 : 6}
        placeholder="Generate a draft, or write the message yourself…"
        aria-label="Client approval message"
        style={{
          resize: 'vertical',
          lineHeight: 1.6,
          fontSize: 'var(--text-sm)',
          opacity: busy === 'generate' ? 0.5 : 1,
        }}
      />

      {isEditor && (
        <div style={{
          display: 'flex', gap: 10, alignItems: 'center',
          flexWrap: 'wrap', marginTop: 12,
        }}>
          {confirmingRegen ? (
            <>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                Replace the current message with a fresh draft?
              </span>
              <button type="button" className="btn-primary btn-sm" onClick={generate} disabled={isPending}>
                Regenerate
              </button>
              <button type="button" className="btn-secondary btn-sm" onClick={() => setConfirmingRegen(false)}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={hasMessage ? 'btn-secondary' : 'btn-primary'}
                onClick={requestGenerate}
                disabled={isPending}
              >
                {busy === 'generate'
                  ? 'Writing…'
                  : hasMessage ? '↺ Regenerate' : '✦ Generate message'}
              </button>

              {dirty && (
                <button type="button" className="btn-primary btn-sm" onClick={save} disabled={isPending}>
                  {busy === 'save' ? 'Saving…' : 'Save edits'}
                </button>
              )}

              {message.trim() && (
                <button type="button" className="btn-secondary btn-sm" onClick={copy} disabled={isPending}>
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              )}
            </>
          )}

          {error && (
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)' }}>{error}</span>
          )}
        </div>
      )}

      {busy === 'generate' && (
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', margin: '10px 0 0' }}>
          Reading the card and drafting — usually about ten seconds.
        </p>
      )}
    </section>
  )
}
