'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { CreativeAsset, ProjectComment } from '@/lib/types'
import type { AssetRevision } from '@/lib/revisions'
import { driveThumb, resizeDriveThumb } from '@/lib/drive-thumb'
import { uploadRevisionFile } from '@/lib/upload-revision'
import { commentStamp } from '@/lib/stamp'
import { useConfirm } from '@/components/ConfirmDialog'
import BulkRevisionUpload from './BulkRevisionUpload'
import EditableNoteBody from './EditableNoteBody'
import {
  updateAssetStatusInternal,
  editInternalComment,
  setAssetClientVisible,
  publishAssets,
  toggleCommentResolved,
  setClientVersion,
  addInternalAssetComment,
} from '@/lib/actions'

// Review, inline in the Creatives tab. Two layouts over one set of controls:
//
//   Tile View     — the grid plus a detail panel. Good for triage: see forty
//                   ads at once, spot the one with three comments on it.
//   Gallery View  — a fixed, full-viewport overlay: one big image, a filmstrip,
//                   and the same rail on the right. Good for actually judging
//                   the work, which is impossible at 128px.
//
// The rail is written ONCE, as render functions called by both layouts. Two
// copies of the publish control is how two surfaces start disagreeing about
// what the client is looking at.
//
// /internal-review STAYS. It is the only screen with pin annotations, and it
// reads and writes the same columns (internal_status, client_visible,
// published_url) and the same revision rows — so a verdict given in one is
// already true in the other. The Gallery rail links to it.
type Mode = 'internal' | 'client'
type View = 'tile' | 'gallery'
type Filter = 'all' | 'pending' | 'approved' | 'needs_revision' | 'revised' | 'rejected' | 'commented'
// A SECOND, independent axis. `Filter` is what a human decided about the ad;
// this is a fact about the file — has anyone re-uploaded it? Composed with AND.
type UploadFilter = 'all' | 'new' | 'revised'

const REVISED_BLUE = '#60a5fa'

const STATUS_META: Record<string, { label: string; color: string }> = {
  pending:        { label: 'Pending',        color: 'var(--text-muted)' },
  approved:       { label: 'Approved',       color: 'var(--success)' },
  needs_revision: { label: 'Needs changes',  color: '#EF4444' },
  revised:        { label: 'Revised',        color: REVISED_BLUE },
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

function Pill({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color, whiteSpace: 'nowrap' }}>
      <Dot color={color} size={9} />{label}
    </span>
  )
}

// Hand-rolled inline SVG in the house style (see Sidebar.tsx / ThemeToggle.tsx).
// lucide-react is a dependency but has exactly one importer in the whole tree.
const ico = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

