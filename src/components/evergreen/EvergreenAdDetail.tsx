'use client'

import { useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Archive, Check, Copy, ExternalLink, Eye, EyeOff, FileText, Pencil, RefreshCw, Trash2, Upload, X } from 'lucide-react'
import { CreativePlayer } from '@/components/CreativeMedia'
import { useConfirm } from '@/components/ConfirmDialog'
import { useToast } from '@/components/Toast'
import {
  EVERGREEN_STAGES, EVERGREEN_STAGE_COLORS, EVERGREEN_STAGE_LABELS, VIDEO_STATUS_META, briefLinkLabel, evergreenMediaAsset,
  type EvergreenAd, type EvergreenComment, type EvergreenStage, type EvergreenVideo,
} from '@/lib/evergreen'
import {
  addEvergreenTeamNote, deleteEvergreenAd, deleteEvergreenComment, deleteEvergreenVideo, moveEvergreenAd,
  setEvergreenAdArchived, setEvergreenCommentResolved, updateEvergreenAd, updateEvergreenVideo,
} from '@/lib/evergreen-actions'
import { uploadEvergreenVideo } from '@/lib/evergreen-upload'
import styles from './evergreen.module.css'

const VIDEO_ACCEPT = 'video/mp4,video/quicktime,video/webm,video/x-m4v'

