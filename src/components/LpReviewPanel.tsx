'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
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
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const [comments, setComments] = useState<ProjectComment[]>(initialComments)
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [pinMode, setPinMode] = useState(false)
  const [pendingPin, setPendingPin] = useState<{ x: number; y: number } | null>(null)
  const [activePin, setActivePin] = useState<string | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'error'>(
    lpUrl ? 'loading' : 'loaded'
  )

  const [authorName, setAuthorName] = useState('')
  const [commentText, setCommentText] = useState('')
  const [sectionTag, setSectionTag] = useState('General')
  const [posting, setPosting] = useState(false)
  const [approving, setApproving] = useState(false)

  // Same-origin proxy: fetches the live URL server-side, strips scripts/CSP,
  // fixes lazy-loaded images, and serves the cleaned HTML from our origin so
  // the iframe can't be blocked by X-Frame-Options / frame-ancestors.
  const previewSrc = lpUrl ? `/api/preview?token=${encodeURIComponent(token)}` : null

  // Headless fetch can take a while on slow/large pages; give the proxy room
  // before falling back. The proxy returns a friendly card on upstream
  // failure, so this timeout is just a network-stall safety net.
  useEffect(() => {
    if (!lpUrl || loadState !== 'loading') return
    const t = setTimeout(() => {
      setLoadState(prev => (prev === 'loading' ? 'error' : prev))
    }, 20_000)
    return () => clearTimeout(t)
  }, [lpUrl, loadState])

  const handleIframeLoad = useCallback(() => {
    // The proxy is same-origin, so we can read the doc directly. It injects a
    // <meta name="__preview_status"> marker — "ok" means real cleaned content,
    // "fallback" means upstream blocked/failed and the proxy returned an
    // error card. In the fallback case, surface our own polished error UI
    // instead of the embedded card.
    try {
      const doc = iframeRef.current?.contentDocument
      const status = doc
        ?.querySelector('meta[name="__preview_status"]')
        ?.getAttribute('content')
      if (status === 'fallback') {
        setLoadState('error')
        return
      }
    } catch {
      /* same-origin so this shouldn't throw; fall through to 'loaded' */
    }
    setLoadState('loaded')
  }, [])

  const handleIframeError = useCallback(() => {
    setLoadState('error')
  }, [])

  const pinnedComments = comments.filter(c => c.pin_x != null)
  const pinIndex = (c: ProjectComment) => pinnedComments.findIndex(p => p.id === c.id) + 1

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
      audience: 'client',
    }
    setComments(prev => [optimistic, ...prev])

    try {
      await addProjectComment(token, authorName.trim() || 'Anonymous', commentText.trim(), {
        track: 'lp',
        pin_x: pendingPin?.x,
        pin_y: pendingPin?.y,
        section_tag: pendingPin ? undefined : sectionTag,
      })
      setCommentText('')
      setPendingPin(null)
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

  async function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      const form = e.currentTarget.closest('form')
      if (form) form.requestSubmit()
    }
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 300px',
      height: 'calc(100vh - 100px)',
      minHeight: 600,
      border: '1px solid var(--border)',
      borderRadius: 12,
      overflow: 'hidden',
      background: 'var(--surface)',
    }}>

      {/* ══════════════════════════════════════════════════════════════
          LEFT: LP Preview
      ══════════════════════════════════════════════════════════════ */}
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#f5f5f5' }}>

        {/* Toolbar — matches Lucas's layout */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 14px',
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          {/* Device toggle — hidden when preview can't render */}
          {loadState !== 'error' && (
            <div style={{ display: 'flex', gap: 2, background: 'var(--surface-raised)', borderRadius: 7, padding: 2 }}>
              {(['desktop', 'mobile'] as const).map(d => (
                <button
                  key={d}
                  onClick={() => setDevice(d)}
                  style={{
                    padding: '4px 10px', borderRadius: 5, fontSize: 12, fontWeight: 500,
                    cursor: 'pointer', border: 'none',
                    background: device === d ? 'var(--surface)' : 'transparent',
                    color: device === d ? 'var(--text-primary)' : 'var(--text-muted)',
                    boxShadow: device === d ? '0 1px 3px rgba(0,0,0,0.15)' : 'none',
                  }}
                >
                  {d === 'desktop' ? '🖥 Desktop' : '📱 Mobile'}
                </button>
              ))}
            </div>
          )}

          <div style={{ flex: 1 }} />

          {/* Comment on the page — only available when the iframe is actually visible */}
          {lpUrl && !lpApproved && loadState === 'loaded' && (
            <button
              onClick={() => { setPinMode(m => !m); setPendingPin(null) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                cursor: 'pointer', transition: 'all 0.15s',
                border: `1px solid ${pinMode ? 'var(--accent)' : 'var(--border)'}`,
                background: pinMode ? 'var(--accent-muted)' : 'var(--surface-raised)',
                color: pinMode ? 'var(--accent)' : 'var(--text-secondary)',
              }}
            >
              📍 {pinMode ? 'Click on page to pin…' : 'Comment on page'}
            </button>
          )}

          {lpUrl && (
            <a
              href={lpUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 500,
                color: 'var(--text-secondary)', textDecoration: 'none',
                border: '1px solid var(--border)', background: 'var(--surface-raised)',
              }}
            >
              Open live page ↗
            </a>
          )}
        </div>

        {/* LP embed area */}
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative', background: lpUrl ? '#f5f5f5' : 'var(--surface)' }}>
          {lpUrl ? (
            loadState === 'error' ? (
              // Polished fallback — replaces the iframe entirely when the LP
              // refuses framing (or fails to load within the timeout window).
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                height: '100%', padding: '40px 24px', textAlign: 'center', gap: 16,
                background: '#f5f5f5',
              }}>
                <div style={{
                  width: 64, height: 64, borderRadius: '50%',
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 28,
                }}>
                  🔒
                </div>
                <div style={{ maxWidth: 420 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 8px' }}>
                    This page can&apos;t be previewed inline
                  </h3>
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
                    Many landing pages block embedding for security. Open it in a new tab to review —
                    your comments on the right will still save here.
                  </p>
                </div>
                <a
                  href={lpUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '10px 18px', borderRadius: 8,
                    fontSize: 13, fontWeight: 600,
                    background: 'var(--text-primary)', color: 'var(--background)',
                    textDecoration: 'none',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                  }}
                >
                  Open page in new tab ↗
                </a>
              </div>
            ) : (
              <>
                {/* Mobile wrapper */}
                <div style={{
                  width: device === 'mobile' ? 390 : '100%',
                  height: '100%',
                  margin: device === 'mobile' ? '0 auto' : '0',
                  position: 'relative',
                  overflow: 'hidden',
                }}>
                  <iframe
                    ref={iframeRef}
                    src={previewSrc ?? undefined}
                    onLoad={handleIframeLoad}
                    onError={handleIframeError}
                    style={{ width: '100%', height: '100%', border: 'none', display: 'block', background: '#f5f5f5' }}
                    title="Landing page preview"
                    sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                  />
                </div>

                {/* Loading overlay — covers the iframe so the broken-content flash is never visible */}
                {loadState === 'loading' && (
                  <div style={{
                    position: 'absolute', inset: 0, zIndex: 15,
                    background: '#f5f5f5',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexDirection: 'column', gap: 12,
                  }}>
                    <div style={{ position: 'relative', width: 140, height: 2, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                      <div className="tab-loading-bar" />
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>Loading preview…</p>
                  </div>
                )}

                {/* Pin overlay — only meaningful while the iframe is visible */}
                {loadState === 'loaded' && (
                  <div
                    ref={overlayRef}
                    onClick={handleOverlayClick}
                    style={{
                      position: 'absolute', inset: 0,
                      cursor: pinMode ? 'crosshair' : 'default',
                      pointerEvents: pinMode ? 'all' : 'none',
                      zIndex: 10,
                    }}
                  >
                    {/* Pending pin */}
                    {pendingPin && (
                      <div style={{
                        position: 'absolute',
                        left: `${pendingPin.x}%`, top: `${pendingPin.y}%`,
                        transform: 'translate(-50%, -50%)',
                        width: 28, height: 28, borderRadius: '50%',
                        background: '#111', border: '2px solid white',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 700, color: 'white',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.4)', zIndex: 20, pointerEvents: 'none',
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
                          style={{
                            position: 'absolute',
                            left: `${c.pin_x}%`, top: `${c.pin_y}%`,
                            transform: 'translate(-50%, -50%)',
                            width: 26, height: 26, borderRadius: '50%',
                            background: isActive ? 'white' : '#111',
                            border: `2px solid ${isActive ? '#f97316' : 'white'}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 10, fontWeight: 700,
                            color: isActive ? '#f97316' : 'white',
                            cursor: 'pointer', zIndex: 20,
                            boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
                            pointerEvents: 'all',
                          }}
                        >
                          {idx}
                        </button>
                      )
                    })}
                  </div>
                )}

                {/* Persistent escape hatch — catches the case where onLoad fires
                    but the iframe is silently blank (some browsers/embeds). */}
                {loadState === 'loaded' && (
                  <div style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0,
                    padding: '8px 14px',
                    background: 'rgba(0,0,0,0.6)',
                    display: 'flex', alignItems: 'center', gap: 8,
                    fontSize: 12, color: 'rgba(255,255,255,0.7)',
                    backdropFilter: 'blur(4px)',
                  }}>
                    <span>Page not visible?</span>
                    <a href={lpUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>
                      Open in new tab ↗
                    </a>
                  </div>
                )}
              </>
            )
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 32 }}>🔗</div>
              <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Landing page URL not set yet</p>
            </div>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          RIGHT: Feedback sidebar — matches Lucas's layout exactly
      ══════════════════════════════════════════════════════════════ */}
      <div style={{
        borderLeft: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        background: 'var(--surface)',
        overflow: 'hidden',
      }}>
        {/* Sidebar header */}
        <div style={{
          display: 'flex', alignItems: 'center',
          padding: '14px 16px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
            Feedback 💬
          </span>
          {comments.length > 0 && (
            <span style={{
              marginLeft: 8, fontSize: 12, color: 'var(--text-muted)',
              background: 'var(--surface-raised)', border: '1px solid var(--border)',
              borderRadius: 10, padding: '1px 7px',
            }}>
              {comments.length}
            </span>
          )}

          {/* Approve button in header */}
          {!lpApproved && lpUrl && (
            <button
              onClick={handleApprove}
              disabled={approving}
              style={{
                marginLeft: 'auto',
                padding: '5px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                cursor: 'pointer', border: '1px solid rgba(34,197,94,0.4)',
                background: 'rgba(34,197,94,0.1)', color: 'var(--success)',
              }}
            >
              {approving ? '…' : '✓ Approve'}
            </button>
          )}
          {lpApproved && (
            <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: 'var(--success)' }}>
              ✓ Approved
            </span>
          )}
        </div>

        {/* Comment form — FIRST (like Lucas's tool) */}
        <form onSubmit={handlePost} style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          {pendingPin ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{
                width: 22, height: 22, borderRadius: '50%',
                background: '#111', border: '2px solid var(--border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 9, fontWeight: 700, color: 'white', flexShrink: 0,
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
              style={{ width: '100%', marginBottom: 8, fontSize: 12 }}
            >
              {LP_SECTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}

          <input
            type="text"
            placeholder="Your name (optional)"
            value={authorName}
            onChange={e => setAuthorName(e.target.value)}
            style={{ marginBottom: 6, fontSize: 12 }}
          />
          <textarea
            placeholder={pendingPin
              ? 'What about this spot?'
              : 'Leave general feedback (or use "Comment on page" to pin to a specific spot)'}
            value={commentText}
            onChange={e => setCommentText(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={3}
            style={{ resize: 'none', fontSize: 12, marginBottom: 6 }}
          />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>⌘↵ to send</span>
            <button
              type="submit"
              disabled={posting || !commentText.trim()}
              style={{
                padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                cursor: posting || !commentText.trim() ? 'not-allowed' : 'pointer',
                border: 'none',
                background: posting || !commentText.trim() ? 'var(--border)' : 'var(--text-primary)',
                color: posting || !commentText.trim() ? 'var(--text-muted)' : 'var(--background)',
                transition: 'all 0.15s',
              }}
            >
              {posting ? 'Posting…' : 'Post comment'}
            </button>
          </div>
        </form>

        {/* Comment list — scrollable, below form */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {comments.length === 0 && (
            <div style={{ padding: '24px 16px', textAlign: 'center' }}>
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No comments yet</p>
            </div>
          )}
          {comments.map(c => {
            const isPinned = c.pin_x != null
            const pIdx = isPinned ? pinIndex(c) : null
            const isActive = activePin === c.id
            const sColor = (!isPinned && c.section_tag) ? (SECTION_COLORS[c.section_tag] ?? 'var(--text-muted)') : undefined

            return (
              <div
                key={c.id}
                onClick={() => isPinned ? setActivePin(isActive ? null : c.id) : undefined}
                style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--border)',
                  cursor: isPinned ? 'pointer' : 'default',
                  background: isActive ? 'rgba(249,115,22,0.05)' : 'transparent',
                  transition: 'background 0.1s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                  {isPinned ? (
                    <span style={{
                      width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                      background: isActive ? 'var(--accent)' : '#111',
                      border: `2px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9, fontWeight: 700, color: 'white',
                    }}>{pIdx}</span>
                  ) : (
                    <span style={{
                      width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                      background: 'var(--surface-raised)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12,
                    }}>💬</span>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{c.author_name}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                    {!isPinned && c.section_tag && c.section_tag !== 'General' && (
                      <span style={{
                        display: 'inline-block', marginBottom: 4,
                        fontSize: 10, fontWeight: 600, color: sColor,
                        background: `color-mix(in srgb, ${sColor} 15%, transparent)`,
                        border: `1px solid color-mix(in srgb, ${sColor} 30%, transparent)`,
                        borderRadius: 4, padding: '1px 6px',
                      }}>
                        {c.section_tag}
                      </span>
                    )}
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>
                      {c.content}
                    </p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
