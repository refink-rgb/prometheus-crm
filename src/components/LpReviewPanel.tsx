'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { addProjectComment, approveProject } from '@/lib/actions'
import { LP_SECTIONS } from '@/lib/types'
import type { ProjectComment } from '@/lib/types'

const SECTION_COLORS: Record<string, string> = {
  'Hero': '#818cf8',
  'Offer Details': 'var(--accent)',
  'Product Features': '#34d399',
  'Social Proof / Reviews': '#60a5fa',
  'Pricing': '#f472b6',
  'CTA': '#fb923c',
  'Footer': 'var(--text-muted)',
  'General': 'var(--text-muted)',
}

export default function LpReviewPanel({
  token,
  lpUrl,
  lpApproved,
  initialComments,
}: {
  token: string
  lpUrl: string | null
  lpApproved: boolean
  initialComments: ProjectComment[]
}) {
  const router = useRouter()
  const overlayRef = useRef<HTMLDivElement>(null)
  const iframeContainerRef = useRef<HTMLDivElement>(null)

  const [comments, setComments] = useState<ProjectComment[]>(initialComments)
  const [pinMode, setPinMode] = useState(false)
  const [pendingPin, setPendingPin] = useState<{ x: number; y: number } | null>(null)
  const [activePin, setActivePin] = useState<string | null>(null)

  const [authorName, setAuthorName] = useState('')
  const [commentText, setCommentText] = useState('')
  const [sectionTag, setSectionTag] = useState<string>('General')
  const [posting, setPosting] = useState(false)
  const [approving, setApproving] = useState(false)
  const [iframeError, setIframeError] = useState(false)

  const pinnedComments = comments.filter(c => c.pin_x != null)
  const unpinnedComments = comments.filter(c => c.pin_x == null)

  const handleOverlayClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
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
      track: 'lp',
      asset_id: null,
      pin_x: pendingPin?.x ?? null,
      pin_y: pendingPin?.y ?? null,
      section_tag: pendingPin ? null : sectionTag,
    }
    setComments(prev => [...prev, optimistic])

    try {
      await addProjectComment(token, authorName.trim() || 'Anonymous', commentText.trim(), {
        track: 'lp',
        pin_x: pendingPin?.x,
        pin_y: pendingPin?.y,
        section_tag: pendingPin ? undefined : sectionTag,
      })
      setCommentText('')
      setPendingPin(null)
      router.refresh()
    } catch {
      setComments(prev => prev.filter(c => c.id !== optimistic.id))
    } finally {
      setPosting(false)
    }
  }

  async function handleApprove() {
    if (!confirm('Approve the Landing Page? This confirms you have reviewed it and are satisfied.')) return
    setApproving(true)
    try {
      await approveProject(token, 'lp')
      router.refresh()
    } finally {
      setApproving(false)
    }
  }

  const pinIndex = (comment: ProjectComment) =>
    pinnedComments.findIndex(c => c.id === comment.id) + 1

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 0, border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', background: 'var(--surface)' }}>

      {/* ── Left: iframe preview ── */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>

        {/* Toolbar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px',
          borderBottom: '1px solid var(--border)', background: 'var(--surface-raised)',
          flexShrink: 0,
        }}>
          {lpUrl ? (
            <>
              {!lpApproved && (
                <button
                  onClick={() => setPinMode(m => !m)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                    cursor: 'pointer', transition: 'all 0.15s',
                    border: `1px solid ${pinMode ? 'var(--accent)' : 'var(--border)'}`,
                    background: pinMode ? 'var(--accent-muted)' : 'transparent',
                    color: pinMode ? 'var(--accent)' : 'var(--text-secondary)',
                  }}
                >
                  📍 {pinMode ? 'Click on page to pin…' : 'Add pin comment'}
                </button>
              )}
              <a
                href={lpUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--accent)', textDecoration: 'none' }}
              >
                Open in new tab ↗
              </a>
            </>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Landing page URL not set yet</span>
          )}
        </div>

        {/* iframe + overlay */}
        <div
          ref={iframeContainerRef}
          style={{ position: 'relative', flex: 1, minHeight: 560, background: '#111' }}
        >
          {lpUrl ? (
            <>
              <iframe
                src={lpUrl}
                style={{ width: '100%', height: '100%', border: 'none', display: 'block', minHeight: 560 }}
                title="Landing page preview"
                onError={() => setIframeError(true)}
              />
              {/* transparent overlay — blocks iframe interaction in pin mode */}
              <div
                ref={overlayRef}
                onClick={handleOverlayClick}
                style={{
                  position: 'absolute', inset: 0,
                  cursor: pinMode ? 'crosshair' : 'default',
                  pointerEvents: pinMode || pendingPin ? 'all' : 'none',
                  zIndex: 10,
                }}
              >
                {/* Pending pin (unposted) */}
                {pendingPin && (
                  <div style={{
                    position: 'absolute',
                    left: `${pendingPin.x}%`,
                    top: `${pendingPin.y}%`,
                    transform: 'translate(-50%, -50%)',
                    width: 28, height: 28, borderRadius: '50%',
                    background: 'var(--accent)', border: '2px solid white',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700, color: 'white',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                    zIndex: 20,
                  }}>
                    {pinnedComments.length + 1}
                  </div>
                )}
                {/* Existing pins */}
                {pinnedComments.map((c) => {
                  const idx = pinIndex(c)
                  const isActive = activePin === c.id
                  return (
                    <button
                      key={c.id}
                      onClick={(e) => { e.stopPropagation(); setActivePin(isActive ? null : c.id) }}
                      style={{
                        position: 'absolute',
                        left: `${c.pin_x}%`,
                        top: `${c.pin_y}%`,
                        transform: 'translate(-50%, -50%)',
                        width: 26, height: 26, borderRadius: '50%',
                        background: isActive ? 'white' : '#1a1a1a',
                        border: `2px solid ${isActive ? 'var(--accent)' : 'white'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 10, fontWeight: 700,
                        color: isActive ? 'var(--accent)' : 'white',
                        cursor: 'pointer', zIndex: 20,
                        boxShadow: '0 2px 6px rgba(0,0,0,0.5)',
                      }}
                    >
                      {idx}
                    </button>
                  )
                })}
              </div>
              {iframeError && (
                <div style={{
                  position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  background: 'var(--surface)', pointerEvents: 'none',
                }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>🚫</div>
                  <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>This page blocks previews.</p>
                  <a href={lpUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: 'var(--accent)', pointerEvents: 'all' }}>Open it directly ↗</a>
                </div>
              )}
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: 14 }}>
              Landing page coming soon
            </div>
          )}
        </div>
      </div>

      {/* ── Right: comment sidebar ── */}
      <div style={{
        borderLeft: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        height: '100%', maxHeight: 640, overflow: 'hidden',
      }}>
        {/* Approve / approved banner */}
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          {lpApproved ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 8 }}>
              <span>✓</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--success)' }}>Landing page approved</span>
            </div>
          ) : lpUrl ? (
            <button
              onClick={handleApprove}
              disabled={approving}
              className="btn-primary"
              style={{ width: '100%', fontSize: 13 }}
            >
              {approving ? 'Approving…' : '✓ Approve Landing Page'}
            </button>
          ) : null}
        </div>

        {/* Comment form */}
        {!lpApproved && (
          <form onSubmit={handlePost} style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            {/* Active pin indicator or section tag */}
            {pendingPin ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{
                  width: 22, height: 22, borderRadius: '50%',
                  background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 700, color: 'white', flexShrink: 0,
                }}>
                  {pinnedComments.length + 1}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1 }}>Pinned to page</span>
                <button type="button" onClick={() => setPendingPin(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16, padding: 0 }}>×</button>
              </div>
            ) : (
              <select
                value={sectionTag}
                onChange={e => setSectionTag(e.target.value)}
                style={{ width: '100%', marginBottom: 10, fontSize: 12 }}
              >
                {LP_SECTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
            <input
              type="text"
              placeholder="Your name (optional)"
              value={authorName}
              onChange={e => setAuthorName(e.target.value)}
              style={{ marginBottom: 8, fontSize: 12 }}
            />
            <textarea
              placeholder="Leave feedback…"
              value={commentText}
              onChange={e => setCommentText(e.target.value)}
              rows={3}
              style={{ resize: 'vertical', fontSize: 12, marginBottom: 8 }}
            />
            <button
              type="submit"
              disabled={posting || !commentText.trim()}
              className="btn-primary"
              style={{ width: '100%', fontSize: 12, padding: '8px 12px' }}
            >
              {posting ? 'Posting…' : 'Post comment'}
            </button>
          </form>
        )}

        {/* Comment list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {comments.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginTop: 20 }}>
              No comments yet
            </p>
          )}
          {[...comments].reverse().map((c) => {
            const isPinned = c.pin_x != null
            const pIdx = isPinned ? pinIndex(c) : null
            const isHighlighted = activePin === c.id
            const sColor = c.section_tag ? (SECTION_COLORS[c.section_tag] ?? 'var(--text-muted)') : 'var(--text-muted)'

            return (
              <div
                key={c.id}
                onClick={() => isPinned ? setActivePin(isHighlighted ? null : c.id) : undefined}
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: `1px solid ${isHighlighted ? 'var(--accent)' : 'var(--border)'}`,
                  background: isHighlighted ? 'var(--accent-muted)' : 'var(--surface-raised)',
                  cursor: isPinned ? 'pointer' : 'default',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  {isPinned ? (
                    <span style={{
                      width: 20, height: 20, borderRadius: '50%',
                      background: isHighlighted ? 'var(--accent)' : '#333',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9, fontWeight: 700, color: 'white', flexShrink: 0,
                    }}>
                      {pIdx}
                    </span>
                  ) : (
                    <span style={{
                      fontSize: 10, fontWeight: 600, color: sColor,
                      background: `color-mix(in srgb, ${sColor} 15%, transparent)`,
                      border: `1px solid color-mix(in srgb, ${sColor} 30%, transparent)`,
                      borderRadius: 4, padding: '1px 6px', flexShrink: 0,
                    }}>
                      {c.section_tag ?? 'General'}
                    </span>
                  )}
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.author_name}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>
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
