'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { CreativeAsset, ProjectComment } from '@/lib/types'
import type { AssetRevision } from '@/lib/revisions'
import {
  updateAssetStatusInternal,
  setAssetClientVisible,
  publishAssets,
  toggleCommentResolved,
  uploadAssetRevision,
  setClientVersion,
} from '@/lib/actions'

// Review, inline in the Creatives tab. Replaces the separate /internal-review
// route: the context switch was costing an editor on every single review, and
// the extra screen width it bought only matters when inspecting one image —
// which the expand-to-full-size handles instead.
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
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: size === 'sm' ? 10.5 : 12, fontWeight: 700, color: m.color, whiteSpace: 'nowrap',
    }}>
      <Dot color={m.color} size={size === 'sm' ? 7 : 9} />{m.label}
    </span>
  )
}

export default function ReviewWorkspace({
  projectId, brandId, assets, comments, revisionsByAsset,
}: {
  projectId: string
  brandId: string
  assets: CreativeAsset[]
  comments: ProjectComment[]
  revisionsByAsset: Record<string, AssetRevision[]>
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [mode, setMode] = useState<Mode>('internal')
  const [filter, setFilter] = useState<Filter>('all')
  const [selected, setSelected] = useState<string | null>(assets[0]?.id ?? null)
  const [zoom, setZoom] = useState(false)
  const [uploading, setUploading] = useState(false)
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

  const active = assets.find(a => a.id === selected) ?? null
  const activeRevs = active ? (revisionsByAsset[active.id] ?? []) : []
  const thumb = (a: CreativeAsset) =>
    a.revision_url ?? a.thumbnail_url ?? `https://drive.google.com/thumbnail?id=${a.drive_file_id}&sz=w600`
  const full = (a: CreativeAsset) =>
    a.revision_url ?? `https://drive.google.com/thumbnail?id=${a.drive_file_id}&sz=w2048`

  const run = (fn: () => Promise<unknown>) => {
    setErr('')
    startTransition(async () => {
      try { await fn(); router.refresh() }
      catch (e) { setErr(e instanceof Error ? e.message : 'Action failed') }
    })
  }

  const approvedNotPushed = assets.filter(a => a.internal_status === 'approved' && !a.client_visible)

  const btn = (bg: string, fg = '#fff'): React.CSSProperties => ({
    fontSize: 12, fontWeight: 600, padding: '7px 12px', borderRadius: 7,
    border: bg === 'transparent' ? '1px solid var(--border)' : 'none',
    background: bg, color: fg, cursor: pending ? 'wait' : 'pointer', opacity: pending ? 0.6 : 1,
  })

  return (
    <div>
      {/* Mode + bulk push */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          {(['internal', 'client'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              padding: '7px 16px', fontSize: 12.5, fontWeight: mode === m ? 700 : 500, border: 'none', cursor: 'pointer',
              background: mode === m ? 'var(--accent)' : 'transparent', color: mode === m ? '#fff' : 'var(--text-muted)',
            }}>{m === 'internal' ? 'Internal review' : 'Client review'}</button>
          ))}
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {counts.visible} of {assets.length} ads visible to the client
        </span>
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

      {err && <div style={{ marginBottom: 12, padding: '9px 13px', borderRadius: 8, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: 'var(--danger)', fontSize: 12.5 }}>{err}</div>}

      {/* Counters — units on every number so "27 ads" can't read as "27 comments" */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(118px,1fr))', gap: 9, marginBottom: 12 }}>
        {([['Pending', counts.pending, 'var(--text-muted)', 'ads'],
           ['Approved', counts.approved, 'var(--success)', 'ads'],
           ['Needs changes', counts.needs_revision, '#EF4444', 'ads'],
           ['Rejected', counts.rejected, '#EF4444', 'ads'],
           ['Comments', commentTotal, 'var(--accent)', `on ${counts.commented} ads`]] as const).map(([l, n, col, unit]) => (
          <div key={l} style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 9, background: 'var(--surface-1)' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: col, lineHeight: 1 }}>{n}</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>{l}</div>
            <div style={{ fontSize: 9.5, color: 'var(--text-muted)', opacity: 0.7 }}>{unit}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {([['all', `All ${assets.length}`], ['pending', `Pending ${counts.pending}`], ['approved', `Approved ${counts.approved}`],
           ['needs_revision', `Needs changes ${counts.needs_revision}`], ['commented', `Commented ${counts.commented}`]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k as Filter)} style={{
            padding: '5px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
            border: `1px solid ${filter === k ? 'var(--accent)' : 'var(--border)'}`,
            background: filter === k ? 'var(--accent-muted)' : 'transparent',
            color: filter === k ? 'var(--accent)' : 'var(--text-muted)', fontWeight: filter === k ? 600 : 400,
          }}>{l}</button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.3fr) minmax(320px,1fr)', gap: 18 }}>
        {/* Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(128px,1fr))', gap: 9, alignContent: 'start' }}>
          {shown.map(a => {
            const n = commentsFor[a.id]?.length ?? 0
            const on = a.id === selected
            return (
              <button key={a.id} onClick={() => setSelected(a.id)} style={{
                padding: 0, border: `2px solid ${on ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 10,
                overflow: 'hidden', cursor: 'pointer', background: 'var(--surface-1)', textAlign: 'left', position: 'relative',
              }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumb(a)} alt="" loading="lazy" style={{ width: '100%', aspectRatio: '4/5', objectFit: 'cover', display: 'block' }} />
                {!a.client_visible && (
                  <span style={{ position: 'absolute', top: 6, left: 6, fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'rgba(0,0,0,0.72)', color: '#fff' }}>
                    HIDDEN FROM CLIENT
                  </span>
                )}
                <div style={{ padding: '7px 8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <StatusChip status={statusOf(a)} />
                    {n > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)' }}>💬 {n}</span>}
                  </div>
                  <div style={{ fontSize: 9.5, color: 'var(--text-muted)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {(a.name ?? 'untitled').replace(/\.(png|jpg|jpeg)$/i, '')}
                  </div>
                </div>
              </button>
            )
          })}
          {shown.length === 0 && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Nothing matches this filter.</p>}
        </div>

        {/* Detail */}
        <div style={{ position: 'sticky', top: 16, alignSelf: 'start' }}>
          {active ? (
            <div style={{ border: '1px solid var(--border)', borderRadius: 11, padding: 14, background: 'var(--surface-1)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9, flexWrap: 'wrap' }}>
                <StatusChip status={statusOf(active)} size="md" />
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
                  {mode === 'internal' ? 'internal' : 'client'} status
                </span>
              </div>

              {/* Click to expand — inline for flow, full size for scrutiny */}
              <button onClick={() => setZoom(true)} title="Click to view full size" style={{ display: 'block', width: '100%', padding: 0, border: 'none', background: 'none', cursor: 'zoom-in', marginBottom: 10 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumb(active)} alt="" style={{ width: '100%', borderRadius: 8, display: 'block' }} />
              </button>

              {/* The three actions */}
              {mode === 'internal' && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                  <button disabled={pending} onClick={() => run(() => updateAssetStatusInternal(active.id, projectId, brandId, 'approved'))} style={btn('var(--success)')}>✓ Approved internally</button>
                  <button disabled={pending} onClick={() => run(() => updateAssetStatusInternal(active.id, projectId, brandId, 'needs_revision'))} style={btn('#EF4444')}>Needs revision</button>
                </div>
              )}

              {/* Where a fixed file goes — straight onto this asset, not a Drive subfolder */}
              <label style={{
                display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', marginBottom: 10,
                border: '1px dashed var(--border-strong)', borderRadius: 8,
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
                      const fd = new FormData()
                      fd.append('file', f); fd.append('asset_id', active.id)
                      fd.append('project_id', projectId); fd.append('brand_id', brandId)
                      const r = await uploadAssetRevision(fd)
                      if (!r.ok) setErr(r.error); else router.refresh()
                    } catch (ex) { setErr(ex instanceof Error ? ex.message : 'Upload failed') }
                    finally { setUploading(false); e.target.value = '' }
                  }}
                />
                <span style={{ fontSize: 15 }}>⬆</span>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{uploading ? 'Uploading…' : 'Upload revised version'}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                    Becomes Edit {activeRevs.length + 1}. The client keeps seeing the published version until you send it.
                  </div>
                </div>
              </label>

              {/* Visible-to-client switch */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 11px', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 12, cursor: pending ? 'wait' : 'pointer' }}>
                <input
                  type="checkbox"
                  checked={!!active.client_visible}
                  disabled={pending}
                  onChange={e => run(() => setAssetClientVisible(active.id, e.target.checked, projectId, brandId))}
                  style={{ width: 'auto', margin: 0 }}
                />
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>Visible to client</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: active.client_visible ? 'var(--success)' : 'var(--text-muted)' }}>
                  {active.client_visible ? 'on the review link' : 'hidden'}
                </span>
              </label>

              {/* Versions — the stack IS the control. Exactly one row is what the
                  client sees, so "which version are they looking at" is answered
                  by looking, not by remembering which button was pressed last. */}
              {(() => {
                const originalUrl = `https://drive.google.com/thumbnail?id=${active.drive_file_id}&sz=w600`
                const rows = [
                  { key: 'original', label: 'Original', url: null as string | null, thumb: originalUrl, at: null as string | null },
                  ...activeRevs.map(r => ({ key: r.id, label: `Edit ${r.revision_number}`, url: r.image_url, thumb: r.image_url, at: r.created_at })),
                ]
                const publishedUrl = active.published_url
                // null published_url + never published = nothing sent yet
                const isLive = (url: string | null) =>
                  publishedUrl ? url === publishedUrl : false
                const anyLive = rows.some(r => isLive(r.url))
                const latest = rows[rows.length - 1]
                const stale = anyLive && !isLive(latest.url)

                return (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                      <span style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Versions</span>
                      {stale && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--warning)' }}>
                          client is on an older version
                        </span>
                      )}
                      {!anyLive && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)' }}>nothing sent yet</span>
                      )}
                    </div>

                    <div style={{ border: '1px solid var(--border)', borderRadius: 9, overflow: 'hidden' }}>
                      {rows.map((r, i) => {
                        const live = isLive(r.url)
                        return (
                          <div key={r.key} style={{
                            display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px',
                            borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                            background: live ? 'color-mix(in srgb, var(--success) 9%, transparent)' : 'transparent',
                          }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={r.thumb} alt="" loading="lazy" style={{ width: 26, height: 33, objectFit: 'cover', borderRadius: 4, flexShrink: 0, border: '1px solid var(--border)' }} />
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ fontSize: 12, fontWeight: live ? 700 : 500 }}>
                                {r.label}{i === rows.length - 1 && rows.length > 1 ? ' · latest' : ''}
                              </div>
                              {r.at && <div style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>{new Date(r.at).toLocaleDateString()}</div>}
                            </div>
                            {live ? (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 700, color: 'var(--success)', whiteSpace: 'nowrap' }}>
                                <Dot color="var(--success)" />CLIENT SEES THIS
                              </span>
                            ) : (
                              <button
                                disabled={pending}
                                onClick={() => run(() => setClientVersion(active.id, r.url, projectId, brandId))}
                                style={{ ...btn('transparent', 'var(--accent)'), fontSize: 11, padding: '4px 10px', borderColor: 'var(--accent)', whiteSpace: 'nowrap' }}
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
                  <div key={title} style={{ marginBottom: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7 }}>
                      <Dot color={accent} />
                      <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: accent }}>{title}</span>
                      <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                        {list.filter(c => !c.resolved_at).length} open of {list.length}
                      </span>
                      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                    </div>
                    {list.map(c => {
                      const done = !!c.resolved_at
                      return (
                        <div key={c.id} style={{
                          padding: '9px 11px', borderRadius: 8, marginBottom: 6,
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
                              <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginBottom: 3, flexWrap: 'wrap' }}>
                                <strong style={{ fontSize: 11.5 }}>{c.author_name}</strong>
                                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{new Date(c.created_at).toLocaleDateString()}</span>
                                {done && <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--success)' }}>✓ ADDRESSED</span>}
                              </div>
                              <div style={{ fontSize: 12.5, lineHeight: 1.5, textDecoration: done ? 'line-through' : 'none' }}>{c.content}</div>
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
          ) : <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No creatives synced yet.</p>}
        </div>
      </div>

      {/* Comment activity → jump to the creative */}
      {comments.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>Comment activity</div>
          {comments.slice(0, 15).map(c => {
            const a = assets.find(x => x.id === c.asset_id)
            return (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '8px 11px', border: '1px solid var(--border)', borderRadius: 9, marginBottom: 6 }}>
                {a && /* eslint-disable-next-line @next/next/no-img-element */ (
                  <img src={thumb(a)} alt="" loading="lazy" style={{ width: 34, height: 42, objectFit: 'cover', borderRadius: 5, flexShrink: 0 }} />
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{c.author_name} · {new Date(c.created_at).toLocaleDateString()}</div>
                  <div style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.content}</div>
                </div>
                {a && <button onClick={() => setSelected(a.id)} style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 600, padding: '5px 11px', borderRadius: 7, border: '1px solid var(--accent)', background: 'var(--accent-muted)', color: 'var(--accent)', cursor: 'pointer' }}>Open creative →</button>}
              </div>
            )
          })}
        </div>
      )}

      {/* Full-size viewer */}
      {zoom && active && (
        <div onClick={() => setZoom(false)} style={{ position: 'fixed', inset: 0, zIndex: 900, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 28, cursor: 'zoom-out' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={full(active)} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 8 }} />
        </div>
      )}
    </div>
  )
}
