'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateBrandBrief } from '@/lib/actions'

// The client's own rules, pasted.
//
// Deliberately separate from brand_notes: notes are what WE have learned about a
// brand, guidelines are what the CLIENT told us. The first time those disagree,
// an editor needs to know which is which.
//
// Rendered on both the Overview and the Creatives tab, from one field, because
// the two places you need a rule are while reading the brief and while drawing.
// Collapsed on Creatives, where it is reference rather than reading.

export default function BrandGuidelines({
  brandId, brandName, projectId, guidelines, collapsed = false,
}: {
  brandId: string
  brandName: string
  projectId: string
  guidelines: string | null
  collapsed?: boolean
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [open, setOpen] = useState(!collapsed)
  const [draft, setDraft] = useState(guidelines ?? '')
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState('')

  function save() {
    setErr('')
    startTransition(async () => {
      try {
        await updateBrandBrief(brandId, { brand_guidelines: draft }, projectId)
        router.refresh()
        setEditing(false)
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Could not save.')
      }
    })
  }

  const body = editing ? (
    <>
      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        rows={12}
        placeholder={`Paste ${brandName}'s guidelines — fonts, colours, logo rules, what must never appear, tone. A link works too.`}
        style={{ width: '100%', fontSize: 13, lineHeight: 1.6, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-primary)', resize: 'vertical' }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
        <button onClick={save} disabled={pending} style={{ fontSize: 12, fontWeight: 700, padding: '7px 14px', borderRadius: 8, border: '1px solid var(--accent)', background: 'var(--accent-muted)', color: 'var(--accent)', cursor: pending ? 'wait' : 'pointer' }}>
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button onClick={() => { setDraft(guidelines ?? ''); setEditing(false) }} disabled={pending} style={{ fontSize: 12, fontWeight: 600, padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
          Cancel
        </button>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Saved on the brand — every {brandName} project shows this.</span>
      </div>
      {err && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 8 }}>{err}</div>}
    </>
  ) : guidelines ? (
    <>
      {/* pre-wrap: pasted guidelines arrive as a list and their line breaks are
          the structure. Reflowing them into a paragraph destroys it. */}
      <div style={{ fontSize: 13, lineHeight: 1.65, whiteSpace: 'pre-wrap', color: 'var(--text-secondary)', maxWidth: '80ch' }}>{guidelines}</div>
      <button onClick={() => setEditing(true)} style={linkBtn}>Edit</button>
    </>
  ) : (
    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
      Nothing pasted yet ·{' '}
      <button onClick={() => setEditing(true)} style={{ ...linkBtn, marginTop: 0 }}>Paste {brandName}&rsquo;s guidelines</button>
    </div>
  )

  if (collapsed) {
    return (
      <div style={{ border: '1px solid var(--border)', borderRadius: 10, marginBottom: 12 }}>
        <button
          onClick={() => setOpen(v => !v)}
          aria-expanded={open}
          style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '10px 12px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)' }}
        >
          <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 10 }}>{open ? '▾' : '▸'}</span>
          <span style={{ fontSize: 12, fontWeight: 700 }}>Brand guidelines</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {guidelines ? `${guidelines.length.toLocaleString()} characters` : 'none yet'}
          </span>
        </button>
        {open && <div style={{ padding: '0 12px 12px 30px' }}>{body}</div>}
      </div>
    )
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 20 }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 8 }}>
        {brandName} brand guidelines
      </div>
      {body}
    </div>
  )
}

const linkBtn: React.CSSProperties = {
  fontSize: 11.5, fontWeight: 600, color: 'var(--accent)', background: 'none',
  border: 'none', padding: 0, cursor: 'pointer', marginTop: 8, display: 'block',
}
