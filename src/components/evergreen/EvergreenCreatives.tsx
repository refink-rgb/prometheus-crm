'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, FolderOpen, RefreshCw, Trash2, Upload } from 'lucide-react'
import { CreativePlayer } from '@/components/CreativeMedia'
import { useConfirm } from '@/components/ConfirmDialog'
import { useToast } from '@/components/Toast'
import {
  EVERGREEN_IMAGE_TYPES, MEDIA_LABELS, REVIEW_STATUS_META, UPLOAD_ACCEPT, VIDEO_TYPES, evergreenMediaAsset,
  type EvergreenComment, type EvergreenCreative, type EvergreenMediaType,
} from '@/lib/evergreen'
import { copyEvergreenDriveFile, deleteEvergreenCreative, syncEvergreenDriveFolder, updateEvergreenCreative } from '@/lib/evergreen-actions'
import { uploadEvergreenFile } from '@/lib/evergreen-upload'
import { CommentList, SectionTitle, TeamNoteForm, useAction } from './EvergreenComments'
import { PinDot, pinNumbers } from './EvergreenPins'
import styles from './evergreen.module.css'

const ACCEPT_FOR: Record<EvergreenMediaType, string> = {
  image: Object.keys(EVERGREEN_IMAGE_TYPES).join(','),
  video: Object.keys(VIDEO_TYPES).join(','),
}

// ── Upload ──────────────────────────────────────────────────────────────────

/** Uploads statics and/or videos, or (replaceId) a new version of one. */
export function UploadButton({ adId, label, replace, primary = false }: {
  adId: string
  label: string
  replace?: { id: string; type: EvergreenMediaType }
  primary?: boolean
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
        const r = await uploadEvergreenFile(file, adId, replace?.id)
        if (!r.ok) toast.error(r.error)
        else done++
      } catch {
        toast.error(`${file.name}: upload failed. Please try again.`)
      }
    }
    setProgress(null)
    if (done) {
      toast.success(replace ? 'New version uploaded' : `${done} file${done === 1 ? '' : 's'} uploaded`)
      router.refresh()
    }
  }

  return (
    <>
      <input ref={input} type="file" accept={replace ? ACCEPT_FOR[replace.type] : UPLOAD_ACCEPT} multiple={!replace} hidden onChange={e => onFiles(e.target.files)} />
      <button type="button" className={primary ? 'btn-primary' : 'btn-secondary btn-sm'} disabled={!!progress} onClick={() => input.current?.click()}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {replace ? <RefreshCw size={12} aria-hidden /> : <Upload size={primary ? 14 : 12} aria-hidden />}
        {progress ?? label}
      </button>
    </>
  )
}

// ── From a Drive folder ─────────────────────────────────────────────────────
// Same as BFCM calibration: paste the folder, the CRM copies what's in it.
// One file per request, so a folder of large videos never times out.

