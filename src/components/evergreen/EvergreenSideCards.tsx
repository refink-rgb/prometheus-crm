'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Copy, ExternalLink, FileText, Pencil } from 'lucide-react'
import { useToast } from '@/components/Toast'
import { briefLinkLabel, countLabel, isSentBack, stampDate, type EvergreenAd, type EvergreenCreative } from '@/lib/evergreen'
import { updateEvergreenAd } from '@/lib/evergreen-actions'
import { SectionTitle } from './EvergreenComments'

// The detail page's side panel: brief link, client review link, team notes.

export function BriefCard({ adId, url, canEdit }: { adId: string; url: string | null; canEdit: boolean }) {
  const [editing, setEditing] = useState(!url && canEdit)
  const [draft, setDraft] = useState(url ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const [seenUrl, setSeenUrl] = useState(url)
  if (url !== seenUrl) { setSeenUrl(url); setDraft(url ?? ''); setEditing(!url && canEdit) }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const r = await updateEvergreenAd(adId, { briefUrl: draft })
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    setEditing(false)
    router.refresh()
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <SectionTitle>Brief</SectionTitle>
      {!editing && url ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <a href={url} target="_blank" rel="noopener noreferrer" title={url}
            style={{
              flex: 1, minWidth: 0, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderRadius: 8,
              background: 'var(--accent-muted)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
              color: 'var(--accent)', fontSize: 13, fontWeight: 600, textDecoration: 'none',
            }}>
            <FileText size={14} aria-hidden style={{ flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>Open brief · {briefLinkLabel(url)}</span>
            <ExternalLink size={12} aria-hidden style={{ flexShrink: 0 }} />
          </a>
          {canEdit && (
            <button type="button" className="btn-secondary btn-sm" aria-label="Edit brief link" title="Edit brief link" onClick={() => setEditing(true)}>
              <Pencil size={12} aria-hidden />
            </button>
          )}
        </div>
      ) : canEdit ? (
        <form onSubmit={save} style={{ display: 'grid', gap: 8 }}>
          <input type="text" inputMode="url" value={draft} onChange={e => setDraft(e.target.value)} disabled={busy}
            placeholder="Paste the Google Doc / Drive link" aria-label="Brief link" style={{ fontSize: 13 }} />
          {error && <p role="alert" style={{ margin: 0, color: 'var(--danger)', fontSize: 12 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            {url && <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => { setDraft(url); setEditing(false); setError('') }}>Cancel</button>}
            <button type="submit" className="btn-primary btn-sm" disabled={busy || (draft.trim() === (url ?? ''))}>{busy ? 'Saving…' : 'Save link'}</button>
          </div>
        </form>
      ) : (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>No brief link yet.</p>
      )}
    </div>
  )
}

export function ReviewLinkCard({ ad, creatives }: { ad: EvergreenAd; creatives: EvergreenCreative[] }) {
  const toast = useToast()
  const path = `/review/evergreen/${ad.share_token}`
  const visible = creatives.filter(c => c.client_visible)
  const statics = visible.filter(c => c.media_type === 'image').length
  const videos = visible.length - statics
  const approved = visible.filter(c => c.status === 'approved').length
  const changes = visible.filter(c => isSentBack(c.status)).length
  const onLink = [statics && countLabel(statics, 'image'), videos && countLabel(videos, 'video')].filter(Boolean).join(' and ') || 'Nothing'

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`)
      toast.success('Review link copied')
    } catch {
      toast.error('Could not copy. Open the link and copy it from the address bar.')
    }
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <SectionTitle>Client review</SectionTitle>
      {ad.client_approved ? (
        <div style={{
          padding: '8px 10px', borderRadius: 8, border: '1px solid color-mix(in srgb, var(--success) 25%, transparent)', fontSize: 12, fontWeight: 600, marginBottom: 10,
          background: 'color-mix(in srgb, var(--success) 10%, transparent)', color: 'var(--success)',
        }}>
          ✓ Approved by the client{ad.client_approved_at ? ` on ${stampDate(ad.client_approved_at)}` : ''}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10, lineHeight: 1.6 }}>
          {onLink} on the link
          {approved > 0 && <> · <span style={{ color: 'var(--success)' }}>{approved} approved</span></>}
          {changes > 0 && <> · <span style={{ color: 'var(--danger)' }}>{changes} sent back</span></>}
        </div>
      )}
      {ad.is_archived ? (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>Archived: the review link is turned off.</p>
      ) : (
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn-secondary btn-sm" onClick={copy} style={{ flex: 1 }}>
            <Copy size={12} aria-hidden /> Copy review link
          </button>
          <a href={path} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-sm" title="Open the client's view">
            <ExternalLink size={12} aria-hidden /> Open
          </a>
        </div>
      )}
    </div>
  )
}

export function NotesCard({ adId, notes, canEdit }: { adId: string; notes: string | null; canEdit: boolean }) {
  const [draft, setDraft] = useState(notes ?? '')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const router = useRouter()
  const [seenNotes, setSeenNotes] = useState(notes)
  if (notes !== seenNotes) { setSeenNotes(notes); setDraft(notes ?? '') }
  const dirty = draft.trim() !== (notes ?? '').trim()

  async function save() {
    setBusy(true)
    const r = await updateEvergreenAd(adId, { notes: draft })
    setBusy(false)
    if (!r.ok) { toast.error(r.error); return }
    toast.success('Notes saved')
    router.refresh()
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <SectionTitle>Team notes</SectionTitle>
      {canEdit ? (
        <>
          <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={4} placeholder="Internal notes, never shown to the client"
            aria-label="Team notes" disabled={busy} style={{ fontSize: 13, resize: 'vertical' }} />
          {dirty && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button type="button" className="btn-primary btn-sm" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save notes'}</button>
            </div>
          )}
        </>
      ) : (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{notes || 'No notes.'}</p>
      )}
    </div>
  )
}
