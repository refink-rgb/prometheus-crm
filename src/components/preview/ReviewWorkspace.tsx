'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { CreativeAsset, ProjectComment } from '@/lib/types'
import type { AssetRevision } from '@/lib/revisions'
import { driveThumb, resizeDriveThumb } from '@/lib/drive-thumb'
import { uploadRevisionFile } from '@/lib/upload-revision'
import BulkRevisionUpload from './BulkRevisionUpload'
import {
  updateAssetStatusInternal,
  setAssetClientVisible,
  publishAssets,
  toggleCommentResolved,
  setClientVersion,
  addInternalAssetComment,
} from '@/lib/actions'

// Review, inline in the Creatives tab. Saves the context switch out to
// /internal-review on the routine pass — most reviews are a glance and a verdict,
// and bouncing to another screen for each one was the cost.
//
// /internal-review STAYS. It is the dedicated screen for working through a batch
// at width, and both surfaces read and write the same columns
// (internal_status, client_visible, published_url) and the same revision rows,
// so a verdict given in one is already true in the other.
type Mode = 'internal' | 'client'
type Filter = 'all' | 'pending' | 'approved' | 'needs_revision' | 'commented'

const STATUS_META: Record<string, { label: string; color: string }> = {
  pending:        { label: 'Pending',        color: 'var(--text-muted)' },
  approved:       { label: 'Approved',       color: 'var(--success)' },
  needs_revision: { label: 'Needs changes',  color: '#EF4444' },
  rejected:       { label: 'Rejected',       color: '#EF4444' },
}

// Dot AND word, always paired — the colour should never have to be remembered.
function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return <span style={{ width: size, height: size, borderRadius: '50%', background: color, flexShrink: 0, display: 'inline-block' }} />
}

function StatusChip({ status, size = 'sm' }: { status: string; size?: 'sm' | 'md' }) {
  const m = STATUS_META[status] ?? STATUS_META.pending
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: size === 'sm' ? 10.5 : 12, fontWeight: 700, color: m.color, whiteSpace: 'nowrap',
    }}>
      <Dot color={m.color} size={size === 'sm' ? 7 : 9} />{m.label}
    </span>
  )
}

