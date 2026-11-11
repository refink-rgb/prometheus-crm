'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, X } from 'lucide-react'
import { useConfirm } from '@/components/ConfirmDialog'
import { useToast } from '@/components/Toast'
import { stampDate, type EvergreenComment } from '@/lib/evergreen'
import { addEvergreenTeamNote, deleteEvergreenComment, setEvergreenCommentResolved } from '@/lib/evergreen-actions'

// Comment pieces shared by the staff detail page: the thread on each static or
// video (client feedback and team notes) and the note form.

type ActionResult = { ok: true } | { ok: false; error: string }

/** Runs a staff action: a toast on failure, a refresh on success. */
export function useAction() {
  const router = useRouter()
  const toast = useToast()
  const [pending, startTransition] = useTransition()
  const run = (fn: () => Promise<ActionResult>, success?: string) => startTransition(async () => {
    const r = await fn()
    if (!r.ok) { toast.error(r.error); return }
    if (success) toast.success(success)
    router.refresh()
  })
  return { run, pending }
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
      {children}
    </h2>
  )
}

export function CommentList({ comments, canEdit, pins }: { comments: EvergreenComment[]; canEdit: boolean; pins?: Map<string, number> }) {
  const confirm = useConfirm()
  const { run } = useAction()

  async function remove(id: string) {
    const ok = await confirm({ title: 'Delete comment', message: 'Delete this comment? This cannot be undone.', confirmLabel: 'Delete', danger: true })
    if (ok) run(() => deleteEvergreenComment(id))
  }

  if (!comments.length) return <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--text-muted)' }}>No comments yet.</p>

  const iconButton: React.CSSProperties = { background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2, lineHeight: 0 }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
      {comments.map(c => {
        const internal = c.audience === 'internal'
        const resolved = !!c.resolved_at
        const pin = pins?.get(c.id)
        return (
          <div key={c.id} style={{
            padding: '9px 11px', borderRadius: 8, opacity: resolved ? 0.55 : 1,
            border: `1px solid ${internal ? 'color-mix(in srgb, var(--accent) 25%, var(--border))' : 'var(--border)'}`,
            background: internal ? 'color-mix(in srgb, var(--accent) 5%, var(--surface-raised))' : 'var(--surface-raised)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              {pin && <span title="Pinned on the static" style={{ fontSize: 10, fontWeight: 700, color: '#fff', background: 'var(--accent)', borderRadius: 10, padding: '0 6px', lineHeight: '16px' }}>{pin}</span>}
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.author_name}
                <span style={{ fontWeight: 500, fontSize: 10, color: internal ? 'var(--accent)' : 'var(--warning)', marginLeft: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {internal ? 'Team' : 'Client'}
                </span>
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{stampDate(c.created_at)}</span>
              {canEdit && !internal && (
                <button type="button" onClick={() => run(() => setEvergreenCommentResolved(c.id, !resolved))}
                  aria-label={resolved ? 'Reopen comment' : 'Mark as done'} title={resolved ? 'Reopen (shows on the review link again)' : 'Mark as done (drops off the review link)'}
                  style={{ ...iconButton, color: resolved ? 'var(--success)' : 'var(--text-muted)' }}>
                  <Check size={13} aria-hidden />
                </button>
              )}
              {canEdit && (
                <button type="button" onClick={() => remove(c.id)} aria-label="Delete comment" title="Delete comment" style={iconButton}>
                  <X size={13} aria-hidden />
                </button>
              )}
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55, margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', textDecoration: resolved ? 'line-through' : undefined }}>
              {c.content}
            </p>
          </div>
        )
      })}
    </div>
  )
}

export function TeamNoteForm({ adId, creativeId }: { adId: string; creativeId: string | null }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const router = useRouter()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    setBusy(true)
    const r = await addEvergreenTeamNote(adId, creativeId, text)
    setBusy(false)
    if (!r.ok) { toast.error(r.error); return }
    setText('')
    router.refresh()
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', gap: 6 }}>
      <input value={text} onChange={e => setText(e.target.value)} placeholder="Team note (not shown to client)" aria-label="Team note" disabled={busy} style={{ fontSize: 12 }} />
      <button type="submit" className="btn-secondary btn-sm" disabled={busy || !text.trim()}>{busy ? '…' : 'Add'}</button>
    </form>
  )
}
