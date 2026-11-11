'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Archive, CalendarDays, Pencil, Trash2 } from 'lucide-react'
import AssigneePicker, { type Person } from '@/components/AssigneePicker'
import { useConfirm } from '@/components/ConfirmDialog'
import { useToast } from '@/components/Toast'
import {
  EVERGREEN_STAGES, EVERGREEN_STAGE_COLORS, EVERGREEN_STAGE_LABELS, TEAM_MIGRATION_FILE,
  type EvergreenAd, type EvergreenComment, type EvergreenCreative, type EvergreenStage,
} from '@/lib/evergreen'
import { deleteEvergreenAd, moveEvergreenAd, setEvergreenAdArchived, setEvergreenAdAssignees, updateEvergreenAd } from '@/lib/evergreen-actions'
import { CommentList, SectionTitle, TeamNoteForm, useAction } from './EvergreenComments'
import { CreativeSection, DriveSyncCard, UploadButton } from './EvergreenCreatives'
import { BriefCard, NotesCard, ReviewLinkCard } from './EvergreenSideCards'
import MigrationNotice from './MigrationNotice'
import styles from './evergreen.module.css'

export default function EvergreenAdDetail({ ad, brandName, creatives, comments, canEdit, people, assignees, teamReady, driveFolderUrl, today }: {
  ad: EvergreenAd
  brandName: string
  creatives: EvergreenCreative[]
  comments: EvergreenComment[]
  canEdit: boolean
  people: Person[]
  assignees: string[]
  /** False until the 20261110 migration runs: people, due dates, statics and Drive sync stay off. */
  teamReady: boolean
  driveFolderUrl: string | null
  today: string
}) {
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const { run, pending } = useAction()
  const [moving, startMove] = useTransition()
  const [stage, setStage] = useState<EvergreenStage>(ad.stage)
  // Follow the server's stage after a refresh (reset during render, not in an effect).
  const [seenStage, setSeenStage] = useState(ad.stage)
  if (ad.stage !== seenStage) { setSeenStage(ad.stage); setStage(ad.stage) }
  const busy = pending || moving

  function changeStage(next: EvergreenStage) {
    if (!canEdit || next === stage) return
    const prev = stage
    setStage(next)
    startMove(async () => {
      const r = await moveEvergreenAd(ad.id, next)
      if (!r.ok) { setStage(prev); toast.error(r.error); return }
      router.refresh()
    })
  }

  async function archive() {
    const ok = await confirm({ title: 'Archive ad', message: `Archive “${ad.name}”? It leaves the board and its review link stops working.`, confirmLabel: 'Archive' })
    if (!ok) return
    const r = await setEvergreenAdArchived(ad.id, true)
    if (!r.ok) { toast.error(r.error); return }
    toast.success('Ad archived')
    router.push('/evergreen-ads')
  }

  async function remove() {
    const ok = await confirm({ title: 'Delete ad', message: `Delete “${ad.name}”, its statics, videos and all comments? This cannot be undone.`, confirmLabel: 'Delete', danger: true })
    if (!ok) return
    const r = await deleteEvergreenAd(ad.id)
    if (!r.ok) { toast.error(r.error); return }
    toast.success('Ad deleted')
    router.push('/evergreen-ads')
  }

  const statics = creatives.filter(c => c.media_type === 'image')
  const videos = creatives.filter(c => c.media_type === 'video')
  const late = !!ad.due_date && ad.stage !== 'live' && ad.due_date < today

  return (
    <div>
      <Link href="/evergreen-ads" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', textDecoration: 'none' }}>
        ← Evergreen Ads
      </Link>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', margin: '10px 0 14px' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginBottom: 4 }}>{brandName} · Evergreen ad</p>
          <EditableTitle value={ad.name} canEdit={canEdit} onSave={name => updateEvergreenAd(ad.id, { name })} />
        </div>
        {canEdit && (
          <div style={{ display: 'flex', gap: 8 }}>
            {ad.is_archived ? (
              <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => run(() => setEvergreenAdArchived(ad.id, false), 'Ad restored to the board')}>
                Restore to board
              </button>
            ) : (
              <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={archive}>
                <Archive size={13} aria-hidden /> Archive
              </button>
            )}
            <button type="button" className="btn-danger btn-sm" disabled={busy} onClick={remove}>
              <Trash2 size={13} aria-hidden /> Delete
            </button>
          </div>
        )}
      </div>

      {!teamReady && canEdit && (
        <MigrationNotice file={TEAM_MIGRATION_FILE} title="People, due dates and statics are off." what="to turn them on, then reload." />
      )}

      {/* Stage, people, due date */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 22 }}>
        <div role="group" aria-label="Stage" style={{ display: 'inline-flex', padding: 3, gap: 2, border: '1px solid var(--border)', borderRadius: 20, background: 'var(--surface)', flexWrap: 'wrap' }}>
          {EVERGREEN_STAGES.map(s => {
            const active = s === stage
            const c = EVERGREEN_STAGE_COLORS[s]
            return (
              <button key={s} type="button" className="focus-ring-pill" aria-pressed={active} disabled={!canEdit || busy} onClick={() => changeStage(s)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 16, border: 'none', whiteSpace: 'nowrap',
                  fontSize: 'var(--text-sm)', fontWeight: active ? 700 : 500, cursor: canEdit ? 'pointer' : 'default',
                  background: active ? c.bg : 'transparent', color: active ? c.text : 'var(--text-secondary)',
                }}>
                <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: c.border }} />
                {EVERGREEN_STAGE_LABELS[s]}
              </button>
            )
          })}
        </div>

        {teamReady && (
          <>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span style={metaLabel}>People</span>
              <AssigneePicker people={people} selected={assignees} disabled={!canEdit || busy} title={ad.name} align="left" showNames
                onChange={ids => run(() => setEvergreenAdAssignees(ad.id, ids))} />
            </div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, margin: 0 }}>
              <span style={metaLabel}><CalendarDays size={12} aria-hidden /> Due</span>
              <input type="date" value={ad.due_date ?? ''} disabled={!canEdit || busy} aria-label="Due date"
                onChange={e => run(() => updateEvergreenAd(ad.id, { dueDate: e.target.value || null }))}
                style={{ width: 'auto', padding: '5px 8px', fontSize: 13, color: late ? 'var(--urgent-overdue, var(--danger))' : undefined, borderColor: late ? 'var(--danger)' : undefined }} />
              {late && <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--urgent-overdue, var(--danger))' }}>Late</span>}
            </label>
          </>
        )}
      </div>

      <div className={styles.detailGrid} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: 20, alignItems: 'start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
            <SectionTitle>Creatives for review</SectionTitle>
            {canEdit && <UploadButton adId={ad.id} label={teamReady ? 'Upload statics or videos' : 'Upload videos'} primary />}
          </div>

          {canEdit && <DriveSyncCard adId={ad.id} folderUrl={driveFolderUrl} ready={teamReady} />}

          {creatives.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 14, padding: '40px 20px' }}>
              Nothing to review yet. Upload the statics and motion cuts, or sync them from a Drive folder. They go to the client on the review link.
            </div>
          ) : (
            <>
              <CreativeSection type="image" creatives={statics} comments={comments} canEdit={canEdit} adId={ad.id} />
              <CreativeSection type="video" creatives={videos} comments={comments} canEdit={canEdit} adId={ad.id} />
            </>
          )}
        </div>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <BriefCard adId={ad.id} url={ad.brief_url} canEdit={canEdit} />
          <ReviewLinkCard ad={ad} creatives={creatives} />
          <NotesCard adId={ad.id} notes={ad.notes} canEdit={canEdit} />
          <div className="card" style={{ padding: 16 }}>
            <SectionTitle>General feedback</SectionTitle>
            <CommentList comments={comments.filter(c => !c.video_id)} canEdit={canEdit} />
            {canEdit && <TeamNoteForm adId={ad.id} creativeId={null} />}
          </div>
        </aside>
      </div>
    </div>
  )
}

const metaLabel: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 4 }

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
        <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} maxLength={200} disabled={busy} aria-label="Ad name" style={{ fontSize: 18, fontWeight: 700 }} />
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