function GridIcon({ s = 14 }: { s?: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" {...ico} aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  )
}
function PaneIcon({ s = 14 }: { s?: number }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" {...ico} aria-hidden><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 17h18" /></svg>
}
function CheckIcon({ s = 13 }: { s?: number }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" {...ico} aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
}
function XIcon({ s = 13 }: { s?: number }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" {...ico} aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
}

export default function ReviewWorkspace({
  projectId, brandId, assets, comments, revisionsByAsset, authorName, currentUserId = null,
}: {
  projectId: string
  brandId: string
  assets: CreativeAsset[]
  comments: ProjectComment[]
  revisionsByAsset: Record<string, AssetRevision[]>
  authorName: string
  /** Proves ownership for editing an internal note in place. */
  currentUserId?: string | null
}) {
  const router = useRouter()
  const confirm = useConfirm()
  const [pending, startTransition] = useTransition()
  const [mode, setMode] = useState<Mode>('internal')
  const [view, setView] = useState<View>('tile')
  const [wide, setWide] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')
  const [uploadFilter, setUploadFilter] = useState<UploadFilter>('all')
  const [selected, setSelected] = useState<string | null>(assets[0]?.id ?? null)
  const [zoom, setZoom] = useState(false)

  const [uploading, setUploading] = useState(false)
  // Which version is being LOOKED AT. Deliberately separate from which one the
  // client sees — previously the only interactive thing on a version row was
  // "publish it", so inspecting Edit 1 meant sending it to the client first.
  //
  // Carries the asset id it belongs to. As three loose pieces of state it
  // outlived the asset it described: land on another creative and the panel
  // still said "Viewing Edit 1" and showed that other ad's revision. Keyed, it
  // simply stops applying.
  //
  // `url` feeds the small list image, `full` the zoom overlay — Drive is asked
  // for w600 for one and w2048 for the other, so expanding a version hands the
  // reviewer something worth scrutinising rather than a blown-up thumbnail.
  const [viewOverride, setViewOverride] = useState<{ assetId: string; url: string; full: string; label: string } | null>(null)
  // Two columns once the PANEL is wide enough — measured on the panel itself,
  // not the window. The window says little about the room this element got: it
  // sits in a grid, in a page, behind a sidebar that collapses. Keying off the
  // window meant a wider window could cost a thumbnail column.
  const [roomy, setRoomy] = useState(false)

  // Jaspen asked to separate internal notes from client feedback. The mode
  // toggle already does it implicitly, which is why it was not obvious — this
  // says it out loud on the one list where the two are mixed.
  const [feedAudience, setFeedAudience] = useState<'all' | 'client' | 'internal'>('all')
  // Was a hard slice(0, 15) with nothing to click. On a project with a talkative
  // client the feed silently stopped a third of the way down. Reported by Jaspen.
  const [feedLimit, setFeedLimit] = useState(30)

  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const [err, setErr] = useState('')

  const detailRef = useRef<HTMLDivElement>(null)
  // One entry per filmstrip thumb, so the strip can scroll the selection into
  // view however the selection changed — arrows, chevrons, or a click.
  const stripRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  // Internal and client approval are separate columns. One set of counts for
  // both is what made the old status read as "unclear/misleading".
  const statusOf = (a: CreativeAsset) => (mode === 'internal' ? a.internal_status : a.status) ?? 'pending'

  // "Has this file been re-uploaded?" Revision ROWS are the good signal, but
  // assets edited before the history table existed — and any insert that got
  // swallowed — carry revision_url with zero rows. So both, OR'd. Same fallback
  // InternalReviewPanel already ships.
  //
  // Declared HERE, above the memos, on purpose: useMemo runs its callback
  // during the render pass, so a const arrow declared further down would be in
  // the temporal dead zone and throw.
  const hasRevision = (a: CreativeAsset) =>
    (revisionsByAsset[a.id]?.length ?? 0) > 0 || a.revision_url != null

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

  // Status counts are computed over the UPLOAD-filtered set, because the two
  // axes are ANDed. Counting all assets made an "Approved 12" tile open a grid
  // of 3 whenever an Uploads pill was on.
  //
  // The Uploads counts themselves stay over all assets — they are the other
  // axis, and narrowing them by the status filter would make each pill report
  // a number that changes as you click the tiles above it.
  const statusPool = useMemo(
    () => assets.filter(a => {
      if (uploadFilter === 'new') return !hasRevision(a)
      if (uploadFilter === 'revised') return hasRevision(a)
      return true
    }),
    [assets, uploadFilter, revisionsByAsset], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const counts = useMemo(() => {
    const c = {
      pending: 0, approved: 0, needs_revision: 0, revised: 0, rejected: 0,
      commented: 0, visible: 0, newUploads: 0, revisedUploads: 0,
    }
    for (const a of statusPool) {
      const s = statusOf(a)
      if (s in c) (c as Record<string, number>)[s]++
      if ((commentsFor[a.id]?.length ?? 0) > 0) c.commented++
      if (a.client_visible) c.visible++
    }
    for (const a of assets) { if (hasRevision(a)) c.revisedUploads++; else c.newUploads++ }
    return c
  }, [assets, statusPool, mode, commentsFor, revisionsByAsset]) // eslint-disable-line react-hooks/exhaustive-deps

  const commentTotal = useMemo(
    () => statusPool.reduce((n, a) => n + (commentsFor[a.id]?.length ?? 0), 0),
    [statusPool, commentsFor],
  )

  const shown = useMemo(() => assets.filter(a => {
    if (uploadFilter === 'new' && hasRevision(a)) return false
    if (uploadFilter === 'revised' && !hasRevision(a)) return false
    if (filter === 'all') return true
    if (filter === 'commented') return (commentsFor[a.id]?.length ?? 0) > 0
    return statusOf(a) === filter
  }), [assets, filter, uploadFilter, commentsFor, mode, revisionsByAsset]) // eslint-disable-line react-hooks/exhaustive-deps

  // DERIVED, not synced. `selected` is what was last clicked; if a filter has
  // since removed it, fall through to the first thing actually on screen.
  // Reconciling this in an effect meant a render where the detail panel showed
  // an asset absent from the grid, beside a counter reading "0 of 12".
  const activeId = shown.some(a => a.id === selected) ? selected : (shown[0]?.id ?? null)
  const active = assets.find(a => a.id === activeId) ?? null
  const override = viewOverride && viewOverride.assetId === activeId ? viewOverride : null
  // Selecting from the comment feed has to move the viewport too. The feed sits
  // below the grid, the filters and the bulk uploader, so a click that only
  // changed state left the reviewer looking at an unchanged screen and reading
  // the button as broken.
  const pickAsset = (id: string, scroll = false) => {
    setSelected(id)
    if (scroll) requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  // thumbnail_url is preferred because it is the only place the &v= cache-buster
  // written by the last sync survives. Rebuilding from drive_file_id throws it
  // away, which is what let a replaced Drive file keep showing its old render.
  const thumb = (a: CreativeAsset) =>
    a.revision_url ?? a.thumbnail_url ?? driveThumb(a.drive_file_id, 600)
  const full = (a: CreativeAsset) =>
    a.revision_url ?? resizeDriveThumb(a.thumbnail_url, 2048) ?? driveThumb(a.drive_file_id, 2048)

  // Position within the FILTERED grid, and the one place that decides what
  // "next" means — the buttons and the arrow keys both call this.
  const shownIndex = shown.findIndex(a => a.id === activeId)
  const step = (dir: -1 | 1) => {
    if (shown.length < 2) return
    const next = shown[(shownIndex + dir + shown.length) % shown.length]
    if (next) pickAsset(next.id)
  }

  useEffect(() => {
    const el = detailRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => {
      // 620 is image + controls + gap. Below it, two columns are worse than one.
      setRoomy(entry.contentRect.width >= 620)
    })
    ro.observe(el)
    return () => ro.disconnect()
    // [view], not []: Gallery unmounts detailRef entirely. Without the dep,
    // opening in Gallery and switching back to Tile leaves the panel stuck at
    // one column forever, because the observer never re-attached.
  }, [view])

  // ← → walk the filtered grid, so a batch can be reviewed without going back to
  // the mouse between every image. Bound to the FILTERED list, not all assets:
  // arrowing out of the filter you deliberately set would be surprising.
  //
  // Ignored while typing, so arrowing inside a comment box or a filename does
  // not jump the selection out from under you.
  //
  // No dep array by design — it re-binds every render so it always closes over
  // the current `shown` and `selected`. Do not memoise it.
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

  // ONE scroll lock for BOTH overlays. Two effects each saving and restoring
  // document.body.style.overflow do not compose: React flushes every passive
  // cleanup before every passive create, so opening zoom tore down the gallery
  // effect and re-ran it while the zoom lock was still applied — the gallery
  // saved 'hidden' as the value to restore, and leaving gallery wrote that
  // back. The page stayed unscrollable until a reload.
  //
  // Without any lock a trackpad flick scrolls the review list under the image.
  const locked = view === 'gallery' || zoom
  useEffect(() => {
    if (!locked) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [locked])

  // Escape unwinds one layer at a time: zoom first, then gallery.
  //
  // It also has to keep its hands off Escape that belongs to something else.
  // ConfirmDialog listens on window too and does not stop propagation, so
  // cancelling the Reject dialog with Escape used to ALSO throw the reviewer
  // out of Gallery — two things undone by one keystroke.
  useEffect(() => {
    if (view !== 'gallery' && !zoom) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // A confirm dialog owns Escape while it is open.
      if (document.querySelector('[role="alertdialog"]')) return
      const el = document.activeElement as HTMLElement | null
      // So does a field being typed in — Escape there means "drop this draft".
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (zoom) { setZoom(false); return }
      setView('tile')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, zoom])

  // The filmstrip follows the selection, wherever the selection came from.
  // inline:'center' keeps it centred horizontally; block:'nearest' stops it
  // nudging any ancestor vertically.
  useEffect(() => {
    if (view !== 'gallery' || !activeId) return
    stripRefs.current[activeId]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [activeId, view, shown.length])

  // Below 900px a 380px rail plus a stage is unusable. Gallery is a desktop
  // view: narrow windows get tiles, and the toggle disappears rather than
  // offering a layout that cannot work.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(min-width: 900px)')
    const apply = () => { setWide(mq.matches); if (!mq.matches) setView('tile') }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  // Which layout an editor prefers is a working habit, not shareable state —
  // putting it in the URL would leak "how Janella likes to work" into every
  // project link pasted into Slack. Restored in an effect, never in a lazy
  // useState initialiser: reading storage during the first render of a client
  // component inside a server-rendered page is a hydration mismatch.
  useEffect(() => {
    try {
      const v = window.localStorage.getItem('pcrm.review.view')
      // localStorage does not exist on the server, so this cannot be read
      // during render without a hydration mismatch. One extra render on mount
      // is the price of restoring the preference at all.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (v === 'gallery' && window.matchMedia('(min-width: 900px)').matches) setView('gallery')
    } catch { /* private mode, blocked storage */ }
  }, [])
  // Persist the CHOICE, never the state. Narrowing the window forces Tile, and
  // writing that would erase a saved Gallery preference the moment someone
  // docked their browser side-by-side — permanently, since the restore only
  // runs on mount.
  const chooseView = (v: View) => {
    setView(v)
    try { window.localStorage.setItem('pcrm.review.view', v) } catch { /* ignore */ }
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

  // ─────────────────────────────────────────────────────────────────────────
  // The rail. Render FUNCTIONS, not components: they close over active, mode,
  // pending, run, btn, draft… so neither layout has to prop-drill fifteen
  // things, and there is exactly one copy of every control.
  // ─────────────────────────────────────────────────────────────────────────

  const renderVerdicts = (a: CreativeAsset) => mode !== 'internal' ? null : (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(104px,1fr))', gap: 8, marginBottom: 10 }}>
      {/* A verdict is a toggle. Clicking the one already set puts the ad back to
          pending — a mis-click used to be unrecoverable from this screen. */}
      {(['approved', 'needs_revision', 'revised', 'rejected'] as const).map(v => {
        const on = (a.internal_status ?? 'pending') === v
        const colour = v === 'approved' ? 'var(--success)'
          : v === 'revised' ? REVISED_BLUE
          : '#EF4444'
        const label = v === 'approved' ? 'Approve'
          : v === 'needs_revision' ? 'Needs Changes'
          : v === 'revised' ? 'Revised'
          : 'Reject'
        return (
          <button
            key={v}
            disabled={pending}
            title={on ? 'Click again to clear this verdict' : undefined}
            onClick={async () => {
              // Reject archives the Drive file and sets is_hidden, and the
              // parent passes !is_hidden assets only — so the ad LEAVES this
              // workspace the moment you confirm. Not a one-click action.
              if (v === 'rejected' && !on) {
                const ok = await confirm({
                  title: 'Reject this creative?',
                  message: 'It is archived to the Drive Delete/ folder, hidden from this workspace, and taken off the client link. Undo it from the internal review screen.',
                  confirmLabel: 'Reject',
                  danger: true,
                })
                if (!ok) return
              }
              run(() => updateAssetStatusInternal(a.id, projectId, brandId, on ? 'pending' : v))
            }}
            style={{
              ...btn(on ? colour : 'transparent', on ? '#fff' : colour),
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              border: `1px solid ${colour}`, whiteSpace: 'nowrap',
            }}
          >
            {v === 'approved' && <CheckIcon />}
            {v === 'rejected' && <XIcon />}
            {on ? `✓ ${label}` : label}
          </button>
        )
      })}
    </div>
  )

  // Where a fixed file goes — straight onto this asset, not a Drive subfolder.
  const renderUpload = (a: CreativeAsset) => {
    const revs = revisionsByAsset[a.id] ?? []
    return (
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
              const r = await uploadRevisionFile(f, a.id, projectId, brandId)
              if (!r.ok) setErr(r.error); else router.refresh()
            } catch (ex) { setErr(ex instanceof Error ? ex.message : 'Upload failed') }
            finally { setUploading(false); e.target.value = '' }
          }}
        />
        <span style={{ fontSize: 15 }}>⬆</span>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600 }}>{uploading ? 'Uploading…' : 'Upload revised version'}</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            Becomes Edit {revs.length + 1}, and the client is switched to it right away.
          </div>
        </div>
      </label>
    )
  }

  const renderVisibility = (a: CreativeAsset) => (
    <label style={{ textTransform: 'none', letterSpacing: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 12, cursor: pending ? 'wait' : 'pointer' }}>
      <input
        type="checkbox"
        checked={!!a.client_visible}
        disabled={pending}
        onChange={e => run(() => setAssetClientVisible(a.id, e.target.checked, projectId, brandId))}
        style={{ width: 'auto', margin: 0 }}
      />
      <span style={{ fontSize: 12, fontWeight: 600 }}>Visible to client</span>
      <span style={{ marginLeft: 'auto', fontSize: 11, color: a.client_visible ? 'var(--success)' : 'var(--text-muted)' }}>
        {a.client_visible ? 'on the review link' : 'hidden'}
      </span>
    </label>
  )

  // Write a note on THIS creative. Asked for on the editors' call — until then
  // the preview could show comments but not take one, so an editor reviewing
  // here had to go elsewhere to say anything. Internal audience: this is the
  // editors' own channel, and a note typed here must never reach the client.
  const renderNote = () => (
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
  )

  // ONE definition of "which version is the client looking at", used by both
  // the Gallery pill and the VERSIONS stack. Two near-identical expressions
  // disagreed on the asset that has a published_url but no revision ROWS — a
  // real state, since recordAssetRevision swallows insert failures and returns
  // null after published_url has already been written. The pill said "Client on
  // older version" while the stack said the Original was live.
  //
  // published_url NULL means "sent as-is", i.e. the Original — publishAssets
  // leaves it null for an unedited ad. It does not mean "nothing sent".
  const versionRows = (a: CreativeAsset) => {
    const revs = revisionsByAsset[a.id] ?? []
    return [null as string | null, ...revs.map(r => r.image_url)]
  }
  const isLiveUrl = (a: CreativeAsset, url: string | null) =>
    !!a.client_visible && (a.published_url ? url === a.published_url : url === null)

  const clientState = (a: CreativeAsset): 'hidden' | 'live' | 'stale' | 'unknown' => {
    if (!a.client_visible) return 'hidden'
    const rows = versionRows(a)
    if (!rows.some(u => isLiveUrl(a, u))) return 'unknown'
    return isLiveUrl(a, rows[rows.length - 1]) ? 'live' : 'stale'
  }

  // Versions — the stack IS the control. Exactly one row is what the client
  // sees, so "which version are they looking at" is answered by looking, not by
  // remembering which button was pressed last.
  const renderVersions = (a: CreativeAsset) => {
    const revs = revisionsByAsset[a.id] ?? []
    // `thumb` feeds the 26px list image, `fullUrl` feeds the zoom overlay. They
    // differ for the Original: Drive is asked for w600 for the list and w2048
    // for the expand, so clicking a version and then expanding no longer hands
    // the reviewer a thumbnail to scrutinise. Revisions are already full-size.
    //
    // The Original's fullUrl must NOT go through full(), which prefers
    // revision_url — on a revised ad that made "Original → expand" show the
    // latest edit.
    const originalUrl = a.thumbnail_url ?? driveThumb(a.drive_file_id, 600)
    const originalFull = resizeDriveThumb(a.thumbnail_url, 2048) ?? driveThumb(a.drive_file_id, 2048)
    const rows = [
      { key: 'original', label: 'Original', url: null as string | null, thumb: originalUrl, fullUrl: originalFull, at: null as string | null },
      ...revs.map(r => ({ key: r.id, label: `Edit ${r.revision_number}`, url: r.image_url, thumb: r.image_url, fullUrl: r.image_url, at: r.created_at })),
    ]
    // client_visible is the "is the client seeing this at all" flag — it is
    // exactly what the client review link filters on. published_url only
    // records WHICH version was sent, and publishAssets leaves it null for an
    // unedited ad, so visible + null means the client is on the Original.
    const clientSees = !!a.client_visible
    const isLive = (url: string | null) => isLiveUrl(a, url)
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
                outline: override?.label === r.label ? '2px solid var(--accent)' : 'none', outlineOffset: -2,
              }}>
                {/* Clicking the row VIEWS this version. Publishing is the button. */}
                <button
                  onClick={() => setViewOverride({ assetId: a.id, url: r.thumb, full: r.fullUrl, label: r.label })}
                  title={`View ${r.label}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, padding: 0, border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left' }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.thumb} alt="" loading="lazy" style={{ width: 26, height: 33, objectFit: 'cover', borderRadius: 6, flexShrink: 0, border: '1px solid var(--border)' }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: live ? 700 : 500 }}>
                      {r.label}{i === rows.length - 1 && rows.length > 1 ? ' · latest' : ''}
                    </div>
                    {r.at && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{commentStamp(r.at)}</div>}
                  </div>
                </button>
                {live ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: 'var(--success)', whiteSpace: 'nowrap' }}>
                    <Dot color="var(--success)" />CLIENT SEES THIS
                  </span>
                ) : (
                  <button
                    disabled={pending}
                    onClick={() => run(() => setClientVersion(a.id, r.url, projectId, brandId))}
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
  }

  const renderComments = (a: CreativeAsset) => {
    const all = commentsFor[a.id] ?? []
    const client = all.filter(c => c.audience !== 'internal')
    const internal = all.filter(c => c.audience === 'internal')
    if (all.length === 0) return <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No comments on this creative.</p>

    // Two labelled groups, never one mixed list. Which audience a note came
    // from changes what you do about it, so it should never take a second read.
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
                {/* Tick it off once addressed. */}
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
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{commentStamp(c.created_at)}</span>
                    {done && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--success)' }}>✓ ADDRESSED</span>}
                  </div>
                  <EditableNoteBody
                    content={c.content}
                    editedAt={c.edited_at ?? null}
                    canEditNote={c.audience === 'internal' && !!currentUserId && c.author_id === currentUserId}
                    onSave={t => editInternalComment(c.id, projectId, brandId, t)}
                    style={{ fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', textDecoration: done ? 'line-through' : 'none' }}
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    )
    return <>{group('Client feedback', client, REVISED_BLUE)}{mode === 'internal' && group('Internal notes', internal, 'var(--text-secondary)')}</>
  }

  // /internal-review is the only screen with pin annotations, and after the
  // banner was removed from the project page this link is the app's only route
  // to it. It cannot live in Gallery alone: below 900px Gallery is disabled, so
  // the screen would be reachable only by typing the URL.
  const renderPinsLink = () => (
    <Link
      href={`/brands/${brandId}/projects/${projectId}/internal-review`}
      style={{ display: 'inline-block', marginTop: 4, fontSize: 11, fontWeight: 600, color: 'var(--accent)' }}
    >
      Annotation pins →
    </Link>
  )

  const closeGallery = () => (
    <button
      onClick={() => chooseView('tile')}
      title="Back to the grid (Esc)"
      aria-label="Close gallery view"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0,
        padding: '6px 12px 6px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer',
        border: '1px solid var(--border-strong)', background: 'var(--surface-2)', color: 'var(--text-primary)',
      }}
    >
      <XIcon s={14} />Close
    </button>
  )

  const renderViewToggle = () => !wide ? null : (
    <div role="group" aria-label="View" style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
      {([['tile', 'Tile View'], ['gallery', 'Gallery View']] as const).map(([v, label]) => (
        <button
          key={v}
          onClick={() => chooseView(v)}
          aria-pressed={view === v}
          title={v === 'gallery' ? 'One big image, filmstrip below (Esc to leave)' : 'The grid'}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '7px 12px', fontSize: 12, fontWeight: view === v ? 700 : 500, border: 'none', cursor: 'pointer',
            background: view === v ? 'var(--accent)' : 'transparent',
            color: view === v ? '#fff' : 'var(--text-muted)',
          }}
        >{v === 'tile' ? <GridIcon /> : <PaneIcon />}{label}</button>
      ))}
    </div>
  )

  return (
    <div>
      {/* Mode + view + bulk push */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          {(['internal', 'client'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              padding: '8px 16px', fontSize: 12, fontWeight: mode === m ? 700 : 500, border: 'none', cursor: 'pointer',
              background: mode === m ? 'var(--accent)' : 'transparent', color: mode === m ? '#fff' : 'var(--text-muted)',
            }}>{m === 'internal' ? 'Internal review' : 'Client review'}</button>
          ))}
        </div>
        {renderViewToggle()}
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

          Rejected is always shown now: the verdict row can set it, and a
          zero-count tile is the fastest way to confirm nothing is rejected. */}
      <div role="group" aria-label="Filter creatives" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(116px,1fr))', gap: 8, marginBottom: 12 }}>
        {([
          ['all',            'All',           statusPool.length,    'ads',                     'var(--text-primary)'],
          ['pending',        'Pending',       counts.pending,       'ads',                     'var(--text-secondary)'],
          ['approved',       'Approved',      counts.approved,      'ads',                     'var(--success)'],
          ['needs_revision', 'Needs changes', counts.needs_revision, 'ads',                    'var(--danger)'],
          ['revised',        'Revised',       counts.revised,       'ads',                     REVISED_BLUE],
          ['rejected',       'Rejected',      counts.rejected,      'ads',                     'var(--danger)'],
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

      {/* A second, independent axis. The tiles above say what a human decided;
          this says whether the FILE has been re-uploaded. Pills, not tiles, so
          "Revised" the verdict and "Revised uploads" the fact never read as two
          of the same control. */}
      <div role="group" aria-label="Filter by upload" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginRight: 2 }}>Uploads</span>
        {([
          ['all',     'All',             assets.length],
          ['new',     'New uploads',     counts.newUploads],
          ['revised', 'Revised uploads', counts.revisedUploads],
        ] as const).map(([k, label, n]) => {
          const on = uploadFilter === k
          return (
            <button
              key={k}
              onClick={() => setUploadFilter(k)}
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

      {/* Batch revisions. Internal only — a client reviewer has nothing to upload. */}
      {mode === 'internal' && (
        <BulkRevisionUpload
          projectId={projectId}
          brandId={brandId}
          assets={assets.map(a => ({ id: a.id, name: a.name }))}
        />
      )}

      {/* ── TILE VIEW ── */}
      {/* Both columns grow with the window. The panel's minimum went 320 -> 340;
          its SHARE was left alone deliberately — giving it more reached the
          two-column threshold only at 1920 and cost the thumbnail grid a column
          at 1280 and 1600 to get there. */}
      {view === 'tile' && (
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.3fr) minmax(340px,1fr)', gap: 16 }}>
        {/* Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(128px,1fr))', gap: 8, alignContent: 'start' }}>
          {shown.map(a => {
            const n = commentsFor[a.id]?.length ?? 0
            const on = a.id === activeId
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
                      {(filter !== 'all' || uploadFilter !== 'all') && <span> in this filter</span>}
                    </span>
                    {/* The keys work whether or not anyone reads this; saying so is
                        what turns them from a secret into a shortcut. */}
                    <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--text-muted)' }}>← → also work</span>
                  </div>
                )}

                {/* Click to expand — inline for flow, full size for scrutiny */}
                {override && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 8px', marginBottom: 8, borderRadius: 6, background: 'rgba(234,179,8,0.10)', border: '1px solid rgba(234,179,8,0.28)' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--warning)' }}>Viewing {override.label}</span>
                    <button onClick={() => setViewOverride(null)} style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer' }}>
                      Back to latest
                    </button>
                  </div>
                )}
                <button onClick={() => setZoom(true)} title="Click to view full size" style={{ display: 'block', width: '100%', padding: 0, border: 'none', background: 'none', cursor: 'zoom-in', marginBottom: 8 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={override?.url ?? thumb(active)} alt="" style={{ width: '100%', borderRadius: 10, display: 'block' }} />
                </button>
              </div>

              <div style={{ minWidth: 0 }}>
                {renderVerdicts(active)}
                {renderUpload(active)}
                {renderVisibility(active)}
                {renderNote()}
                {renderVersions(active)}
                {renderComments(active)}
                {renderPinsLink()}
              </div>
            </div>
          ) : <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No creatives synced yet.</p>}
        </div>
      </div>
      )}

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
          {feedComments.slice(0, feedLimit).map(c => {
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
                    {c.author_name} · {commentStamp(c.created_at)}
                    {done && <span style={{ color: 'var(--success)', fontWeight: 700 }}> · done</span>}
                  </div>
                  <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: done ? 'line-through' : 'none' }}>{c.content}</div>
                </div>
                {a && <button onClick={() => pickAsset(a.id, true)} style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 6, border: '1px solid var(--accent)', background: 'var(--accent-muted)', color: 'var(--accent)', cursor: 'pointer' }}>Open creative →</button>}
              </div>
            )
          })}
          {feedComments.length > feedLimit && (
            <button
              onClick={() => setFeedLimit(feedComments.length)}
              style={{ ...btn('transparent', 'var(--accent)'), borderColor: 'var(--accent)', width: '100%' }}
            >
              Show all {feedComments.length} comments
            </button>
          )}
        </div>
      )}

      {/* ── GALLERY VIEW ── */}
      {/* A fixed overlay, not an in-flow block. In the Creatives tab this
          component gets ~1400px however big the monitor is: 1760 page cap, less
          the 210px sub-nav and the card padding. One large image plus a rail
          does not fit in that, and page scroll would fight the rail's own
          scroll. The zoom lightbox below already escapes the same card, so this
          is a proven move — .card sets no transform or z-index, and creates no
          stacking context to trap a fixed child. */}
      {view === 'gallery' && wide && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Gallery view"
          style={{
            position: 'fixed', inset: 0, zIndex: 800, background: 'var(--background)',
            display: 'flex', flexDirection: 'row',
          }}
        >
          {/* A filter can empty the strip. The overlay still renders, because
              the only way back to tiles from in here is the toggle in the rail —
              hiding it would leave an editor on a black screen with nothing but
              Escape, which they have no reason to guess. */}
          {!active ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Nothing matches this filter.</p>
              {renderViewToggle()}
            </div>
          ) : (<>
          {/* Stage column */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: '18px 20px 14px' }}>
            <div style={{ flexShrink: 0, marginBottom: 12 }}>
              <div
                title={active.name ?? undefined}
                style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 18, fontWeight: 600, color: 'var(--text-primary)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
              >{active.name ?? 'untitled'}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 6, flexWrap: 'wrap' }}>
                <StatusChip status={statusOf(active)} size="md" />
                {/* Three states, not two. "Live on client" and "hidden" would
                    hide the one case that matters most: an ad published as the
                    Original that has since been revised. */}
                {clientState(active) === 'hidden' && <Pill color="var(--text-muted)" label="Not sent" />}
                {clientState(active) === 'live' && <Pill color="var(--success)" label="Live on client" />}
                {clientState(active) === 'stale' && <Pill color="var(--warning)" label="Client on older version" />}
                {clientState(active) === 'unknown' && <Pill color="var(--text-muted)" label="Visible, version unknown" />}
                {override && (
                  <button
                    onClick={() => setViewOverride(null)}
                    style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, cursor: 'pointer', border: '1px solid rgba(234,179,8,0.4)', background: 'rgba(234,179,8,0.10)', color: 'var(--warning)' }}
                  >Viewing {override.label} · back to latest</button>
                )}
              </div>
            </div>

            {/* minHeight:0 is load-bearing. Without it this flex child refuses
                to shrink below its content and pushes the filmstrip off-screen. */}
            <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {shown.length > 1 && (
                <button onClick={() => step(-1)} title="Previous (←)" aria-label="Previous creative" style={{ ...galleryNavBtn, left: 0 }}>‹</button>
              )}
              <button
                onClick={() => setZoom(true)}
                title="Click to view full size"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', minHeight: 0, padding: 0, border: 'none', background: 'none', cursor: 'zoom-in' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={override?.full ?? full(active)} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block', borderRadius: 8 }} />
              </button>
              {shown.length > 1 && (
                <button onClick={() => step(1)} title="Next (→)" aria-label="Next creative" style={{ ...galleryNavBtn, right: 0 }}>›</button>
              )}
              {/* Second exit, over the artwork. The rail is 380px from where
                  the eye actually is on a wide monitor. */}
              <button
                onClick={() => chooseView('tile')}
                title="Back to the grid (Esc)"
                aria-label="Close gallery view"
                style={{
                  position: 'absolute', top: 0, right: 0, zIndex: 2,
                  width: 34, height: 34, borderRadius: '50%', display: 'grid', placeItems: 'center',
                  cursor: 'pointer', border: '1px solid var(--border-strong)',
                  background: 'var(--surface-2)', color: 'var(--text-secondary)',
                }}
              >
                <XIcon s={15} />
              </button>
            </div>

            {/* Filmstrip. Maps `shown`, so it respects both filter axes and the
                chevrons walk exactly what is in it. */}
            <div style={{ flexShrink: 0, marginTop: 12, display: 'flex', gap: 8, overflowX: 'auto', overflowY: 'hidden', paddingBottom: 6 }}>
              {shown.map(a => {
                const on = a.id === activeId
                const n = commentsFor[a.id]?.length ?? 0
                return (
                  <button
                    key={a.id}
                    ref={el => { stripRefs.current[a.id] = el }}
                    onClick={() => pickAsset(a.id)}
                    title={a.name ?? undefined}
                    style={{
                      position: 'relative', flexShrink: 0, width: 62, height: 78, padding: 0, borderRadius: 8,
                      overflow: 'hidden', cursor: 'pointer', background: 'var(--surface-1)',
                      border: `2px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                      opacity: on ? 1 : 0.62,
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={thumb(a)} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    {n > 0 && (
                      <span style={{ position: 'absolute', top: 3, right: 3, fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 999, background: 'rgba(0,0,0,0.6)', color: '#fff' }}>{n}</span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Rail */}
          <div style={{ width: 380, flexShrink: 0, borderLeft: '1px solid var(--border)', background: 'var(--surface-1)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {shownIndex + 1} of {shown.length}
                {(filter !== 'all' || uploadFilter !== 'all') && <span> in this filter</span>}
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--text-muted)' }}>esc</span>
              {closeGallery()}
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16 }}>
              {renderVerdicts(active)}
              {renderUpload(active)}
              {renderVisibility(active)}
              {renderVersions(active)}
              {renderComments(active)}
              {renderNote()}
              {renderPinsLink()}
            </div>
          </div>
          </>)}
        </div>
      )}

      {/* Full-size viewer. Escape and a visible ✕ as well as the backdrop —
          clicking the dark edge is not discoverable, and this is the one view
          a reviewer is asked to study rather than skim. zIndex 900 puts it
          above the gallery overlay at 800. */}
      {zoom && active && (
        <div onClick={() => setZoom(false)} style={{ position: 'fixed', inset: 0, zIndex: 900, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 28, cursor: 'zoom-out' }}>
          <button
            onClick={e => { e.stopPropagation(); setZoom(false) }}
            aria-label="Close full-size view"
            style={{ position: 'fixed', top: 18, right: 22, width: 34, height: 34, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.35)', background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 17, lineHeight: 1, cursor: 'pointer' }}
          >✕</button>
          {override && (
            <div style={{ position: 'fixed', top: 22, left: 24, fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.85)' }}>{override.label}</div>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={override?.full ?? full(active)} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 10 }} />
        </div>
      )}
    </div>
  )
}

const navBtn: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 7, fontSize: 15, lineHeight: 1, cursor: 'pointer',
  border: '1px solid var(--border-strong)', background: 'var(--surface-2)', color: 'var(--text-secondary)',
}

const galleryNavBtn: React.CSSProperties = {
  position: 'absolute', top: '50%', transform: 'translateY(-50%)', zIndex: 2,
  width: 44, height: 44, borderRadius: '50%', fontSize: 24, lineHeight: 1, cursor: 'pointer',
  border: '1px solid var(--border-strong)', background: 'var(--surface-2)', color: 'var(--text-primary)',
}