export default function ReviewWorkspace({
  projectId, brandId, assets, comments, revisionsByAsset, authorName,
}: {
  projectId: string
  brandId: string
  assets: CreativeAsset[]
  comments: ProjectComment[]
  revisionsByAsset: Record<string, AssetRevision[]>
  authorName: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [mode, setMode] = useState<Mode>('internal')
  const [filter, setFilter] = useState<Filter>('all')
  const [selected, setSelected] = useState<string | null>(assets[0]?.id ?? null)
  const [zoom, setZoom] = useState(false)

  const [uploading, setUploading] = useState(false)
  // Which version is being LOOKED AT. Deliberately separate from which one the
  // client sees — previously the only interactive thing on a version row was
  // "publish it", so inspecting Edit 1 meant sending it to the client first.
  const [viewUrl, setViewUrl] = useState<string | null>(null)
  const [viewLabel, setViewLabel] = useState<string | null>(null)
  // Separate from viewUrl: the list shows a small image, the overlay a large one.
  const [viewFull, setViewFull] = useState<string | null>(null)
  // Two columns once the PANEL is wide enough — measured on the panel itself,
  // not the window. The window says little about the room this element got: it
  // sits in a grid, in a page, behind a sidebar that collapses. Keying off the
  // window meant a wider window could cost a thumbnail column.
  const [roomy, setRoomy] = useState(false)
  useEffect(() => {
    const el = detailRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => {
      // 620 is image + controls + gap. Below it, two columns are worse than one.
      setRoomy(entry.contentRect.width >= 620)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Jaspen asked to separate internal notes from client feedback. The mode
  // toggle already does it implicitly, which is why it was not obvious — this
  // says it out loud on the one list where the two are mixed.
  const [feedAudience, setFeedAudience] = useState<'all' | 'client' | 'internal'>('all')

  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const [err, setErr] = useState('')

  // Internal and client approval are separate columns. One set of counts for
  // both is what made the old status read as "unclear/misleading".
  const statusOf = (a: CreativeAsset) => (mode === 'internal' ? a.internal_status : a.status) ?? 'pending'

  const commentsFor = useMemo(() => {
    const m: Record<string, ProjectComment[]> = {}
    for (const c of comments) {
      if (!c.asset_id) continue
      const isInternal = c.audience === 'internal'
      if (mode === 'internal' ? true : !isInternal) (m[c.asset_id] ??= []).push(c)
    }
    return m
  }, [comments, mode])

  // Same audience rule the panel uses, so the feed can never advertise a comment
  // the panel will refuse to show.
  const feedComments = useMemo(() => {
    const base = mode === 'internal' ? comments : comments.filter(c => c.audience !== 'internal')
    if (feedAudience === 'client') return base.filter(c => c.audience !== 'internal')
    if (feedAudience === 'internal') return base.filter(c => c.audience === 'internal')
    return base
  }, [comments, mode, feedAudience])

  const counts = useMemo(() => {
    const c = { pending: 0, approved: 0, needs_revision: 0, rejected: 0, commented: 0, visible: 0 }
    for (const a of assets) {
      const s = statusOf(a)
      if (s in c) (c as Record<string, number>)[s]++
      if ((commentsFor[a.id]?.length ?? 0) > 0) c.commented++
      if (a.client_visible) c.visible++
    }
    return c
  }, [assets, mode, commentsFor]) // eslint-disable-line react-hooks/exhaustive-deps

  const commentTotal = useMemo(
    () => Object.values(commentsFor).reduce((n, v) => n + v.length, 0),
    [commentsFor],
  )

  const shown = useMemo(() => assets.filter(a => {
    if (filter === 'all') return true
    if (filter === 'commented') return (commentsFor[a.id]?.length ?? 0) > 0
    return statusOf(a) === filter
  }), [assets, filter, commentsFor, mode]) // eslint-disable-line react-hooks/exhaustive-deps

  // ← → walk the filtered grid, so a batch can be reviewed without going back to
  // the mouse between every image. Bound to the FILTERED list, not all assets:
  // arrowing out of the filter you deliberately set would be surprising.
  //
  // Ignored while typing, so arrowing inside a comment box or a filename does
  // not jump the selection out from under you.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (zoom) return
      if (shown.length < 2) return
      e.preventDefault()
      step(e.key === 'ArrowRight' ? 1 : -1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Escape closes the overlay, and the page behind it stops scrolling — without
  // the lock a trackpad flick scrolls the review list under the image.
  useEffect(() => {
    if (!zoom) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setZoom(false) }
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [zoom])

  const active = assets.find(a => a.id === selected) ?? null
  // Selecting from the comment feed has to move the viewport too. The feed sits
  // below the grid, the filters and the bulk uploader, so a click that only
  // changed state left the reviewer looking at an unchanged screen and reading
  // the button as broken.
  const detailRef = useRef<HTMLDivElement>(null)
  const pickAsset = (id: string, scroll = false) => {
    setSelected(id); setViewUrl(null); setViewLabel(null); setViewFull(null)
    if (scroll) requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  const activeRevs = active ? (revisionsByAsset[active.id] ?? []) : []
  // thumbnail_url is preferred because it is the only place the &v= cache-buster
  // written by the last sync survives. Rebuilding from drive_file_id throws it
  // away, which is what let a replaced Drive file keep showing its old render.
  const thumb = (a: CreativeAsset) =>
    a.revision_url ?? a.thumbnail_url ?? driveThumb(a.drive_file_id, 600)
  const full = (a: CreativeAsset) =>
    a.revision_url ?? resizeDriveThumb(a.thumbnail_url, 2048) ?? driveThumb(a.drive_file_id, 2048)

  // Position within the FILTERED grid, and the one place that decides what
  // "next" means — the buttons and the arrow keys both call this.
  const shownIndex = shown.findIndex(a => a.id === selected)
  const step = (dir: -1 | 1) => {
    if (shown.length < 2) return
    const next = shown[(shownIndex + dir + shown.length) % shown.length]
    if (next) pickAsset(next.id)
  }

  async function post() {
    const content = draft.trim()
    if (!content || !active) return
    setPosting(true); setErr('')
    try {
      await addInternalAssetComment({
        projectId, brandId, assetId: active.id, content, displayName: authorName,
      })
      setDraft('')
      router.refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not add the note.')
    } finally { setPosting(false) }
  }

  const run = (fn: () => Promise<unknown>) => {
    setErr('')
    startTransition(async () => {
      try { await fn(); router.refresh() }
      catch (e) { setErr(e instanceof Error ? e.message : 'Action failed') }
    })
  }

  const approvedNotPushed = assets.filter(a => a.internal_status === 'approved' && !a.client_visible)
  const clientApproved = assets.filter(a => a.status === 'approved')

  const btn = (bg: string, fg = '#fff'): React.CSSProperties => ({
    fontSize: 12, fontWeight: 600, padding: '8px 12px', borderRadius: 6,
    border: bg === 'transparent' ? '1px solid var(--border)' : 'none',
    background: bg, color: fg, cursor: pending ? 'wait' : 'pointer', opacity: pending ? 0.6 : 1,
  })

  return (
    <div>
      {/* Mode + bulk push */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          {(['internal', 'client'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              padding: '8px 16px', fontSize: 12, fontWeight: mode === m ? 700 : 500, border: 'none', cursor: 'pointer',
              background: mode === m ? 'var(--accent)' : 'transparent', color: mode === m ? '#fff' : 'var(--text-muted)',
            }}>{m === 'internal' ? 'Internal review' : 'Client review'}</button>
          ))}
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {counts.visible} of {assets.length} ads visible to the client
        </span>
        {clientApproved.length > 0 && (
          <a
            href={`/api/projects/${projectId}/download?set=approved`}
            title="Zip of every client-approved creative"
            style={{ ...btn('transparent', 'var(--text-secondary)'), textDecoration: 'none', display: 'inline-block' }}
          >
            ⬇ Download {clientApproved.length} approved
          </a>
        )}
        {mode === 'internal' && approvedNotPushed.length > 0 && (
          <button
            onClick={() => run(() => publishAssets(projectId, brandId, approvedNotPushed.map(a => a.id)))}
            disabled={pending}
            style={{ ...btn('var(--accent)'), marginLeft: 'auto' }}
          >
            Send {approvedNotPushed.length} approved to client
          </button>
        )}
      </div>

      {err && <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 10, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: 'var(--danger)', fontSize: 12 }}>{err}</div>}

      {/* One row, not two. The counters and the filter chips were separate
          controls showing the same five numbers in two visual languages — and
          the counters looked clickable without being clickable. Merging them
          removes a row, removes the duplication, and makes the tiles do the
          thing they already looked like they did.

          Rejected is omitted unless something is actually rejected: nothing in
          this workspace can set that status, so an always-zero tile was pure
          furniture. */}
      <div role="group" aria-label="Filter creatives" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(116px,1fr))', gap: 8, marginBottom: 16 }}>
        {([
          ['all',            'All',           assets.length,        'ads',                     'var(--text-primary)'],
          ['pending',        'Pending',       counts.pending,       'ads',                     'var(--text-secondary)'],
          ['approved',       'Approved',      counts.approved,      'ads',                     'var(--success)'],
          ['needs_revision', 'Needs changes', counts.needs_revision, 'ads',                    'var(--danger)'],
          ...(counts.rejected > 0 ? [['rejected', 'Rejected', counts.rejected, 'ads', 'var(--danger)'] as const] : []),
          ['commented',      'Comments',      commentTotal,         `on ${counts.commented} ads`, 'var(--accent)'],
        ] as const).map(([k, label, n, unit, col]) => {
          const on = filter === k
          return (
            <button
              key={k}
              onClick={() => setFilter(k as Filter)}
              aria-pressed={on}
              style={{
                textAlign: 'left', cursor: 'pointer', padding: '8px 12px', borderRadius: 10,
                border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                background: on ? 'var(--accent-muted)' : 'var(--surface-1)',
                transition: 'border-color 0.12s, background 0.12s',
              }}
            >
              <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1, color: on ? 'var(--accent)' : col }}>{n}</div>
              <div style={{ fontSize: 11, marginTop: 4, color: on ? 'var(--accent)' : 'var(--text-secondary)', fontWeight: on ? 600 : 400 }}>{label}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{unit}</div>
            </button>
          )
        })}
      </div>

      {/* Batch revisions. Internal only — a client reviewer has nothing to upload. */}
      {mode === 'internal' && (
        <BulkRevisionUpload
          projectId={projectId}
          brandId={brandId}
          assets={assets.map(a => ({ id: a.id, name: a.name }))}
        />
      )}

      {/* Both columns grow with the window. The panel's minimum went 320 -> 340;
          its SHARE was left alone deliberately — giving it more reached the
          two-column threshold only at 1920 and cost the thumbnail grid a column
          at 1280 and 1600 to get there. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.3fr) minmax(340px,1fr)', gap: 16 }}>
        {/* Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(128px,1fr))', gap: 8, alignContent: 'start' }}>
          {shown.map(a => {
            const n = commentsFor[a.id]?.length ?? 0
            const on = a.id === selected
            return (
              <button key={a.id} onClick={() => pickAsset(a.id)} style={{
                padding: 0, border: `2px solid ${on ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 10,
                overflow: 'hidden', cursor: 'pointer', background: 'var(--surface-1)', textAlign: 'left', position: 'relative',
              }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumb(a)} alt="" loading="lazy" style={{ width: '100%', aspectRatio: '4/5', objectFit: 'cover', display: 'block' }} />
                {/* Quiet, and only in the mode where it means anything. This was a
                    solid black caps box across the artwork — but roughly half a
                    project's creatives are unpublished at any time, so shouting it
                    on every second tile inverted the emphasis and buried the ad.
                    In Client review mode nothing hidden is on screen at all, so
                    the badge would be noise there by definition. */}
                {mode === 'internal' && !a.client_visible && (
                  <span
                    title="Not on the client review link yet"
                    style={{
                      position: 'absolute', top: 8, left: 8, display: 'inline-flex', alignItems: 'center', gap: 4,
                      fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 999,
                      background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)', color: 'rgba(255,255,255,0.72)',
                    }}
                  >
                    <Dot color="rgba(255,255,255,0.55)" size={5} />Hidden
                  </span>
                )}
                <div style={{ padding: '8px 8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <StatusChip status={statusOf(a)} />
                    {n > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)' }}>💬 {n}</span>}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {(a.name ?? 'untitled').replace(/\.(png|jpg|jpeg)$/i, '')}
                  </div>
                </div>
              </button>
            )
          })}
          {shown.length === 0 && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Nothing matches this filter.</p>}
        </div>

        {/* Detail */}
        {/* Sticky AND scrollable. Sticky alone pins the panel to the viewport
            and then simply clips everything below it — on a creative with more
            than a few comments the end of the thread could not be reached at
            all, at any zoom level. Reported by Janella, 1 Sep. */}
        <div
          ref={detailRef}
          style={{
            position: 'sticky', top: 16, alignSelf: 'start', scrollMarginTop: 16,
            maxHeight: 'calc(100vh - 32px)', overflowY: 'auto',
            // Room for the scrollbar so it never sits on top of the content.
            paddingRight: 4,
          }}
        >
          {active ? (
            <div style={{
              border: '1px solid var(--border)', borderRadius: 10, padding: 16, background: 'var(--surface-1)',
              // As ONE column the stack — image, verdict, note, versions,
              // visibility, comments — ran past the fold on every screen, which
              // is what made the panel feel cramped however tall the window was.
              ...(roomy ? { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(300px,360px)', gap: 18, alignItems: 'start' } : null),
            }}>
              <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                <StatusChip status={statusOf(active)} size="md" />
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
                  {mode === 'internal' ? 'internal' : 'client'} status
                </span>
              </div>

              {shown.length > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <button onClick={() => step(-1)} title="Previous (←)" aria-label="Previous creative" style={navBtn}>‹</button>
                  <button onClick={() => step(1)} title="Next (→)" aria-label="Next creative" style={navBtn}>›</button>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {shownIndex + 1} of {shown.length}
                    {filter !== 'all' && <span> in this filter</span>}
                  </span>
                  {/* The keys work whether or not anyone reads this; saying so is
                      what turns them from a secret into a shortcut. */}
                  <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--text-muted)' }}>← → also work</span>
                </div>
              )}

              {/* Click to expand — inline for flow, full size for scrutiny */}
              {viewLabel && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 8px', marginBottom: 8, borderRadius: 6, background: 'rgba(234,179,8,0.10)', border: '1px solid rgba(234,179,8,0.28)' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--warning)' }}>Viewing {viewLabel}</span>
                  <button onClick={() => { setViewUrl(null); setViewLabel(null); setViewFull(null) }} style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer' }}>
                    Back to latest
                  </button>
                </div>
              )}
              <button onClick={() => setZoom(true)} title="Click to view full size" style={{ display: 'block', width: '100%', padding: 0, border: 'none', background: 'none', cursor: 'zoom-in', marginBottom: 8 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={viewUrl ?? thumb(active)} alt="" style={{ width: '100%', borderRadius: 10, display: 'block' }} />
              </button>

              </div>

              <div style={{ minWidth: 0 }}>
              {/* The three actions */}
              {mode === 'internal' && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                  {/* A verdict is a toggle. Clicking the one already set puts the
                      ad back to pending — a mis-click used to be unrecoverable
                      from this screen. */}
                  {(['approved', 'needs_revision'] as const).map(v => {
                    const on = (active.internal_status ?? 'pending') === v
                    const colour = v === 'approved' ? 'var(--success)' : '#EF4444'
                    return (
                      <button
                        key={v}
                        disabled={pending}
                        title={on ? 'Click again to clear this verdict' : undefined}
                        onClick={() => run(() => updateAssetStatusInternal(active.id, projectId, brandId, on ? 'pending' : v))}
                        style={{ ...btn(colour), ...(on ? { background: colour, color: '#fff', borderColor: colour } : null) }}
                      >
                        {v === 'approved' ? (on ? '✓ Approved internally' : 'Approve internally') : (on ? '✓ Needs revision' : 'Needs revision')}
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Where a fixed file goes — straight onto this asset, not a Drive subfolder */}
              <label style={{ textTransform: 'none', letterSpacing: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', marginBottom: 8,
                border: '1px dashed var(--border-strong)', borderRadius: 10,
                cursor: uploading || pending ? 'wait' : 'pointer',
              }}>
                <input
                  type="file"
                  accept="image/*"
                  disabled={uploading || pending}
                  style={{ display: 'none' }}
                  onChange={async e => {
                    const f = e.target.files?.[0]
                    if (!f) return
                    setUploading(true); setErr('')
                    try {
                      const r = await uploadRevisionFile(f, active.id, projectId, brandId)
                      if (!r.ok) setErr(r.error); else router.refresh()
                    } catch (ex) { setErr(ex instanceof Error ? ex.message : 'Upload failed') }
                    finally { setUploading(false); e.target.value = '' }
                  }}
                />
                <span style={{ fontSize: 15 }}>⬆</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{uploading ? 'Uploading…' : 'Upload revised version'}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    Becomes Edit {activeRevs.length + 1}. The client keeps seeing the published version until you send it.
                  </div>
                </div>
              </label>

              {/* Visible-to-client switch */}
              <label style={{ textTransform: 'none', letterSpacing: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 12, cursor: pending ? 'wait' : 'pointer' }}>
                <input
                  type="checkbox"
                  checked={!!active.client_visible}
                  disabled={pending}
                  onChange={e => run(() => setAssetClientVisible(active.id, e.target.checked, projectId, brandId))}
                  style={{ width: 'auto', margin: 0 }}
                />
                <span style={{ fontSize: 12, fontWeight: 600 }}>Visible to client</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: active.client_visible ? 'var(--success)' : 'var(--text-muted)' }}>
                  {active.client_visible ? 'on the review link' : 'hidden'}
                </span>
              </label>

              {/* Write a note on THIS creative. Asked for on the editors' call —
                  until now the preview could show comments but not take one, so
                  an editor reviewing here had to go elsewhere to say anything.
                  Internal audience: this is the editors' own channel, and a note
                  typed here must never surprise anyone by reaching the client. */}
              <div style={{ marginBottom: 12 }}>
                <textarea
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  rows={2}
                  placeholder="Internal note…"
                  onKeyDown={e => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void post() }
                  }}
                  style={{ width: '100%', fontSize: 12.5, lineHeight: 1.5, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-primary)', resize: 'vertical' }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
                  <button
                    onClick={() => void post()}
                    disabled={posting || !draft.trim()}
                    style={{
                      fontSize: 11.5, fontWeight: 700, padding: '6px 12px', borderRadius: 7, cursor: posting || !draft.trim() ? 'not-allowed' : 'pointer',
                      border: `1px solid ${draft.trim() ? 'var(--accent)' : 'var(--border)'}`,
                      background: draft.trim() ? 'var(--accent-muted)' : 'transparent',
                      color: draft.trim() ? 'var(--accent)' : 'var(--text-muted)',
                    }}
                  >{posting ? 'Adding…' : 'Add note'}</button>
                  <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>Internal only · ⌘↵</span>
                </div>
              </div>

              {/* Versions — the stack IS the control. Exactly one row is what the
                  client sees, so "which version are they looking at" is answered
                  by looking, not by remembering which button was pressed last. */}
              {(() => {
                // `thumb` feeds the 26px list image, `fullUrl` feeds the zoom
                // overlay. They differ for the Original: Drive is asked for w600
                // for the list and w2048 for the expand, so clicking a version
                // and then expanding no longer hands the reviewer a thumbnail
                // to scrutinise. Revisions are already stored full-size.
                const originalUrl = active.thumbnail_url ?? driveThumb(active.drive_file_id, 600)
                const rows = [
                  { key: 'original', label: 'Original', url: null as string | null, thumb: originalUrl, fullUrl: full(active), at: null as string | null },
                  ...activeRevs.map(r => ({ key: r.id, label: `Edit ${r.revision_number}`, url: r.image_url, thumb: r.image_url, fullUrl: r.image_url, at: r.created_at })),
                ]
                // client_visible is the "is the client seeing this at all" flag —
                // it is exactly what the client review link filters on.
                // published_url only records WHICH version was sent, and
                // publishAssets leaves it null for an unedited ad, so
                // visible + null means the client is looking at the Original.
                //
                // Reading null as "nothing sent yet" made the stack contradict
                // the Visible-to-client switch directly above it, and suppressed
                // the stale warning in the one case it matters most: an ad
                // published as the Original that has since been revised.
                const publishedUrl = active.published_url
                const clientSees = !!active.client_visible
                const isLive = (url: string | null) =>
                  clientSees && (publishedUrl ? url === publishedUrl : url === null)
                const anyLive = rows.some(r => isLive(r.url))
                const latest = rows[rows.length - 1]
                const stale = anyLive && !isLive(latest.url)

                return (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Versions</span>
                      {stale && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--warning)' }}>
                          client is on an older version
                        </span>
                      )}
                      {!anyLive && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)' }}>
                          {clientSees ? 'visible, version unknown' : 'nothing sent yet'}
                        </span>
                      )}
                    </div>

                    <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                      {rows.map((r, i) => {
                        const live = isLive(r.url)
                        return (
                          <div key={r.key} style={{
                            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 8px',
                            borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                            background: live ? 'color-mix(in srgb, var(--success) 9%, transparent)' : 'transparent',
                            outline: viewLabel === r.label ? '2px solid var(--accent)' : 'none', outlineOffset: -2,
                          }}>
                            {/* Clicking the row VIEWS this version. Publishing is the button. */}
                            <button
                              onClick={() => { setViewUrl(r.thumb); setViewFull(r.fullUrl); setViewLabel(r.label) }}
                              title={`View ${r.label}`}
                              style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, padding: 0, border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left' }}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={r.thumb} alt="" loading="lazy" style={{ width: 26, height: 33, objectFit: 'cover', borderRadius: 6, flexShrink: 0, border: '1px solid var(--border)' }} />
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div style={{ fontSize: 12, fontWeight: live ? 700 : 500 }}>
                                  {r.label}{i === rows.length - 1 && rows.length > 1 ? ' · latest' : ''}
                                </div>
                                {r.at && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{new Date(r.at).toLocaleDateString()}</div>}
                              </div>
                            </button>
                            {live ? (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: 'var(--success)', whiteSpace: 'nowrap' }}>
                                <Dot color="var(--success)" />CLIENT SEES THIS
                              </span>
                            ) : (
                              <button
                                disabled={pending}
                                onClick={() => run(() => setClientVersion(active.id, r.url, projectId, brandId))}
                                style={{ ...btn('transparent', 'var(--accent)'), fontSize: 11, padding: '4px 8px', borderColor: 'var(--accent)', whiteSpace: 'nowrap' }}
                              >
                                Show client this
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}

              {(() => {
                const all = commentsFor[active.id] ?? []
                const client = all.filter(c => c.audience !== 'internal')
                const internal = all.filter(c => c.audience === 'internal')
                if (all.length === 0) return <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No comments on this creative.</p>

                // Two labelled groups, never one mixed list. Which audience a note
                // came from changes what you do about it, so it should never take
                // a second read to work out.
                const group = (title: string, list: typeof all, accent: string) => list.length === 0 ? null : (
                  <div key={title} style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <Dot color={accent} />
                      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: accent }}>{title}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        {list.filter(c => !c.resolved_at).length} open of {list.length}
                      </span>
                      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                    </div>
                    {list.map(c => {
                      const done = !!c.resolved_at
                      return (
                        <div key={c.id} style={{
                          padding: '8px 12px', borderRadius: 10, marginBottom: 8,
                          border: `1px solid ${done ? 'var(--border)' : `color-mix(in srgb, ${accent} 30%, var(--border))`}`,
                          background: done ? 'transparent' : `color-mix(in srgb, ${accent} 5%, var(--surface-1))`,
                          opacity: done ? 0.6 : 1,
                        }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                            {/* Tick it off once addressed — this is also what marks the ad "Revised". */}
                            <input
                              type="checkbox"
                              checked={done}
                              disabled={pending}
                              title={done ? 'Mark as not addressed' : 'Mark as addressed'}
                              onChange={e => run(() => toggleCommentResolved(c.id, projectId, brandId, e.target.checked))}
                              style={{ width: 'auto', margin: '2px 0 0', flexShrink: 0, cursor: pending ? 'wait' : 'pointer' }}
                            />
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                                <strong style={{ fontSize: 11 }}>{c.author_name}</strong>
                                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{new Date(c.created_at).toLocaleDateString()}</span>
                                {done && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--success)' }}>✓ ADDRESSED</span>}
                              </div>
                              <div style={{ fontSize: 12, lineHeight: 1.5, textDecoration: done ? 'line-through' : 'none' }}>{c.content}</div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
                return <>{group('Client feedback', client, '#60a5fa')}{mode === 'internal' && group('Internal notes', internal, 'var(--text-secondary)')}</>
              })()}
              </div>
            </div>
          ) : <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No creatives synced yet.</p>}
        </div>
      </div>

      {/* Comment activity → jump to the creative */}
      {feedComments.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700 }}>Comment activity</span>
            {mode === 'internal' && (
              <div style={{ display: 'flex', gap: 4 }}>
                {([['all', 'All'], ['client', 'Client'], ['internal', 'Internal']] as const).map(([k, label]) => {
                  const on = feedAudience === k
                  const n = k === 'all' ? comments.length
                    : k === 'client' ? comments.filter(c => c.audience !== 'internal').length
                    : comments.filter(c => c.audience === 'internal').length
                  return (
                    <button
                      key={k}
                      onClick={() => setFeedAudience(k)}
                      aria-pressed={on}
                      style={{
                        fontSize: 11, fontWeight: on ? 700 : 500, padding: '3px 10px', borderRadius: 999, cursor: 'pointer',
                        border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                        background: on ? 'var(--accent-muted)' : 'transparent',
                        color: on ? 'var(--accent)' : 'var(--text-muted)',
                      }}
                    >{label} {n}</button>
                  )
                })}
              </div>
            )}
          </div>
          {feedComments.slice(0, 15).map(c => {
            const a = assets.find(x => x.id === c.asset_id)
            // Ticking a comment off in the panel dims and strikes it here, so the
            // feed stops reading as a to-do list of things already handled.
            // Jaspen, 1 Sep. Driven off resolved_at, so the two surfaces cannot
            // disagree — there is no second piece of state to keep in sync.
            const done = !!c.resolved_at
            return (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 8, opacity: done ? 0.5 : 1, background: done ? 'var(--surface-2)' : 'transparent' }}>
                {a && /* eslint-disable-next-line @next/next/no-img-element */ (
                  <img src={thumb(a)} alt="" loading="lazy" style={{ width: 34, height: 42, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  {/* The filename, first. A thumbnail at 34px does not tell two
                      variants of the same ad apart, and the filename is what an
                      editor searches for in Drive. */}
                  {a?.name && (
                    <div style={{ fontSize: 11, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.name}>
                      {a.name}
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    {c.author_name} · {new Date(c.created_at).toLocaleDateString()}
                    {done && <span style={{ color: 'var(--success)', fontWeight: 700 }}> · done</span>}
                  </div>
                  <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: done ? 'line-through' : 'none' }}>{c.content}</div>
                </div>
                {a && <button onClick={() => pickAsset(a.id, true)} style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 6, border: '1px solid var(--accent)', background: 'var(--accent-muted)', color: 'var(--accent)', cursor: 'pointer' }}>Open creative →</button>}
              </div>
            )
          })}
        </div>
      )}

      {/* Full-size viewer. Escape and a visible ✕ as well as the backdrop —
          clicking the dark edge is not discoverable, and this is the one view
          a reviewer is asked to study rather than skim. */}
      {zoom && active && (
        <div onClick={() => setZoom(false)} style={{ position: 'fixed', inset: 0, zIndex: 900, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 28, cursor: 'zoom-out' }}>
          <button
            onClick={e => { e.stopPropagation(); setZoom(false) }}
            aria-label="Close full-size view"
            style={{ position: 'fixed', top: 18, right: 22, width: 34, height: 34, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.35)', background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 17, lineHeight: 1, cursor: 'pointer' }}
          >✕</button>
          {viewLabel && (
            <div style={{ position: 'fixed', top: 22, left: 24, fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.85)' }}>{viewLabel}</div>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={viewFull ?? full(active)} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 10 }} />
        </div>
      )}
    </div>
  )
}

const navBtn: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 7, fontSize: 15, lineHeight: 1, cursor: 'pointer',
  border: '1px solid var(--border-strong)', background: 'var(--surface-2)', color: 'var(--text-secondary)',
}
