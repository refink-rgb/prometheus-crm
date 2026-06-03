'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { addProjectComment, approveProject } from '@/lib/actions'
import type { CreativeAsset, ProjectComment } from '@/lib/types'

interface ImageLightboxProps {
  asset: CreativeAsset
  comments: ProjectComment[]
  token: string
  onClose: () => void
  onNewComment: (c: ProjectComment) => void
  globalIndex: number
}

function ImageLightbox({ asset, comments, token, onClose, onNewComment, globalIndex }: ImageLightboxProps) {
  const [pinMode, setPinMode] = useState(false)
  const [pendingPin, setPendingPin] = useState<{ x: number; y: number } | null>(null)
  const [activePin, setActivePin] = useState<string | null>(null)
  const [authorName, setAuthorName] = useState('')
  const [commentText, setCommentText] = useState('')
  const [posting, setPosting] = useState(false)

  const pinnedComments = comments.filter(c => c.pin_x != null)

  const handleImageClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!pinMode) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    setPendingPin({ x, y })
    setPinMode(false)
  }, [pinMode])

  const pinIndex = (c: ProjectComment) => pinnedComments.findIndex(p => p.id === c.id) + 1

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
    }
    onNewComment(optimistic)

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
      // Revert is handled by parent refresh
    } finally {
      setPosting(false)
    }
  }

  const fullUrl = `https://drive.google.com/uc?export=view&id=${asset.drive_file_id}`

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.85)',
      display: 'flex', alignItems: 'stretch',
    }}>
      {/* Image area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Toolbar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px',
          background: 'rgba(0,0,0,0.6)', flexShrink: 0,
        }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'white', fontSize: 18, cursor: 'pointer', padding: '4px 8px' }}>←</button>
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', flex: 1 }}>
            {asset.name ?? `Image ${globalIndex + 1}`}
          </span>
          <button
            onClick={() => setPinMode(m => !m)}
            style={{
              padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600,
              cursor: 'pointer', border: `1px solid ${pinMode ? 'var(--accent)' : 'rgba(255,255,255,0.2)'}`,
              background: pinMode ? 'var(--accent-muted)' : 'transparent',
              color: pinMode ? 'var(--accent)' : 'rgba(255,255,255,0.8)',
            }}
          >
            📍 {pinMode ? 'Click to pin…' : 'Add pin'}
          </button>
          <a
            href={fullUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', textDecoration: 'none' }}
          >
            Full size ↗
          </a>
        </div>

        {/* Image + overlay */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: 24 }}>
          <div
            style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', maxHeight: '100%' }}
            onClick={handleImageClick}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={asset.thumbnail_url ?? fullUrl}
              alt={asset.name ?? 'Creative asset'}
              style={{
                maxWidth: '100%', maxHeight: 'calc(100vh - 120px)',
                objectFit: 'contain', display: 'block',
                cursor: pinMode ? 'crosshair' : 'default',
                userSelect: 'none',
              }}
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
                  onClick={(e) => { e.stopPropagation(); setActivePin(isActive ? null : c.id) }}
                  style={{
                    position: 'absolute',
                    left: `${c.pin_x}%`, top: `${c.pin_y}%`,
                    transform: 'translate(-50%, -50%)',
                    width: 26, height: 26, borderRadius: '50%',
                    background: isActive ? 'white' : '#111',
                    border: `2px solid ${isActive ? 'var(--accent)' : 'white'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 700, color: isActive ? 'var(--accent)' : 'white',
                    cursor: 'pointer', zIndex: 10,
                    boxShadow: '0 2px 6px rgba(0,0,0,0.6)',
                  }}
                >
                  {idx}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Comment sidebar */}
      <div style={{
        width: 300, background: 'var(--surface)', borderLeft: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', flexShrink: 0,
      }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>
            Comments · {comments.length}
          </div>
        </div>

        {/* Comment form */}
        <form onSubmit={handlePost} style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          {pendingPin && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: 'white' }}>
                {pinnedComments.length + 1}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1 }}>Pinned to image</span>
              <button type="button" onClick={() => setPendingPin(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16, padding: 0 }}>×</button>
            </div>
          )}
          <input
            type="text"
            placeholder="Your name (optional)"
            value={authorName}
            onChange={e => setAuthorName(e.target.value)}
            style={{ marginBottom: 8, fontSize: 12 }}
          />
          <textarea
            placeholder={pendingPin ? 'What about this spot?' : 'Leave feedback on this image…'}
            value={commentText}
            onChange={e => setCommentText(e.target.value)}
            rows={3}
            style={{ resize: 'vertical', fontSize: 12, marginBottom: 8 }}
          />
          <button
            type="submit"
            disabled={posting || !commentText.trim()}
            className="btn-primary"
            style={{ width: '100%', fontSize: 12 }}
          >
            {posting ? 'Posting…' : 'Post comment'}
          </button>
        </form>

        {/* Comment list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {comments.length === 0 && <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginTop: 16 }}>No comments yet</p>}
          {[...comments].reverse().map(c => {
            const isPinned = c.pin_x != null
            const pIdx = isPinned ? pinIndex(c) : null
            const isHighlighted = activePin === c.id
            return (
              <div
                key={c.id}
                onClick={() => isPinned ? setActivePin(isHighlighted ? null : c.id) : undefined}
                style={{
                  padding: '10px 12px', borderRadius: 8, cursor: isPinned ? 'pointer' : 'default',
                  border: `1px solid ${isHighlighted ? 'var(--accent)' : 'var(--border)'}`,
                  background: isHighlighted ? 'var(--accent-muted)' : 'var(--surface-raised)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                  {isPinned && (
                    <span style={{ width: 18, height: 18, borderRadius: '50%', background: isHighlighted ? 'var(--accent)' : '#333', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700, color: 'white', flexShrink: 0 }}>
                      {pIdx}
                    </span>
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
      </div>
    </div>
  )
}

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
  const router = useRouter()
  const [activeAsset, setActiveAsset] = useState<CreativeAsset | null>(null)
  const [comments, setComments] = useState<ProjectComment[]>(initialComments)
  const [approving, setApproving] = useState(false)

  function handleNewComment(c: ProjectComment) {
    setComments(prev => [...prev, c])
  }

  async function handleApprove() {
    if (!confirm('Approve the Creatives? This confirms you have reviewed them and are satisfied.')) return
    setApproving(true)
    try {
      await approveProject(token, 'creatives')
      router.refresh()
    } finally {
      setApproving(false)
    }
  }

  if (assets.length === 0) {
    return (
      <div className="card">
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Creatives coming soon — check back later.</p>
      </div>
    )
  }

  const assetComments = (assetId: string) => comments.filter(c => c.asset_id === assetId)

  return (
    <>
      {activeAsset && (
        <ImageLightbox
          asset={activeAsset}
          comments={assetComments(activeAsset.id)}
          token={token}
          onClose={() => setActiveAsset(null)}
          onNewComment={handleNewComment}
          globalIndex={assets.findIndex(a => a.id === activeAsset.id)}
        />
      )}

      <div className="card">
        {/* Approve button or status */}
        <div style={{ marginBottom: 20 }}>
          {creativesApproved ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 8 }}>
              <span>✓</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--success)' }}>Creatives approved</span>
            </div>
          ) : (
            <button onClick={handleApprove} disabled={approving} className="btn-primary" style={{ fontSize: 14, padding: '10px 22px' }}>
              {approving ? 'Approving…' : '✓ Approve Creatives'}
            </button>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
          {assets.map((asset, i) => {
            const count = assetComments(asset.id).length
            return (
              <button
                key={asset.id}
                onClick={() => setActiveAsset(asset)}
                style={{
                  position: 'relative', background: 'none', border: '1px solid var(--border)',
                  borderRadius: 10, overflow: 'hidden', cursor: 'pointer', padding: 0,
                  transition: 'border-color 0.15s',
                }}
                className="asset-thumb"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={asset.thumbnail_url ?? `https://drive.google.com/thumbnail?id=${asset.drive_file_id}&sz=w400`}
                  alt={asset.name ?? `Creative ${i + 1}`}
                  style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }}
                />
                {count > 0 && (
                  <div style={{
                    position: 'absolute', top: 6, right: 6,
                    background: 'var(--accent)', color: 'white',
                    width: 20, height: 20, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 700,
                  }}>
                    {count}
                  </div>
                )}
              </button>
            )
          })}
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12 }}>
          {assets.length} creative{assets.length !== 1 ? 's' : ''} · Click any image to zoom and leave feedback
        </p>
      </div>
    </>
  )
}
