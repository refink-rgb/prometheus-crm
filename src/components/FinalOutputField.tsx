'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateProjectDetails } from '@/lib/actions'

// "Where do I submit the landing page?" — the answer used to be a field inside
// the Edit details form, two clicks away from the card that says "No page yet".
// These inputs live on that card instead. Each saves one column through the
// same partial update the edit form uses, so nothing else on the project moves.
//
// Two fields share this: the live page URL and the discount setup guide for
// the page — free text describing how the discount is configured in Shopify,
// which the column name (shopify_coupon_code) predates. Both are "final
// output" — handed in when the build is done.

type FieldName = 'lp_url' | 'shopify_coupon_code'

const CONFIG: Record<FieldName, {
  label: string
  placeholder: string
  submitLabel: string
  hint: string
  inputType: 'url' | 'text' | 'textarea'
  normalize: (raw: string) => string
  validate: (value: string) => string | null
}> = {
  lp_url: {
    label: 'Landing page URL',
    placeholder: 'https://…',
    submitLabel: 'Submit page URL',
    hint: 'Paste the live page when it is ready. This is the link the client reviews.',
    inputType: 'url',
    normalize: raw => raw.trim(),
    validate: value =>
      /^https?:\/\/\S+$/i.test(value) ? null : 'Paste the full address, starting with https://',
  },
  shopify_coupon_code: {
    label: 'Discount setup guide',
    placeholder: 'How the discount is set up in Shopify — the code or automatic discount, what it applies to, and any steps the client needs to follow.',
    submitLabel: 'Save guide',
    hint: 'Free text. Written for whoever sets the discount up in Shopify. ⌘↵ to save.',
    inputType: 'textarea',
    normalize: raw => raw.trim(),
    validate: () => null,
  },
}

export default function FinalOutputField({
  field,
  projectId,
  brandId,
  currentValue,
}: {
  field: FieldName
  projectId: string
  brandId: string
  currentValue: string | null
}) {
  const cfg = CONFIG[field]
  const router = useRouter()
  const [editing, setEditing] = useState(!currentValue)
  const [value, setValue] = useState(currentValue ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  // What the read view prints between a save and the refreshed props landing.
  const [lastSaved, setLastSaved] = useState<string | null>(currentValue)
  const shown = currentValue ?? lastSaved

  function startEditing() { setValue(shown ?? ''); setError(null); setEditing(true) }
  function cancel() { setValue(shown ?? ''); setError(null); setEditing(false) }

  if (!editing) {
    // The URL field is printed by its caller (as a link) — this only adds the
    // control. The guide is different: it is a paragraph, so it owns its own
    // read view, and clicking Edit swaps that box for the editor in place.
    // It used to open the textarea UNDER the saved text, so the guide was on
    // screen twice while you edited it, and the textarea came out half-width.
    if (cfg.inputType === 'textarea') {
      return (
        <div style={{ width: '100%', maxWidth: '80ch' }}>
          <div style={{
            fontSize: 13, lineHeight: 1.6, color: 'var(--text-primary)', whiteSpace: 'pre-wrap',
            padding: '10px 14px', borderRadius: 8,
            background: 'var(--surface-2)', border: '1px solid var(--border)',
          }}>
            {shown}
          </div>
          <div style={{ marginTop: 6 }}>
            <button type="button" onClick={startEditing} className="btn-secondary btn-sm">
              Edit guide
            </button>
          </div>
        </div>
      )
    }
    return (
      <button
        type="button"
        onClick={startEditing}
        style={{ background: 'none', border: 'none', padding: 0, fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', cursor: 'pointer', textDecoration: 'underline' }}
      >
        Change
      </button>
    )
  }

  function save() {
    const next = cfg.normalize(value)
    if (next) {
      const problem = cfg.validate(next)
      if (problem) { setError(problem); return }
    }
    setError(null)
    startTransition(async () => {
      try {
        await updateProjectDetails(projectId, brandId, { [field]: next || null })
        setLastSaved(next || null)
        if (next) setEditing(false)
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save.')
      }
    })
  }

  const dirty = cfg.normalize(value) !== (shown ?? '')

  if (cfg.inputType === 'textarea') {
    return (
      <form
        onSubmit={e => { e.preventDefault(); save() }}
        style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', maxWidth: '80ch' }}
      >
        <textarea
          value={value}
          autoFocus={!!shown}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape' && shown) { e.preventDefault(); cancel() }
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); save() }
          }}
          placeholder={cfg.placeholder}
          aria-label={cfg.label}
          disabled={pending}
          // Grows with the text so the whole guide is readable while editing
          // instead of scrolling inside a four-line box; capped so a long one
          // still leaves the Save button on screen.
          rows={Math.min(18, Math.max(4, value.split('\n').length + 1))}
          style={{ fontSize: 13, lineHeight: 1.6, padding: '10px 14px', resize: 'vertical', background: 'var(--surface-2)' }}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="submit" className="btn-primary btn-sm" disabled={pending || (shown ? !dirty : !value.trim())}>
            {pending ? 'Saving…' : shown ? 'Save changes' : cfg.submitLabel}
          </button>
          {shown && (
            <button type="button" className="btn-secondary btn-sm" disabled={pending} onClick={cancel}>
              Cancel
            </button>
          )}
          <span style={{ fontSize: 11, color: error ? 'var(--urgent-soon)' : 'var(--text-muted)' }}>
            {error ?? (shown ? '⌘↵ save · esc cancel' : cfg.hint)}
          </span>
        </div>
      </form>
    )
  }

  return (
    <form
      onSubmit={e => { e.preventDefault(); save() }}
      style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type={cfg.inputType}
          inputMode={cfg.inputType === 'url' ? 'url' : 'text'}
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder={cfg.placeholder}
          aria-label={cfg.label}
          disabled={pending}
          style={{ flex: '1 1 320px', minWidth: 0, fontSize: 13 }}
        />
        <button type="submit" className="btn-primary btn-sm" disabled={pending || (!value.trim() && !currentValue)}>
          {pending ? 'Saving…' : currentValue ? 'Save' : cfg.submitLabel}
        </button>
        {currentValue && (
          <button type="button" className="btn-secondary btn-sm" disabled={pending} onClick={cancel}>
            Cancel
          </button>
        )}
      </div>
      <div style={{ fontSize: 11, color: error ? 'var(--urgent-soon)' : 'var(--text-muted)' }}>
        {error ?? cfg.hint}
      </div>
    </form>
  )
}
