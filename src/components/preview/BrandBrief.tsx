'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateBrandBrief } from '@/lib/actions'

// What an editor needs to know about a brand before they start drawing.
//
// Lives on the BRAND and renders on every one of its projects: the point is that
// swapping who works on a client does not mean relearning the client. Asked for
// on the editors' call — "sort of like a brand bible… so in case we need to swap
// out brands, they can just check that out."

const LEVELS = [
  { v: 0, label: 'Fine with AI', colour: 'var(--success)', hint: 'Does not mind AI imagery.' },
  { v: 1, label: 'Some AI', colour: 'var(--stage-live)', hint: 'Comfortable with AI, within reason.' },
  { v: 2, label: 'Minimal AI', colour: 'var(--warning)', hint: 'Prefers real photography; use AI sparingly.' },
  { v: 3, label: 'Avoid AI', colour: 'var(--danger)', hint: 'Will flag anything that reads as AI, sometimes when it is not.' },
] as const

export default function BrandBrief({
  brandId, brandName, projectId, notes, sensitivity,
}: {
  brandId: string
  brandName: string
  projectId: string
  notes: string | null
  sensitivity: number | null
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [draftNotes, setDraftNotes] = useState(notes ?? '')
  const [draftLevel, setDraftLevel] = useState<number | null>(sensitivity)
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState('')

  const level = LEVELS.find(l => l.v === sensitivity) ?? null

  // One click from the unset state, so the common case never opens a form.
  function quickSet(v: number) {
    setErr('')
    startTransition(async () => {
      try {
        await updateBrandBrief(brandId, { ai_sensitivity: v }, projectId)
        router.refresh()
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Could not save.')
      }
    })
  }

  function save() {
    setErr('')
    startTransition(async () => {
      try {
        await updateBrandBrief(brandId, { brand_notes: draftNotes, ai_sensitivity: draftLevel }, projectId)
        router.refresh()
        setEditing(false)
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Could not save.')
      }
    })
  }

  if (editing) {
    return (
      <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 20 }}>
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 8 }}>
          How much AI does {brandName} accept?
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          {LEVELS.map(l => {
            const on = draftLevel === l.v
            return (
              <button
                key={l.v}
                onClick={() => setDraftLevel(on ? null : l.v)}
                title={l.hint}
                style={{
                  fontSize: 11.5, fontWeight: 600, padding: '5px 11px', borderRadius: 999, cursor: 'pointer',
                  border: `1px solid ${on ? l.colour : 'var(--border)'}`,
                  background: on ? l.colour : 'transparent',
                  color: on ? '#fff' : 'var(--text-secondary)',
                }}
              >{l.label}</button>
            )
          })}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>
          {LEVELS.find(l => l.v === draftLevel)?.hint ?? 'Not set — click a level, or leave it blank if you do not know yet.'}
        </div>

        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 6 }}>
          Notes on this brand
        </div>
        <textarea
          value={draftNotes}
          onChange={e => setDraftNotes(e.target.value)}
          rows={6}
          placeholder={`What should someone new to ${brandName} know? Standing complaints, what they always reject, what works.`}
          style={{ width: '100%', fontSize: 13, lineHeight: 1.6, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-primary)', resize: 'vertical' }}
        />

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button onClick={save} disabled={pending} style={{ fontSize: 12, fontWeight: 700, padding: '7px 14px', borderRadius: 8, border: '1px solid var(--accent)', background: 'var(--accent-muted)', color: 'var(--accent)', cursor: pending ? 'wait' : 'pointer' }}>
            {pending ? 'Saving…' : 'Save'}
          </button>
          <button onClick={() => { setDraftNotes(notes ?? ''); setDraftLevel(sensitivity); setEditing(false) }} disabled={pending} style={{ fontSize: 12, fontWeight: 600, padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            Cancel
          </button>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center' }}>Saved on the brand — every {brandName} project shows this.</span>
        </div>
        {err && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 8 }}>{err}</div>}
      </div>
    )
  }

  // Unset: show the dial itself rather than a line of text about it. Setting it
  // is a once-per-brand act, and a link saying "add some" hides the very control
  // an editor needs to see. One click sets it, from here.
  if (!notes && sensitivity === null) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', border: '1px dashed var(--border-strong)', borderRadius: 10, padding: '10px 14px', marginBottom: 20 }}>
        <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
          How much AI does {brandName} accept?
        </span>
        {LEVELS.map(l => (
          <button
            key={l.v}
            onClick={() => quickSet(l.v)}
            disabled={pending}
            title={l.hint}
            style={{
              fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: 999, cursor: pending ? 'wait' : 'pointer',
              border: `1px solid ${l.colour}`, background: 'transparent', color: l.colour,
            }}
          >{l.label}</button>
        ))}
        <button onClick={() => setEditing(true)} style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 600, color: 'var(--accent)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
          + Notes
        </button>
        {err && <div style={{ fontSize: 11, color: 'var(--danger)', width: '100%' }}>{err}</div>}
      </div>
    )
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderLeft: `3px solid ${level?.colour ?? 'var(--border-strong)'}`, borderRadius: 10, padding: '12px 16px', marginBottom: 20, background: 'var(--surface-1)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: notes ? 8 : 0 }}>
        <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>About {brandName}</span>
        {level && (
          <span title={level.hint} style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: level.colour, color: '#fff' }}>
            {level.label}
          </span>
        )}
        <button onClick={() => setEditing(true)} style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 600, color: 'var(--accent)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>Edit</button>
      </div>
      {notes && (
        <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', color: 'var(--text-secondary)', maxWidth: '80ch' }}>{notes}</div>
      )}
    </div>
  )
}