export default function EvergreenAdDetail({ ad, brandName, videos, comments, canEdit }: {
  ad: EvergreenAd
  brandName: string
  videos: EvergreenVideo[]
  comments: EvergreenComment[]
  canEdit: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const [pending, startTransition] = useTransition()
  const [stage, setStage] = useState<EvergreenStage>(ad.stage)
  // Follow the server's stage after a refresh (reset during render, not in an effect).
  const [seenStage, setSeenStage] = useState(ad.stage)
  if (ad.stage !== seenStage) { setSeenStage(ad.stage); setStage(ad.stage) }

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, success?: string) {
    startTransition(async () => {
      const r = await fn()
      if (!r.ok) { toast.error(r.error); return }
      if (success) toast.success(success)
      router.refresh()
    })
  }

  function changeStage(next: EvergreenStage) {
    if (!canEdit || next === stage) return
    const prev = stage
    setStage(next)
    startTransition(async () => {
      const r = await moveEvergreenAd(ad.id, next)
      if (!r.ok) { setStage(prev); toast.error(r.error); return }
      router.refresh()
    })
  }

  async function archive() {
    const ok = await confirm({
      title: 'Archive ad',
      message: `Archive “${ad.name}”? It leaves the board and its review link stops working.`,
      confirmLabel: 'Archive',
    })
    if (!ok) return
    const r = await setEvergreenAdArchived(ad.id, true)
    if (!r.ok) { toast.error(r.error); return }
    toast.success('Ad archived')
    router.push('/evergreen-ads')
  }

  async function remove() {
    const ok = await confirm({
      title: 'Delete ad',
      message: `Delete “${ad.name}”, its videos and all comments? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    const r = await deleteEvergreenAd(ad.id)
    if (!r.ok) { toast.error(r.error); return }
    toast.success('Ad deleted')
    router.push('/evergreen-ads')
  }

  const generalComments = comments.filter(c => !c.video_id)

  return (
    <div>
      <Link href="/evergreen-ads" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', textDecoration: 'none' }}>
        ← Evergreen Ads
      </Link>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', margin: '10px 0 18px' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginBottom: 4 }}>{brandName} · Evergreen ad</p>
          <EditableTitle value={ad.name} canEdit={canEdit} onSave={name => updateEvergreenAd(ad.id, { name })} />
        </div>
        {canEdit && (
          <div style={{ display: 'flex', gap: 8 }}>
            {ad.is_archived ? (
              <button type="button" className="btn-secondary btn-sm" disabled={pending} onClick={() => run(() => setEvergreenAdArchived(ad.id, false), 'Ad restored to the board')}>
                Restore to board
              </button>
            ) : (
              <button type="button" className="btn-secondary btn-sm" disabled={pending} onClick={archive}>
                <Archive size={13} aria-hidden /> Archive
              </button>
            )}
            <button type="button" className="btn-danger btn-sm" disabled={pending} onClick={remove}>
              <Trash2 size={13} aria-hidden /> Delete
            </button>
          </div>
        )}
      </div>

      {/* Stage */}
      <div role="group" aria-label="Stage" style={{ display: 'inline-flex', padding: 3, gap: 2, border: '1px solid var(--border)', borderRadius: 20, background: 'var(--surface)', marginBottom: 22, flexWrap: 'wrap' }}>
        {EVERGREEN_STAGES.map(s => {
          const active = s === stage
          const c = EVERGREEN_STAGE_COLORS[s]
          return (
            <button
              key={s}
              type="button"
              className="focus-ring-pill"
              aria-pressed={active}
              disabled={!canEdit || pending}
              onClick={() => changeStage(s)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', borderRadius: 16, border: 'none', whiteSpace: 'nowrap',
                fontSize: 'var(--text-sm)', fontWeight: active ? 700 : 500, cursor: canEdit ? 'pointer' : 'default',
                background: active ? c.bg : 'transparent',
                color: active ? c.text : 'var(--text-secondary)',
              }}
            >
              <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: c.border }} />
              {EVERGREEN_STAGE_LABELS[s]}
            </button>
          )
        })}
      </div>

      <div className={styles.detailGrid} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: 20, alignItems: 'start' }}>
        {/* Videos */}
        <section>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
            <SectionTitle>Motion videos {videos.length > 0 ? `(${videos.length})` : ''}</SectionTitle>
            {canEdit && <UploadButton adId={ad.id} label="Upload videos" multiple />}
          </div>

          {videos.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 14, padding: '40px 20px' }}>
              No videos yet. Upload the motion cuts here — they go to the client on the review link.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {videos.map(v => (
                <VideoRow
                  key={v.id}
                  video={v}
                  comments={comments.filter(c => c.video_id === v.id)}
                  canEdit={canEdit}
                  adId={ad.id}
                />
              ))}
            </div>
          )}
        </section>

        {/* Side panel */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <BriefCard adId={ad.id} url={ad.brief_url} canEdit={canEdit} />
          <ReviewLinkCard ad={ad} videos={videos} />
          <NotesCard adId={ad.id} notes={ad.notes} canEdit={canEdit} />
          <div className="card" style={{ padding: 16 }}>
            <SectionTitle>General feedback</SectionTitle>
            <CommentList comments={generalComments} canEdit={canEdit} />
            {canEdit && <TeamNoteForm adId={ad.id} videoId={null} />}
          </div>
        </aside>
      </div>
    </div>
  )
}

// ── Header title ────────────────────────────────────────────────────────────

function EditableTitle({ value, canEdit, onSave }: {
  value: string
  canEdit: boolean
  onSave: (v: string) => Promise<{ ok: true } | { ok: false; error: string }>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const router = useRouter()

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!draft.trim() || draft.trim() === value) { setEditing(false); return }
    setBusy(true)
    const r = await onSave(draft)
    setBusy(false)
    if (!r.ok) { toast.error(r.error); return }
    setEditing(false)
    router.refresh()
  }

  if (editing) {
    return (
      <form onSubmit={save} style={{ display: 'flex', gap: 8, alignItems: 'center', maxWidth: 640 }}>
        <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} maxLength={200} disabled={busy} style={{ fontSize: 18, fontWeight: 700 }} />
        <button type="submit" className="btn-primary btn-sm" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => { setDraft(value); setEditing(false) }}>Cancel</button>
      </form>
    )
  }
  return (
    <h1 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', wordBreak: 'break-word' }}>
      {value}
      {canEdit && (
        <button type="button" aria-label="Rename ad" title="Rename" onClick={() => { setDraft(value); setEditing(true) }}
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}>
          <Pencil size={14} aria-hidden />
        </button>
      )}
    </h1>
  )
}

// ── Brief link ──────────────────────────────────────────────────────────────

function BriefCard({ adId, url, canEdit }: { adId: string; url: string | null; canEdit: boolean }) {
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

// ── Client review link ──────────────────────────────────────────────────────

function ReviewLinkCard({ ad, videos }: { ad: EvergreenAd; videos: EvergreenVideo[] }) {
  const toast = useToast()
  const path = `/review/evergreen/${ad.share_token}`
  const visible = videos.filter(v => v.client_visible)
  const approved = visible.filter(v => v.status === 'approved').length
  const changes = visible.filter(v => v.status === 'needs_revision' || v.status === 'rejected').length

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`)
      toast.success('Review link copied')
    } catch {
      toast.error('Could not copy — open the link and copy it from the address bar.')
    }
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <SectionTitle>Client review</SectionTitle>
      {ad.client_approved ? (
        <div style={{ ...statusBox, background: 'color-mix(in srgb, var(--success) 10%, transparent)', borderColor: 'color-mix(in srgb, var(--success) 25%, transparent)', color: 'var(--success)' }}>
          ✓ Approved by the client{ad.client_approved_at ? ` on ${new Date(ad.client_approved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10, lineHeight: 1.6 }}>
          {visible.length} video{visible.length === 1 ? '' : 's'} on the link
          {approved > 0 && <> · <span style={{ color: 'var(--success)' }}>{approved} approved</span></>}
          {changes > 0 && <> · <span style={{ color: 'var(--danger)' }}>{changes} sent back</span></>}
        </div>
      )}
      {ad.is_archived ? (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>Archived — the review link is turned off.</p>
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

const statusBox: React.CSSProperties = {
  padding: '8px 10px', borderRadius: 8, border: '1px solid', fontSize: 12, fontWeight: 600, marginBottom: 10,
}

// ── Notes ───────────────────────────────────────────────────────────────────

function NotesCard({ adId, notes, canEdit }: { adId: string; notes: string | null; canEdit: boolean }) {
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
          <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={4} placeholder="Internal notes — never shown to the client"
            disabled={busy} style={{ fontSize: 13, resize: 'vertical' }} />
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

// ── Videos ──────────────────────────────────────────────────────────────────

function UploadButton({ adId, label, multiple = false, replaceVideoId = null, small = false }: {
  adId: string
  label: string
  multiple?: boolean
  replaceVideoId?: string | null
  small?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const toast = useToast()
  const router = useRouter()

  async function onFiles(files: FileList | null) {
    const list = Array.from(files ?? [])
    if (input.current) input.current.value = ''
    if (!list.length) return
    let done = 0
    for (const [i, file] of list.entries()) {
      setProgress(list.length > 1 ? `Uploading ${i + 1} of ${list.length}…` : 'Uploading…')
      try {
        const r = await uploadEvergreenVideo(file, adId, replaceVideoId)
        if (!r.ok) toast.error(r.error)
        else done++
      } catch {
        toast.error(`${file.name}: upload failed. Please try again.`)
      }
    }
    setProgress(null)
    if (done) {
      toast.success(replaceVideoId ? 'New cut uploaded' : `${done} video${done === 1 ? '' : 's'} uploaded`)
      router.refresh()
    }
  }

  return (
    <>
      <input ref={input} type="file" accept={VIDEO_ACCEPT} multiple={multiple} hidden onChange={e => onFiles(e.target.files)} />
      <button
        type="button"
        className={small ? 'btn-secondary btn-sm' : 'btn-primary'}
        disabled={!!progress}
        onClick={() => input.current?.click()}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
      >
        {replaceVideoId ? <RefreshCw size={12} aria-hidden /> : <Upload size={small ? 12 : 14} aria-hidden />}
        {progress ?? label}
      </button>
    </>
  )
}

function VideoRow({ video, comments, canEdit, adId }: {
  video: EvergreenVideo
  comments: EvergreenComment[]
  canEdit: boolean
  adId: string
}) {
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const meta = VIDEO_STATUS_META[video.status]
  const openCount = comments.filter(c => c.audience === 'client' && !c.resolved_at).length

  async function act(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setBusy(true)
    const r = await fn()
    setBusy(false)
    if (!r.ok) { toast.error(r.error); return }
    router.refresh()
  }

  async function remove() {
    const ok = await confirm({ title: 'Delete video', message: `Delete “${video.name}” and its comments? This cannot be undone.`, confirmLabel: 'Delete', danger: true })
    if (ok) act(() => deleteEvergreenVideo(video.id))
  }

  return (
    <div className={styles.videoRow} style={{
      display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px',
      border: `1px solid ${video.status !== 'pending' ? meta.border : 'var(--border)'}`,
      borderRadius: 12, overflow: 'hidden', background: 'var(--surface)',
    }}>
      <div style={{ background: '#080808', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CreativePlayer
          asset={evergreenMediaAsset(video)}
          src={video.video_url}
          poster={video.poster_url}
          audience="team"
          alt={video.name}
          style={{ width: '100%', maxHeight: 520, display: 'block', objectFit: 'contain' }}
        />
      </div>

      <div style={{ borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', maxHeight: 520 }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={video.name}>
              {video.name}
            </span>
            {video.version > 1 && <span className="badge" style={{ fontSize: 10 }}>v{video.version}</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 12, color: meta.color, background: meta.bg, border: `1px solid ${meta.border}` }}>
              {meta.label}
            </span>
            {!video.client_visible && (
              <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 12, color: 'var(--text-muted)', border: '1px dashed var(--border)' }}>
                Hidden from client
              </span>
            )}
            {openCount > 0 && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{openCount} open comment{openCount === 1 ? '' : 's'}</span>}
          </div>
          {canEdit && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <UploadButton adId={adId} label="Upload new cut" replaceVideoId={video.id} small />
              <button type="button" className="btn-secondary btn-sm" disabled={busy}
                title={video.client_visible ? 'Hide this video from the review link' : 'Show this video on the review link'}
                onClick={() => act(() => updateEvergreenVideo(video.id, { clientVisible: !video.client_visible }))}>
                {video.client_visible ? <EyeOff size={12} aria-hidden /> : <Eye size={12} aria-hidden />}
                {video.client_visible ? 'Hide' : 'Show'}
              </button>
              {video.status !== 'pending' && (
                <button type="button" className="btn-secondary btn-sm" disabled={busy} title="Clear the client's decision on this video"
                  onClick={() => act(() => updateEvergreenVideo(video.id, { status: 'pending' }))}>
                  Reset status
                </button>
              )}
              <button type="button" className="btn-danger btn-sm" disabled={busy} aria-label="Delete video" title="Delete video" onClick={remove}>
                <Trash2 size={12} aria-hidden />
              </button>
            </div>
          )}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
          <CommentList comments={comments} canEdit={canEdit} />
        </div>
        {canEdit && (
          <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)' }}>
            <TeamNoteForm adId={adId} videoId={video.id} />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Comments ────────────────────────────────────────────────────────────────

function CommentList({ comments, canEdit }: { comments: EvergreenComment[]; canEdit: boolean }) {
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const [, startTransition] = useTransition()

  function act(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    startTransition(async () => {
      const r = await fn()
      if (!r.ok) { toast.error(r.error); return }
      router.refresh()
    })
  }
  async function remove(id: string) {
    const ok = await confirm({ title: 'Delete comment', message: 'Delete this comment? This cannot be undone.', confirmLabel: 'Delete', danger: true })
    if (ok) act(() => deleteEvergreenComment(id))
  }

  if (!comments.length) return <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--text-muted)' }}>No comments yet.</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
      {comments.map(c => {
        const internal = c.audience === 'internal'
        const resolved = !!c.resolved_at
        return (
          <div key={c.id} style={{
            padding: '9px 11px', borderRadius: 8, opacity: resolved ? 0.55 : 1,
            border: `1px solid ${internal ? 'color-mix(in srgb, var(--accent) 25%, var(--border))' : 'var(--border)'}`,
            background: internal ? 'color-mix(in srgb, var(--accent) 5%, var(--surface-raised))' : 'var(--surface-raised)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.author_name}
                <span style={{ fontWeight: 500, fontSize: 10, color: internal ? 'var(--accent)' : 'var(--warning)', marginLeft: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {internal ? 'Team' : 'Client'}
                </span>
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                {new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
              {canEdit && !internal && (
                <button type="button" onClick={() => act(() => setEvergreenCommentResolved(c.id, !resolved))}
                  aria-label={resolved ? 'Reopen comment' : 'Mark as done'} title={resolved ? 'Reopen (shows on the review link again)' : 'Mark as done (drops off the review link)'}
                  style={{ background: 'none', border: 'none', color: resolved ? 'var(--success)' : 'var(--text-muted)', cursor: 'pointer', padding: 2, lineHeight: 0 }}>
                  <Check size={13} aria-hidden />
                </button>
              )}
              {canEdit && (
                <button type="button" onClick={() => remove(c.id)} aria-label="Delete comment" title="Delete comment"
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2, lineHeight: 0 }}>
                  <X size={13} aria-hidden />
                </button>
              )}
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55, margin: 0, whiteSpace: 'pre-wrap', textDecoration: resolved ? 'line-through' : undefined }}>
              {c.content}
            </p>
          </div>
        )
      })}
    </div>
  )
}

function TeamNoteForm({ adId, videoId }: { adId: string; videoId: string | null }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const router = useRouter()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    setBusy(true)
    const r = await addEvergreenTeamNote(adId, videoId, text)
    setBusy(false)
    if (!r.ok) { toast.error(r.error); return }
    setText('')
    router.refresh()
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', gap: 6 }}>
      <input value={text} onChange={e => setText(e.target.value)} placeholder="Team note (not shown to client)" disabled={busy} style={{ fontSize: 12 }} />
      <button type="submit" className="btn-secondary btn-sm" disabled={busy || !text.trim()}>{busy ? '…' : 'Add'}</button>
    </form>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
      {children}
    </h2>
  )
}
