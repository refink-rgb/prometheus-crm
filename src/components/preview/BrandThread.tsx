'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { addBrandComment, deleteBrandComment, editBrandComment } from '@/lib/actions'
import EditableNoteBody from './EditableNoteBody'
import type { BrandComment } from '@/lib/types'

// What the team knows about a brand, accumulated.
//
// Brand-level, not project-level: the knowledge outlives any one moment and has
// to be there on the next project, and on the one after the brand changes hands.
//
// A thread rather than the single shared text box it replaces, because two
// people writing at once used to mean one of them silently lost their edit.
// Nobody overwrites anyone here.

export default function BrandThread({
  brandId, brandName, projectId, comments, currentUserId, compact = false,
}: {
  brandId: string
  brandName: string
  projectId: string
  comments: BrandComment[]
  currentUserId: string | null
  compact?: boolean
}) {
  const router = useRouter()
  const [draft, setDraft] = useState('')
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(!compact)
  const [showAll, setShowAll] = useState(false)

  // On the Creatives tab this is reference an editor skims before starting, so
  // it opens showing the newest few rather than a wall of history.
  const shown = compact && !showAll ? comments.slice(0, 3) : comments

  function post() {
    const text = draft.trim()
    if (!text) return
    setErr('')
    startTransition(async () => {
      try {
        const r = await addBrandComment(brandId, text, projectId)
        if (!r.ok) { setErr(r.error); return }
        setDraft('')
        router.refresh()
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Could not post.')
      }
    })
  }

  function remove(id: string) {
    setErr('')
    startTransition(async () => {
      try {
        const r = await deleteBrandComment(id, brandId, projectId)
        if (!r.ok) { setErr(r.error); return }
        router.refresh()
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Could not delete.')
      }
    })
  }

  const body = (
    <>
      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); post() } }}
        rows={2}
        placeholder={`What should the next person working on ${brandName} know?`}
        style={{ width: '100%', fontSize: 13, lineHeight: 1.5, padding: '9px 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-primary)', resize: 'vertical' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, marginBottom: 14 }}>
        <button
          onClick={post}
          disabled={pending || !draft.trim()}
          style={{
            fontSize: 11.5, fontWeight: 700, padding: '6px 13px', borderRadius: 7,
            cursor: pending || !draft.trim() ? 'not-allowed' : 'pointer',
            border: `1px solid ${draft.trim() ? 'var(--accent)' : 'var(--border)'}`,
            background: draft.trim() ? 'var(--accent-muted)' : 'transparent',
            color: draft.trim() ? 'var(--accent)' : 'var(--text-muted)',
          }}
        >{pending ? 'Posting…' : 'Post'}</button>
        <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
          Shows on every {brandName} project · ⌘↵
        </span>
      </div>

      {comments.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Nothing yet.</div>
      ) : (
        <>
          {shown.map(c => (
            <div key={c.id} style={{ padding: '9px 0', borderTop: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <strong style={{ fontSize: 12 }}>{c.author_name}</strong>
                <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                  {new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
                {/* Own posts only — everyone here has full edit rights, so anyone
                    could otherwise quietly remove a colleague's warning. */}
                {currentUserId && c.author_id === currentUserId && (
                  <button
                    onClick={() => remove(c.id)}
                    disabled={pending}
                    title="Delete this note"
                    style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                  >✕</button>
                )}
              </div>
              <EditableNoteBody
                content={c.content}
                editedAt={c.edited_at ?? null}
                canEditNote={!!currentUserId && c.author_id === currentUserId}
                onSave={async t => {
                  const r = await editBrandComment(c.id, brandId, t, projectId)
                  if (!r.ok) throw new Error(r.error)
                }}
                style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', color: 'var(--text-secondary)', marginTop: 3, maxWidth: '80ch' }}
              />
            </div>
          ))}
          {compact && comments.length > shown.length && (
            <button
              onClick={() => setShowAll(true)}
              style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--accent)', background: 'none', border: 'none', padding: '8px 0 0', cursor: 'pointer' }}
            >Show all {comments.length}</button>
          )}
        </>
      )}

      {err && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 8 }}>{err}</div>}
    </>
  )

  if (compact) {
    return (
      <div style={{ border: '1px solid var(--border)', borderRadius: 10, marginBottom: 20 }}>
        <button
          onClick={() => setOpen(v => !v)}
          aria-expanded={open}
          style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '10px 12px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)' }}
        >
          <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 10 }}>{open ? '▾' : '▸'}</span>
          <span style={{ fontSize: 12, fontWeight: 700 }}>About {brandName}</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {comments.length === 0 ? 'nothing yet' : `${comments.length} note${comments.length === 1 ? '' : 's'}`}
          </span>
        </button>
        {open && <div style={{ padding: '0 12px 12px 30px' }}>{body}</div>}
      </div>
    )
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 20 }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 10 }}>
        About {brandName} · every project
      </div>
      {body}
    </div>
  )
}
