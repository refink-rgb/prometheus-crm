'use client'

import { useState, useCallback } from 'react'
import { addProjectComment, approveProject, updateAssetStatus } from '@/lib/actions'
import type { CreativeAsset, ProjectComment } from '@/lib/types'

// ─── Single asset row ────────────────────────────────────────────────────────

function AssetRow({
  asset,
  index,
  token,
  initialComments,
  onStatusChange,
}: {
  asset: CreativeAsset
  index: number
  token: string
  initialComments: ProjectComment[]
  onStatusChange: (assetId: string, status: CreativeAsset['status']) => void
}) {
  const [comments, setComments] = useState<ProjectComment[]>(initialComments)
  const [pinMode, setPinMode] = useState(false)
  const [pendingPin, setPendingPin] = useState<{ x: number; y: number } | null>(null)
  const [activePin, setActivePin] = useState<string | null>(null)
  const [authorName, setAuthorName] = useState('')
  const [commentText, setCommentText] = useState('')
  const [posting, setPosting] = useState(false)
  const [status, setStatus] = useState<CreativeAsset['status']>(asset.status ?? 'pending')
  const [updatingStatus, setUpdatingStatus] = useState(false)

  const pinnedComments = comments.filter(c => c.pin_x != null)
  const pinIndex = (c: ProjectComment) => pinnedComments.findIndex(p => p.id === c.id) + 1

  const handleImageClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!pinMode) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    setPendingPin({ x, y })
    setPinMode(false)
  }, [pinMode])

  async function handlePost(e: React.FormEvent) {
    e.preventDefault()
    if (!commentText.trim()) return
    setPosting(true)
    const optimistic: ProjectComment = {
      id: `temp-${Date.now()}`,
      project_id: '',
      author_name: authorName.trim() || 'Anonymous',
      content: commentText.trim(),
      created_at: new Date().toISOString(),
      track: 'image',
      asset_id: asset.id,
      pin_x: pendingPin?.x ?? null,
      pin_y: pendingPin?.y ?? null,
      section_tag: null,
      audience: 'client',
    }
    setComments(prev => [...prev, optimistic])
    try {
      await addProjectComment(token, authorName.trim() || 'Anonymous', commentText.trim(), {
        track: 'image',
        asset_id: asset.id,
        pin_x: pendingPin?.x,
        pin_y: pendingPin?.y,
      })
      setCommentText('')
      setPendingPin(null)
    } catch {
      setComments(prev => prev.filter(c => c.id !== optimistic.id))
    } finally {
      setPosting(false)
    }
  }

  async function handleStatus(newStatus: CreativeAsset['status']) {
    if (newStatus === status) return
    setUpdatingStatus(true)
    try {
      await updateAssetStatus(token, asset.id, newStatus)
      setStatus(newStatus)
      onStatusChange(asset.id, newStatus)
    } finally {
      setUpdatingStatus(false)
    }
  }

  // Publish gate: the client sees the explicitly-published revision; until you
  // publish (and between new edits and the next publish) they see the last
  // published version, or the original if nothing has been published yet.
  const imgSrc = asset.published_url
    ?? `https://drive.google.com/thumbnail?id=${asset.drive_file_id}&sz=w2048`
  const statusColors: Record<CreativeAsset['status'], { bg: string; color: string; border: string }> = {
    pending:       { bg: 'transparent',           color: 'var(--text-muted)',    border: 'var(--border)' },
    approved:      { bg: 'rgba(34,197,94,0.12)',   color: 'var(--success)',       border: 'rgba(34,197,94,0.3)' },
    needs_revision:{ bg: 'rgba(239,68,68,0.1)',    color: 'var(--danger)',        border: 'rgba(239,68,68,0.3)' },
    rejected:      { bg: 'rgba(127,29,29,0.18)',   color: '#fca5a5',              border: 'rgba(127,29,29,0.5)' },
  }
  const statusLabel = (s: CreativeAsset['status']): string => {
    if (s === 'approved') return '✓ Approved'
    if (s === 'needs_revision') return '↩ Revision requested'
    if (s === 'rejected') return '✕ Rejected'
    return ''
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 340px',
      border: `1px solid ${status !== 'pending' ? statusColors[status].border : 'var(--border)'}`,
      borderRadius: 12,
      overflow: 'hidden',
      background: 'var(--surface)',
      transition: 'border-color 0.2s',
    }}>
      {/* ── Left: Image ── */}
      <div style={{ display: 'flex', flexDirection: 'column', background: '#080808' }}>
        {/* Image + pin overlay */}
        <div
          style={{ position: 'relative', cursor: pinMode ? 'crosshair' : 'default', flex: 1 }}
          onClick={handleImageClick}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imgSrc}
            alt={asset.name ?? `Creative ${index + 1}`}
            style={{ width: '100%', display: 'block', userSelect: 'none' }}
            draggable={false}
          />

          {/* Pending pin */}
          {pendingPin && (
            <div style={{
              position: 'absolute',
              left: `${pendingPin.x}%`, top: `${pendingPin.y}%`,
              transform: 'translate(-50%, -50%)',
              width: 28, height: 28, borderRadius: '50%',
              background: 'var(--accent)', border: '2px solid white',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700, color: 'white',
              boxShadow: '0 2px 8px rgba(0,0,0,0.5)', zIndex: 10, pointerEvents: 'none',
            }}>
              {pinnedComments.length + 1}
            </div>
          )}

          {/* Existing pins */}
          {pinnedComments.map(c => {
            const idx = pinIndex(c)
            const isActive = activePin === c.id
            return (
              <button
                key={c.id}
                onClick={e => { e.stopPropagation(); setActivePin(isActive ? null : c.id) }}
                aria-label={`Pin ${idx} — ${c.author_name}`}
                title={`Pin ${idx}: ${c.content.slice(0, 80)}${c.content.length > 80 ? '…' : ''}`}
                style={{
                  position: 'absolute',
                  left: `${c.pin_x}%`, top: `${c.pin_y}%`,
                  transform: 'translate(-50%, -50%)',
                  width: 26, height: 26, borderRadius: '50%',
                  background: isActive ? 'white' : '#111',
                  border: `2px solid ${isActive ? 'var(--accent)' : 'white'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 700, color: isActive ? 'var(--accent)' : 'white',
                  cursor: 'pointer', zIndex: 10, boxShadow: '0 2px 6px rgba(0,0,0,0.6)',
                }}
              >
                {idx}
              </button>
            )
          })}
        </div>

      </div>

      {/* ── Right: Comments ── */}
      <div style={{
        borderLeft: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        maxHeight: 600,
      }}>
        {/* Header */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
            {asset.name ?? `Creative ${index + 1}`}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {comments.length} comment{comments.length !== 1 ? 's' : ''}
            {status !== 'pending' && (
              <span style={{ marginLeft: 8, fontWeight: 600, color: statusColors[status].color }}>
                · {statusLabel(status)}
              </span>
            )}
          </div>
        </div>

        {/* Comment form */}
        <form onSubmit={handlePost} style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          {pendingPin ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{
                width: 20, height: 20, borderRadius: '50%',
                background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 9, fontWeight: 700, color: 'white', flexShrink: 0,
              }}>{pinnedComments.length + 1}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1 }}>Pinned</span>
              <button type="button" onClick={() => setPendingPin(null)} aria-label="Cancel pin" title="Cancel pin" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16, padding: 0 }}>×</button>
            </div>
          ) : null}
          <input
            type="text"
            placeholder="Your name (optional)"
            value={authorName}
            onChange={e => setAuthorName(e.target.value)}
            style={{ marginBottom: 6, fontSize: 12 }}
          />
          <textarea
            placeholder={pendingPin ? 'Comment on this spot…' : 'Leave feedback on this image…'}
            value={commentText}
            onChange={e => setCommentText(e.target.value)}
            rows={2}
            style={{ resize: 'none', fontSize: 12, marginBottom: 6 }}
          />
          <button
            type="submit"
            disabled={posting || !commentText.trim()}
            className="btn-primary"
            style={{ width: '100%', fontSize: 12, padding: '7px 12px' }}
          >
            {posting ? 'Posting…' : 'Post comment'}
          </button>
        </form>

        {/* Comment list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {comments.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginTop: 12 }}>No comments yet</p>
          )}
          {comments.map(c => {
            const isPinned = c.pin_x != null
            const pIdx = isPinned ? pinIndex(c) : null
            const isActive = activePin === c.id
            return (
              <div
                key={c.id}
                onClick={() => isPinned ? setActivePin(isActive ? null : c.id) : undefined}
                style={{
                  padding: '10px 12px', borderRadius: 8,
                  border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
                  background: isActive ? 'var(--accent-muted)' : 'var(--surface-raised)',
                  cursor: isPinned ? 'pointer' : 'default',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                  {isPinned ? (
                    <span style={{
                      width: 18, height: 18, borderRadius: '50%',
                      background: isActive ? 'var(--accent)' : '#333',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 8, fontWeight: 700, color: 'white', flexShrink: 0,
                    }}>{pIdx}</span>
                  ) : (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>💬</span>
                  )}
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>{c.author_name}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    {new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>{c.content}</p>
              </div>
            )
          })}
        </div>

        {/* Action bar — approve / needs revision / pin */}
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 8,
          padding: '12px 16px',
          borderTop: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {/* Approve */}
            <button
              onClick={() => handleStatus(status === 'approved' ? 'pending' : 'approved')}
              disabled={updatingStatus}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                padding: '8px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                cursor: updatingStatus ? 'wait' : 'pointer', transition: 'all 0.15s',
                border: `1px solid ${status === 'approved' ? 'rgba(34,197,94,0.5)' : 'var(--border)'}`,
                background: status === 'approved' ? 'rgba(34,197,94,0.12)' : 'var(--surface-raised)',
                color: status === 'approved' ? 'var(--success)' : 'var(--text-secondary)',
              }}
            >
              {updatingStatus ? 'Saving…' : <>✓ {status === 'approved' ? 'Approved' : 'Approve'}</>}
            </button>

            {/* Needs revision */}
            <button
              onClick={() => handleStatus(status === 'needs_revision' ? 'pending' : 'needs_revision')}
              disabled={updatingStatus}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                padding: '8px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                cursor: updatingStatus ? 'wait' : 'pointer', transition: 'all 0.15s',
                border: `1px solid ${status === 'needs_revision' ? 'rgba(239,68,68,0.4)' : 'var(--border)'}`,
                background: status === 'needs_revision' ? 'rgba(239,68,68,0.1)' : 'var(--surface-raised)',
                color: status === 'needs_revision' ? 'var(--danger)' : 'var(--text-secondary)',
              }}
            >
              {updatingStatus ? 'Saving…' : <>↩ {status === 'needs_revision' ? 'Revision requested' : 'Needs revision'}</>}
            </button>

            {/* Reject concept — stronger than "needs revision": scrap it entirely */}
            <button
              onClick={() => handleStatus(status === 'rejected' ? 'pending' : 'rejected')}
              disabled={updatingStatus}
              title="Scrap this concept entirely — different from 'needs revision'"
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                padding: '8px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                cursor: updatingStatus ? 'wait' : 'pointer', transition: 'all 0.15s',
                border: `1px solid ${status === 'rejected' ? 'rgba(127,29,29,0.6)' : 'var(--border)'}`,
                background: status === 'rejected' ? 'rgba(127,29,29,0.18)' : 'var(--surface-raised)',
                color: status === 'rejected' ? '#fca5a5' : 'var(--text-secondary)',
              }}
            >
              {updatingStatus ? 'Saving…' : <>✕ {status === 'rejected' ? 'Rejected' : 'Reject concept'}</>}
            </button>
          </div>

          {/* Pin toggle */}
          <button
            onClick={() => { setPinMode(m => !m); setPendingPin(null) }}
            style={{
              width: '100%', padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: 500,
              cursor: 'pointer', transition: 'all 0.15s',
              border: `1px solid ${pinMode ? 'var(--accent)' : 'var(--border)'}`,
              background: pinMode ? 'var(--accent-muted)' : 'var(--surface-raised)',
              color: pinMode ? 'var(--accent)' : 'var(--text-muted)',
            }}
          >
            📍 {pinMode ? 'Click on the image to drop a pin…' : 'Add pin comment'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main panel ──────────────────────────────────────────────────────────────

export default function ImageReviewPanel({
  token,
  assets,
  creativesApproved,
  initialComments,
}: {
  token: string
  assets: CreativeAsset[]
  creativesApproved: boolean
  initialComments: ProjectComment[]
}) {
  const [assetStatuses, setAssetStatuses] = useState<Record<string, CreativeAsset['status']>>(
    Object.fromEntries(assets.map(a => [a.id, a.status ?? 'pending']))
  )
  const [approving, setApproving] = useState(false)

  function handleStatusChange(assetId: string, status: CreativeAsset['status']) {
    setAssetStatuses(prev => ({ ...prev, [assetId]: status }))
  }

  async function handleApproveAll() {
    if (!confirm('Approve all creatives? This confirms you have reviewed them and are satisfied.')) return
    setApproving(true)
    try {
      await approveProject(token, 'creatives')
      // Refresh is handled server-side via revalidatePath
      window.location.reload()
    } finally {
      setApproving(false)
    }
  }

  const approvedCount = Object.values(assetStatuses).filter(s => s === 'approved').length
  const revisionCount = Object.values(assetStatuses).filter(s => s === 'needs_revision').length

  if (assets.length === 0) {
    return (
      <div className="card">
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Creatives coming soon — check back later.</p>
      </div>
    )
  }

  return (
    <div>
      {/* Summary + overall approval */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, padding: '14px 18px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
        <div style={{ flex: 1, display: 'flex', gap: 20 }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            <strong style={{ color: 'var(--text-primary)' }}>{assets.length}</strong> creatives
          </span>
          {approvedCount > 0 && (
            <span style={{ fontSize: 13, color: 'var(--success)' }}>✓ {approvedCount} approved</span>
          )}
          {revisionCount > 0 && (
            <span style={{ fontSize: 13, color: 'var(--danger)' }}>↩ {revisionCount} need revision</span>
          )}
        </div>
        {creativesApproved ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--success)' }}>
            ✓ All creatives approved
          </div>
        ) : (
          <button onClick={handleApproveAll} disabled={approving} className="btn-primary" style={{ fontSize: 13 }}>
            {approving ? 'Approving…' : '✓ Approve all creatives'}
          </button>
        )}
      </div>

      {/* Asset list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {assets.map((asset, i) => (
          <AssetRow
            key={asset.id}
            asset={{ ...asset, status: assetStatuses[asset.id] ?? 'pending' }}
            index={i}
            token={token}
            initialComments={initialComments.filter(c => c.asset_id === asset.id)}
            onStatusChange={handleStatusChange}
          />
        ))}
      </div>
    </div>
  )
}
