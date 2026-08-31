'use client'

import { useMemo, useState } from 'react'
import type { CreativeAsset, ProjectComment } from '@/lib/types'
import type { AssetRevision } from '@/lib/revisions'

// The editors' proposed review workspace (Jaspen's B1-B11), read-only.
//
// Two things this fixes versus today: the status is written in WORDS on every
// tile instead of an unlabelled dot, and a comment carries a jump back to the
// creative it is about. Both were explicit asks.
type Mode = 'internal' | 'client'
type Filter = 'all' | 'pending' | 'approved' | 'needs_revision' | 'commented'

const STATUS_META: Record<string, { label: string; color: string }> = {
  pending:        { label: 'Pending',          color: 'var(--text-muted)' },
  approved:       { label: 'Approved',         color: 'var(--success)' },
  needs_revision: { label: 'Changes requested', color: '#EF4444' },
  rejected:       { label: 'Rejected',         color: '#EF4444' },
}

export default function ReviewWorkspace({
  assets, comments, revisionsByAsset,
}: {
  assets: CreativeAsset[]
  comments: ProjectComment[]
  revisionsByAsset: Record<string, AssetRevision[]>
}) {
  const [mode, setMode] = useState<Mode>('internal')
  const [filter, setFilter] = useState<Filter>('all')
  const [selected, setSelected] = useState<string | null>(assets[0]?.id ?? null)

  // Internal and client approval are SEPARATE columns. Showing one set of
  // counts for both is what makes today's status "unclear/misleading".
  const statusOf = (a: CreativeAsset) => (mode === 'internal' ? a.internal_status : a.status) ?? 'pending'

  const commentsFor = useMemo(() => {
    const m: Record<string, ProjectComment[]> = {}
    for (const c of comments) if (c.asset_id) (m[c.asset_id] ??= []).push(c)
    return m
  }, [comments])

  const counts = useMemo(() => {
    const c = { pending: 0, approved: 0, needs_revision: 0, rejected: 0, commented: 0 }
    for (const a of assets) {
      const s = statusOf(a)
      if (s in c) (c as Record<string, number>)[s]++
      if ((commentsFor[a.id]?.length ?? 0) > 0) c.commented++
    }
    return c
  }, [assets, mode, commentsFor]) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => assets.filter(a => {
    if (filter === 'all') return true
    if (filter === 'commented') return (commentsFor[a.id]?.length ?? 0) > 0
    return statusOf(a) === filter
  }), [assets, filter, commentsFor, mode]) // eslint-disable-line react-hooks/exhaustive-deps

  const active = assets.find(a => a.id === selected) ?? null
  const activeRevisions = active ? (revisionsByAsset[active.id] ?? []) : []
  const total = assets.length || 1
  const pct = (n: number) => `${(100 * n / total).toFixed(1)}%`

  const thumb = (a: CreativeAsset) =>
    a.revision_url ?? a.thumbnail_url ?? `https://drive.google.com/thumbnail?id=${a.drive_file_id}&sz=w600`

  return (
    <div>
      {/* Internal / Client toggle — B1 + B2 */}
      <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', width: 'fit-content', marginBottom: 14 }}>
        {(['internal', 'client'] as const).map(m => (
          <button key={m} onClick={() => setMode(m)} style={{
            padding: '7px 16px', fontSize: 12.5, fontWeight: mode === m ? 700 : 500, border: 'none', cursor: 'pointer',
            background: mode === m ? 'var(--accent)' : 'transparent', color: mode === m ? '#fff' : 'var(--text-muted)',
          }}>{m === 'internal' ? 'Internal review' : 'Client review'}</button>
        ))}
      </div>

      {/* Counts — B2 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10, marginBottom: 12 }}>
        {([['Pending', counts.pending, 'var(--text-muted)'], ['Approved', counts.approved, 'var(--success)'],
           ['Changes requested', counts.needs_revision, '#EF4444'], ['Rejected', counts.rejected, '#EF4444'],
           ['Commented', counts.commented, 'var(--accent)']] as const).map(([l, n, col]) => (
          <div key={l} style={{ padding: '11px 13px', border: '1px solid var(--border)', borderRadius: 9, background: 'var(--surface-1)' }}>
            <div style={{ fontSize: 21, fontWeight: 800, color: col, lineHeight: 1 }}>{n}</div>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{l}</div>
          </div>
        ))}
      </div>

      {/* Progress bar — B4 */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', height: 7, borderRadius: 4, overflow: 'hidden', background: 'var(--surface-raised)' }}>
          <div style={{ width: pct(counts.approved), background: 'var(--success)' }} />
          <div style={{ width: pct(counts.needs_revision + counts.rejected), background: '#EF4444' }} />
          <div style={{ width: pct(counts.pending), background: 'var(--border-strong)' }} />
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 6 }}>
          {counts.approved} of {assets.length} approved · {counts.needs_revision} need changes · {counts.pending} pending
        </div>
      </div>

      {/* Filters — B3 */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {([['all', `All ${assets.length}`], ['pending', `Pending ${counts.pending}`], ['approved', `Approved ${counts.approved}`],
           ['needs_revision', `Changes ${counts.needs_revision}`], ['commented', `Commented ${counts.commented}`]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k as Filter)} style={{
            padding: '5px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
            border: `1px solid ${filter === k ? 'var(--accent)' : 'var(--border)'}`,
            background: filter === k ? 'var(--accent-muted)' : 'transparent',
            color: filter === k ? 'var(--accent)' : 'var(--text-muted)', fontWeight: filter === k ? 600 : 400,
          }}>{l}</button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.35fr) minmax(0,1fr)', gap: 20 }}>
        {/* Grid — B11: words, not dots */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(132px,1fr))', gap: 10, alignContent: 'start' }}>
          {shown.map(a => {
            const s = statusOf(a); const meta = STATUS_META[s] ?? STATUS_META.pending
            const n = commentsFor[a.id]?.length ?? 0
            const on = a.id === selected
            return (
              <button key={a.id} onClick={() => setSelected(a.id)} style={{
                padding: 0, border: `2px solid ${on ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 10,
                overflow: 'hidden', cursor: 'pointer', background: 'var(--surface-1)', textAlign: 'left',
              }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumb(a)} alt="" loading="lazy" style={{ width: '100%', aspectRatio: '4/5', objectFit: 'cover', display: 'block' }} />
                <div style={{ padding: '7px 8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 700, color: meta.color, whiteSpace: 'nowrap' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
                      {meta.label}
                    </span>
                    {n > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)' }}>💬 {n}</span>}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {(a.name ?? 'untitled').replace(/\.(png|jpg|jpeg)$/i, '')}
                  </div>
                </div>
              </button>
            )
          })}
          {shown.length === 0 && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Nothing matches this filter.</p>}
        </div>

        {/* Detail pane */}
        <div style={{ position: 'sticky', top: 16, alignSelf: 'start' }}>
          {active ? (
            <div style={{ border: '1px solid var(--border)', borderRadius: 11, padding: 14, background: 'var(--surface-1)' }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8, wordBreak: 'break-word' }}>{active.name ?? 'Untitled'}</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={thumb(active)} alt="" style={{ width: '100%', borderRadius: 8, display: 'block', marginBottom: 10 }} />

              {/* Version history — B9 (data already exists) */}
              <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                Versions
              </div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 12 }}>
                <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 6, border: '1px solid var(--border)', color: 'var(--text-muted)' }}>Original</span>
                {activeRevisions.map(r => (
                  <span key={r.id} title={new Date(r.created_at).toLocaleString()} style={{
                    fontSize: 11, padding: '3px 9px', borderRadius: 6,
                    border: `1px solid ${r.revision_number === activeRevisions.length ? 'var(--accent)' : 'var(--border)'}`,
                    color: r.revision_number === activeRevisions.length ? 'var(--accent)' : 'var(--text-muted)',
                    fontWeight: r.revision_number === activeRevisions.length ? 700 : 400,
                  }}>Edit {r.revision_number}{r.revision_number === activeRevisions.length ? ' ·current' : ''}</span>
                ))}
                {activeRevisions.length === 0 && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>no edits yet</span>}
              </div>

              <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 7 }}>
                Comments ({commentsFor[active.id]?.length ?? 0})
              </div>
              {(commentsFor[active.id] ?? []).map(c => (
                <div key={c.id} style={{ padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 6 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 11.5 }}>{c.author_name}</strong>
                    <span style={{ fontSize: 9.5, padding: '1px 6px', borderRadius: 9, fontWeight: 700, background: c.audience === 'internal' ? 'var(--surface-raised)' : 'rgba(96,165,250,0.15)', color: c.audience === 'internal' ? 'var(--text-muted)' : '#60a5fa' }}>
                      {c.audience === 'internal' ? 'INTERNAL' : 'CLIENT'}
                    </span>
                    {/* B10 — the check that today only exists on the LP side */}
                    <span style={{ fontSize: 10, fontWeight: 700, color: c.resolved_at ? 'var(--success)' : 'var(--text-muted)' }}>
                      {c.resolved_at ? '✓ resolved' : '○ open'}
                    </span>
                  </div>
                  <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>{c.content}</div>
                </div>
              ))}
              {(commentsFor[active.id]?.length ?? 0) === 0 && (
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No comments on this creative.</p>
              )}
            </div>
          ) : <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No creatives synced yet.</p>}
        </div>
      </div>

      {/* Comment activity with jump-to-creative — B6 */}
      {comments.length > 0 && (
        <div style={{ marginTop: 26 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>Comment activity</div>
          {comments.slice(0, 12).map(c => {
            const a = assets.find(x => x.id === c.asset_id)
            return (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 9, marginBottom: 6 }}>
                {a && /* eslint-disable-next-line @next/next/no-img-element */ (
                  <img src={thumb(a)} alt="" loading="lazy" style={{ width: 38, height: 47, objectFit: 'cover', borderRadius: 5, flexShrink: 0 }} />
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>
                    {c.author_name} · {new Date(c.created_at).toLocaleDateString()}
                    {c.resolved_at && <span style={{ color: 'var(--success)', fontWeight: 700 }}> · ✓ resolved</span>}
                  </div>
                  <div style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.content}</div>
                </div>
                {a && (
                  <button onClick={() => setSelected(a.id)} style={{
                    flexShrink: 0, fontSize: 11.5, fontWeight: 600, padding: '5px 11px', borderRadius: 7,
                    border: '1px solid var(--accent)', background: 'var(--accent-muted)', color: 'var(--accent)', cursor: 'pointer',
                  }}>Open creative →</button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
