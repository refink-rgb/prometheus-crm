'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

// The read/edit swap for a note that has already been posted. Asked for by
// Jaspen, 3 Sep: fixing a typo used to mean deleting the note and retyping it,
// which loses its place in the thread and anything replied underneath it.
//
// One component, four call sites. Every comment card in this app has the same
// shape — a header row, then a single node holding the text — so a shared piece
// is cheaper than four near-copies that drift.
//
// It knows nothing about tables. The caller passes onSave, which THROWS on
// refusal. That is what lets one component sit over both project_comments
// (whose action throws) and brand_comments (whose action returns { ok }).
export default function EditableNoteBody({
  content, canEditNote, editedAt = null, onSave, style, render,
}: {
  content: string
  /** The caller resolves ownership: currentUserId != null && author_id === currentUserId. */
  canEditNote: boolean
  editedAt?: string | null
  onSave: (text: string) => Promise<void>
  style?: React.CSSProperties
  /** NotesThread renders @mentions; everywhere else is plain text. */
  render?: (text: string) => React.ReactNode
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(content)
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState('')

  function save() {
    const text = draft.trim()
    // An unchanged save is a cancel. Writing it anyway would stamp edited_at
    // and put "(edited)" on a note nobody edited.
    if (!text || text === content.trim()) { setEditing(false); setErr(''); return }
    setErr('')
    startTransition(async () => {
      try {
        await onSave(text)
        router.refresh()
        setEditing(false)
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Could not save.')
      }
    })
  }

  function cancel() { setDraft(content); setErr(''); setEditing(false) }

  if (editing) {
    return (
      <>
        <textarea
          value={draft}
          autoFocus
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') { e.preventDefault(); cancel() }
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); save() }
          }}
          rows={Math.min(12, Math.max(2, draft.split('\n').length + 1))}
          style={{
            width: '100%', fontSize: 13, lineHeight: 1.6, padding: '8px 10px',
            borderRadius: 8, border: '1px solid var(--border)',
            background: 'var(--surface-2)', color: 'var(--text-primary)', resize: 'vertical',
          }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={save} disabled={pending} style={{
            fontSize: 11.5, fontWeight: 700, padding: '5px 12px', borderRadius: 7,
            border: '1px solid var(--accent)', background: 'var(--accent-muted)',
            color: 'var(--accent)', cursor: pending ? 'wait' : 'pointer',
          }}>{pending ? 'Saving…' : 'Save'}</button>
          <button onClick={cancel} disabled={pending} style={{
            fontSize: 11.5, fontWeight: 600, padding: '5px 10px', borderRadius: 7,
            border: '1px solid var(--border)', background: 'none',
            color: 'var(--text-secondary)', cursor: 'pointer',
          }}>Cancel</button>
          <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>⌘↵ save · esc cancel</span>
        </div>
        {err && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6 }}>{err}</div>}
      </>
    )
  }

  return (
    <>
      <div style={style}>
        {render ? render(content) : content}
        {/* Every surface prints created_at. Without this, a note rewritten
            three days later still reads as posted on day one. */}
        {editedAt && (
          <span
            title={`Edited ${new Date(editedAt).toLocaleString('en-US')}`}
            style={{ fontSize: 10.5, color: 'var(--text-muted)', marginLeft: 6, fontStyle: 'italic' }}
          >(edited)</span>
        )}
      </div>
      {canEditNote && (
        <button onClick={() => setEditing(true)} style={{
          fontSize: 11, color: 'var(--text-muted)', background: 'none',
          border: 'none', padding: '3px 0 0', cursor: 'pointer',
        }}>Edit</button>
      )}
    </>
  )
}
