'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateProjectDetails } from '@/lib/actions'

// "Where do I submit the landing page?" — the answer used to be a field inside
// the Edit details form, two clicks away from the card that says "No page yet".
// These inputs live on that card instead. Each saves one column through the
// same partial update the edit form uses, so nothing else on the project moves.
//
// Two fields share this: the live page URL and the Shopify discount code the
// page runs with. Both are "final output" — handed in when the build is done.

type FieldName = 'lp_url' | 'shopify_coupon_code'

const CONFIG: Record<FieldName, {
  label: string
  placeholder: string
  submitLabel: string
  hint: string
  inputType: 'url' | 'text'
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
    label: 'Discount code',
    placeholder: 'e.g. SUMMER20',
    submitLabel: 'Save code',
    hint: 'The Shopify discount code this page runs with, so anyone checking the page can test it.',
    inputType: 'text',
    normalize: raw => raw.trim().toUpperCase(),
    validate: value => (/\s/.test(value) ? 'A discount code has no spaces.' : null),
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

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => { setValue(currentValue ?? ''); setError(null); setEditing(true) }}
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
        if (currentValue) setEditing(false)
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save.')
      }
    })
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
          autoCapitalize={field === 'shopify_coupon_code' ? 'characters' : undefined}
          style={{
            flex: '1 1 320px', minWidth: 0, fontSize: 13,
            textTransform: field === 'shopify_coupon_code' ? 'uppercase' : undefined,
          }}
        />
        <button type="submit" className="btn-primary btn-sm" disabled={pending || (!value.trim() && !currentValue)}>
          {pending ? 'Saving…' : currentValue ? 'Save' : cfg.submitLabel}
        </button>
        {currentValue && (
          <button type="button" className="btn-secondary btn-sm" disabled={pending} onClick={() => setEditing(false)}>
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