export function DriveSyncCard({ adId, folderUrl, ready }: { adId: string; folderUrl: string | null; ready: boolean }) {
  const [folder, setFolder] = useState(folderUrl ?? '')
  const [seenUrl, setSeenUrl] = useState(folderUrl)
  if (folderUrl !== seenUrl) { setSeenUrl(folderUrl); setFolder(folderUrl ?? '') }
  const [busy, setBusy] = useState<string | null>(null)
  const [summary, setSummary] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const router = useRouter()

  async function sync(e: React.FormEvent) {
    e.preventDefault()
    if (!folder.trim() || busy) return
    setBusy('Reading the Drive folder…'); setErrors([]); setSummary('')
    try {
      const plan = await syncEvergreenDriveFolder(adId, folder)
      if (!plan.ok) { setErrors([plan.error]); return }
      const failed: string[] = []
      let added = 0, versions = 0
      for (const [i, file] of plan.files.entries()) {
        setBusy(`Copying ${i + 1} of ${plan.files.length} from Drive: ${file.name}`)
        try {
          const r = await copyEvergreenDriveFile(adId, file.id)
          if (!r.ok) failed.push(r.error)
          else if (r.outcome === 'added') added++
          else if (r.outcome === 'new_version') versions++
        } catch {
          failed.push(`${file.name}: the copy stopped. Sync again to retry.`)
        }
      }
      const total = plan.unchanged + added + versions
      const s = (n: number) => (n === 1 ? '' : 's')
      setSummary([
        plan.files.length === 0
          ? `Up to date: ${plan.unchanged} file${s(plan.unchanged)} already copied.`
          : added + versions === 0
            ? 'Nothing new was copied.'
            : [added && `${added} new file${s(added)}`, versions && `${versions} new version${s(versions)}`].filter(Boolean).join(' and ') + ` copied from Drive (${total} from this folder in all).`,
        plan.skipped.length ? `Skipped ${plan.skipped.length} file${s(plan.skipped.length)} that ${plan.skipped.length === 1 ? 'isn’t an image or video' : 'aren’t images or videos'}.` : '',
        plan.skippedFolders.length ? `Folders not opened: ${plan.skippedFolders.join(', ')}.` : '',
      ].filter(Boolean).join(' '))
      setErrors(failed)
    } catch {
      setErrors(['Could not reach the server. Please try again.'])
    } finally {
      setBusy(null)
      router.refresh()
    }
  }

  return (
    <div className="card" style={{ padding: 14, marginBottom: 18 }}>
      <form onSubmit={sync} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <FolderOpen size={15} aria-hidden style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <input type="text" inputMode="url" value={folder} onChange={e => setFolder(e.target.value)} disabled={!!busy || !ready}
          placeholder="Paste the Google Drive folder with the statics and videos" aria-label="Drive folder link"
          style={{ flex: 1, minWidth: 220, fontSize: 13 }} />
        <button type="submit" className="btn-secondary btn-sm" disabled={!!busy || !ready || !folder.trim()}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <RefreshCw size={12} aria-hidden /> {folderUrl ? 'Sync again' : 'Sync from Drive'}
        </button>
      </form>
      <p role="status" style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
        {!ready
          ? 'Drive sync needs the database change in the notice above.'
          : busy ?? (summary || 'Copies the images and videos in the folder, and in its Statics and Motion subfolders. Share it with the CRM’s Drive account, like Moments folders. Sync again after editing a file in Drive to send the new version.')}
      </p>
      {errors.length > 0 && (
        <ul role="alert" style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--danger)' }}>
          {errors.map((er, i) => <li key={i}>{er}</li>)}
        </ul>
      )}
    </div>
  )
}

// ── A section: Statics or Motion ────────────────────────────────────────────

export function CreativeSection({ type, creatives, comments, canEdit, adId }: {
  type: EvergreenMediaType
  creatives: EvergreenCreative[]
  comments: EvergreenComment[]
  canEdit: boolean
  adId: string
}) {
  if (!creatives.length) return null
  const sentBack = creatives.filter(c => c.client_visible && (c.status === 'needs_revision' || c.status === 'rejected')).length
  return (
    <section style={{ marginBottom: 24 }}>
      <SectionTitle>
        {MEDIA_LABELS[type].section} ({creatives.length})
        {sentBack > 0 && <span style={{ color: 'var(--danger)', marginLeft: 8 }}>{sentBack} sent back</span>}
      </SectionTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {creatives.map(c => (
          <CreativeRow key={c.id} creative={c} comments={comments.filter(cm => cm.video_id === c.id)} canEdit={canEdit} adId={adId} />
        ))}
      </div>
    </section>
  )
}

// ── One static or video ─────────────────────────────────────────────────────

function CreativeRow({ creative, comments, canEdit, adId }: {
  creative: EvergreenCreative
  comments: EvergreenComment[]
  canEdit: boolean
  adId: string
}) {
  const confirm = useConfirm()
  const { run, pending } = useAction()
  const meta = REVIEW_STATUS_META[creative.status]
  const label = MEDIA_LABELS[creative.media_type].one
  const openCount = comments.filter(c => c.audience === 'client' && !c.resolved_at).length
  // Numbered over open client notes only, the same ones the review link shows, so both number them alike.
  const pins = pinNumbers(comments.filter(c => c.audience === 'client' && !c.resolved_at))

  async function remove() {
    const ok = await confirm({ title: `Delete ${label}`, message: `Delete “${creative.name}” and its comments? This cannot be undone.`, confirmLabel: 'Delete', danger: true })
    if (ok) run(() => deleteEvergreenCreative(creative.id))
  }

  const pill: React.CSSProperties = { fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 12 }
  return (
    <div className={styles.videoRow} style={{
      display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px',
      border: `1px solid ${creative.status !== 'pending' ? meta.border : 'var(--border)'}`,
      borderRadius: 12, overflow: 'hidden', background: 'var(--surface)',
    }}>
      <div style={{ background: creative.media_type === 'image' ? 'var(--surface-raised)' : '#080808', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200 }}>
        {creative.media_type === 'image' ? (
          <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%' }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a stored upload, shown at its own size */}
            <img src={creative.video_url} alt={creative.name} style={{ display: 'block', maxWidth: '100%', maxHeight: 520 }} />
            {comments.filter(c => pins.has(c.id)).map(c => <PinDot key={c.id} x={c.pin_x!} y={c.pin_y!} label={String(pins.get(c.id))} />)}
          </div>
        ) : (
          <CreativePlayer asset={evergreenMediaAsset(creative)} src={creative.video_url} poster={creative.poster_url} audience="team" alt={creative.name}
            style={{ width: '100%', maxHeight: 520, display: 'block', objectFit: 'contain' }} />
        )}
      </div>

      <div style={{ borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', maxHeight: 520 }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={creative.name}>
              {creative.name}
            </span>
            {creative.version > 1 && <span className="badge" style={{ fontSize: 10 }}>v{creative.version}</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ ...pill, color: meta.color, background: meta.bg, border: `1px solid ${meta.border}` }}>{meta.label}</span>
            {!creative.client_visible && <span style={{ ...pill, color: 'var(--text-muted)', border: '1px dashed var(--border)' }}>Hidden from client</span>}
            {openCount > 0 && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{openCount} open comment{openCount === 1 ? '' : 's'}</span>}
          </div>
          {canEdit && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <UploadButton adId={adId} label="Upload new version" replace={{ id: creative.id, type: creative.media_type }} />
              <button type="button" className="btn-secondary btn-sm" disabled={pending}
                title={creative.client_visible ? 'Hide from the review link' : 'Show on the review link'}
                onClick={() => run(() => updateEvergreenCreative(creative.id, { clientVisible: !creative.client_visible }))}>
                {creative.client_visible ? <EyeOff size={12} aria-hidden /> : <Eye size={12} aria-hidden />}
                {creative.client_visible ? 'Hide' : 'Show'}
              </button>
              {creative.status !== 'pending' && (
                <button type="button" className="btn-secondary btn-sm" disabled={pending} title="Clear the client's decision"
                  onClick={() => run(() => updateEvergreenCreative(creative.id, { status: 'pending' }))}>
                  Reset status
                </button>
              )}
              <button type="button" className="btn-danger btn-sm" disabled={pending} aria-label={`Delete ${label}`} title={`Delete ${label}`} onClick={remove}>
                <Trash2 size={12} aria-hidden />
              </button>
            </div>
          )}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
          <CommentList comments={comments} canEdit={canEdit} pins={pins} />
        </div>
        {canEdit && (
          <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)' }}>
            <TeamNoteForm adId={adId} creativeId={creative.id} />
          </div>
        )}
      </div>
    </div>
  )
}
