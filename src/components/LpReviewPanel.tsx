'use client'

import { useState, useRef, useCallback, useEffect, useMemo, cloneElement } from 'react'
import type { ReactElement, CSSProperties, UIEvent } from 'react'
import { useRouter } from 'next/navigation'
import { addProjectComment, approveProject, deleteProjectComment } from '@/lib/actions'
import { useConfirm } from '@/components/ConfirmDialog'
import { useToast } from '@/components/Toast'
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
  canDelete = false,
}: {
  token: string
  lpUrl: string | null
  lpApproved: boolean
  initialComments: ProjectComment[]
  canDelete?: boolean
}) {
  const router = useRouter()
  const confirm = useConfirm()
  const toast = useToast()
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const [comments, setComments] = useState<ProjectComment[]>(initialComments)
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'error'>(
    lpUrl ? 'loading' : 'loaded'
  )

  const [authorName, setAuthorName] = useState('')
  const [commentText, setCommentText] = useState('')
  const [sectionTag, setSectionTag] = useState('General')
  const [posting, setPosting] = useState(false)
  const [approving, setApproving] = useState(false)

  // Pin-a-comment: drop a numbered marker on a spot in the page, then attach the
  // comment to it. The iframe has an opaque origin, so a narrow postMessage
  // bridge exchanges only pin coordinates and state with the untrusted page.
  const [pinMode, setPinMode] = useState(false)

  // An iframe swallows the wheel. With the cursor over the preview, scrolling
  // the review page instead scrolls the landing page — the reviewer has to
  // wind the whole LP to its end before the page underneath moves at all, and
  // is left looking at its footer. So the frame stays inert until it is
  // clicked, and goes inert again when the pointer leaves.
  const [frameEngaged, setFrameEngaged] = useState(false)
  const frameInteractive = frameEngaged || pinMode
  const [pendingPin, setPendingPin] = useState<{ x: number; y: number } | null>(null)
  const [activePin, setActivePin] = useState<string | null>(null)
  const commentRefs = useRef<Record<string, HTMLDivElement | null>>({})

  // Oldest-first so a pin's number never changes as newer pins are added.
  const pinnedOrdered = useMemo(
    () => comments
      .filter(c => c.pin_x != null)
      .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [comments],
  )
  const pinNumber = (id: string) => pinnedOrdered.findIndex(p => p.id === id) + 1

  // The proxy fetches the live URL server-side and serves it inside an opaque,
  // script-capable sandbox. That bypasses frame headers without giving the
  // landing page Prometheus's origin or credentials.
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

  // Measure the preview area so we can render the LP at a real device viewport
  // (1440 desktop / 390 mobile) and CSS-scale it to fit. Without this the iframe
  // renders at the panel's own narrow width and the LP shows its mobile layout
  // even in "desktop" mode.
  const embedRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = embedRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const r = entries[0].contentRect
      setBox({ w: r.width, h: r.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const postToPreview = useCallback((message: Record<string, unknown>) => {
    iframeRef.current?.contentWindow?.postMessage({
      channel: 'prometheus-lp-preview-v1',
      ...message,
    }, '*')
  }, [])

  const handleIframeLoad = useCallback(() => {
    setLoadState('loaded')
    postToPreview({ type: 'ping' })
  }, [postToPreview])

  const handleIframeError = useCallback(() => {
    setLoadState('error')
  }, [])

  // Click a page pin (or its sidebar card) → select it and reveal the matching
  // comment.
  const handlePinClick = useCallback((id: string) => {
    setActivePin(prev => (prev === id ? null : id))
    commentRefs.current[id]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [])

  // Sync parent-owned pin state into the sandboxed document. Only coordinates,
  // ordering, and selection state cross the boundary.
  useEffect(() => {
    if (loadState !== 'loaded') return
    const markers = pinnedOrdered.map((comment, index) => ({
      number: index + 1,
      x: comment.pin_x,
      y: comment.pin_y,
      active: activePin === comment.id,
      pending: false,
    }))
    if (pendingPin) {
      markers.push({
        number: pinnedOrdered.length + 1,
        x: pendingPin.x,
        y: pendingPin.y,
        active: true,
        pending: true,
      })
    }
    postToPreview({ type: 'markers', markers })
  }, [activePin, loadState, pendingPin, pinnedOrdered, postToPreview, device])

  useEffect(() => {
    if (loadState !== 'loaded') return
    postToPreview({ type: 'pin-mode', enabled: pinMode })
  }, [loadState, pinMode, postToPreview])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return
      const data = event.data as {
        channel?: string
        type?: string
        status?: string
        number?: number
        x?: number
        y?: number
      }
      if (data?.channel !== 'prometheus-lp-preview-v1') return

      if (data.type === 'status') {
        setLoadState(data.status === 'fallback' ? 'error' : 'loaded')
      } else if (
        data.type === 'pin-selected' &&
        typeof data.x === 'number' &&
        typeof data.y === 'number'
      ) {
        setPendingPin({
          x: Math.min(100, Math.max(0, data.x)),
          y: Math.min(100, Math.max(0, data.y)),
        })
        setPinMode(false)
      } else if (data.type === 'pin-activated' && typeof data.number === 'number') {
        const comment = pinnedOrdered[data.number - 1]
        if (comment) handlePinClick(comment.id)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [handlePinClick, pinnedOrdered])

  async function handlePost(e: React.FormEvent) {
    e.preventDefault()
    if (!commentText.trim()) return
    setPosting(true)

    const pin = pendingPin
    const optimistic: ProjectComment = {
      id: `temp-${Date.now()}`,
      project_id: '',
      author_name: authorName.trim() || 'Anonymous',
      content: commentText.trim(),
      created_at: new Date().toISOString(),
      track: 'lp',
      asset_id: null,
      pin_x: pin?.x ?? null,
      pin_y: pin?.y ?? null,
      section_tag: sectionTag,
      audience: 'client',
      attachment_urls: null,
    }
    setComments(prev => [optimistic, ...prev])

    try {
      await addProjectComment(token, authorName.trim() || 'Anonymous', commentText.trim(), {
        track: 'lp',
        section_tag: sectionTag,
        pin_x: pin?.x,
        pin_y: pin?.y,
      })
      setCommentText('')
      setPendingPin(null)
    } catch {
      setComments(prev => prev.filter(c => c.id !== optimistic.id))
      toast.error("Couldn't post your comment. Please try again.")
    } finally {
      setPosting(false)
    }
  }

  async function handleDelete(id: string) {
    if (id.startsWith('temp-')) return
    const ok = await confirm({
      title: 'Delete comment',
      message: 'Delete this comment? This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    const prev = comments
    setComments(cs => cs.filter(c => c.id !== id))
    try {
      await deleteProjectComment(id, token)
    } catch {
      setComments(prev)
      toast.error("Couldn't delete the comment. Please try again.")
    }
  }

  async function handleApprove() {
    const ok = await confirm({
      title: 'Approve landing page',
      message: 'This confirms you have reviewed the landing page and are satisfied.',
      confirmLabel: 'Approve',
    })
    if (!ok) return
    setApproving(true)
    try {
      await approveProject(token, 'lp')
      toast.success('Landing page approved — thank you!')
      router.refresh()
    } catch {
      toast.error("Couldn't approve the landing page. Please try again.")
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
      overflow: 'clip',
      background: 'var(--surface)',
    }}>

      {/* ══════════════════════════════════════════════════════════════
          LEFT: LP Preview
      ══════════════════════════════════════════════════════════════ */}
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'clip', background: 'var(--surface-2)' }}>

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

          {/* Pin a comment — arm, then click a spot on the page */}
          {loadState === 'loaded' && (
            <button
              onClick={() => { setPinMode(m => !m); setPendingPin(null) }}
              title="Drop a pin on the page, then write your comment"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '5px 10px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                cursor: 'pointer',
                border: `1px solid ${pinMode ? 'var(--accent)' : 'var(--border)'}`,
                background: pinMode ? 'var(--accent-muted)' : 'var(--surface-raised)',
                color: pinMode ? 'var(--accent)' : 'var(--text-secondary)',
              }}
            >
              📍 {pinMode ? 'Click a spot on the page…' : 'Pin a comment'}
            </button>
          )}

          <div style={{ flex: 1 }} />

          {lpUrl && (
            <a
              href={lpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary btn-sm"
              style={{ background: 'var(--surface-raised)' }}
            >
              Open live page ↗
            </a>
          )}
        </div>

        {/* LP embed area */}
        <div
          ref={embedRef}
          onMouseLeave={() => setFrameEngaged(false)}
          style={{ flex: 1, overflow: 'clip', position: 'relative', background: lpUrl ? 'var(--surface-2)' : 'var(--surface)' }}
        >
          {lpUrl ? (
            loadState === 'error' ? (
              // Polished fallback — replaces the iframe entirely when the LP
              // refuses framing (or fails to load within the timeout window).
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                height: '100%', padding: 'var(--space-10) var(--space-6)', textAlign: 'center', gap: 'var(--space-4)',
                background: 'var(--surface-2)',
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
                  className="btn-primary"
                >
                  Open page in new tab ↗
                </a>
              </div>
            ) : (
              <>
                {/* Device frame — renders the LP at a true device viewport
                    (1440 desktop / 390 mobile) and CSS-scales it to fit, so
                    "desktop" triggers the LP's desktop breakpoints and "mobile"
                    reads as a real phone. The single iframe stays mounted across
                    device switches (no reload); only its size/scale change. */}
                <DeviceFrame device={device} box={box} url={lpUrl}>
                  <iframe
                    ref={iframeRef}
                    src={previewSrc ?? undefined}
                    onLoad={handleIframeLoad}
                    onError={handleIframeError}
                    // Stays white regardless of theme: this hosts the client's own
                    // page, authored against a browser's white viewport default. A
                    // themed background would show through any LP that doesn't set
                    // its own and leave dark text on dark.
                    style={{
                      border: 'none', display: 'block', background: '#ffffff',
                      // Inert until engaged, so the wheel reaches the review page.
                      pointerEvents: frameInteractive ? 'auto' : 'none',
                    }}
                    title="Landing page preview"
                    sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
                    referrerPolicy="no-referrer"
                  />
                </DeviceFrame>

                {/* Click-to-engage. Transparent, so the preview stays fully
                    visible; the wheel passes straight through it to the review
                    page until the reviewer clicks in. */}
                {loadState === 'loaded' && !frameInteractive && (
                  <div
                    onClick={() => setFrameEngaged(true)}
                    title="Click to scroll and interact with the page"
                    style={{
                      position: 'absolute', inset: 0, zIndex: 10,
                      cursor: 'pointer', background: 'transparent',
                    }}
                  >
                    <span style={{
                      position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
                      padding: '5px 11px', borderRadius: 999,
                      background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(4px)',
                      color: 'rgba(255,255,255,0.92)', fontSize: 11, fontWeight: 600,
                      whiteSpace: 'nowrap', pointerEvents: 'none',
                    }}>
                      Click to interact
                    </span>
                  </div>
                )}

                {/* Loading overlay — covers the iframe so the broken-content flash is never visible */}
                {loadState === 'loading' && (
                  <div style={{
                    position: 'absolute', inset: 0, zIndex: 15,
                    background: 'var(--surface-2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexDirection: 'column', gap: 'var(--space-3)',
                  }}>
                    <div style={{ position: 'relative', width: 140, height: 2, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                      <div className="tab-loading-bar" />
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>Loading preview…</p>
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
                    <span>Something not working?</span>
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
              className="btn-secondary btn-sm"
              style={{
                marginLeft: 'auto',
                borderColor: 'color-mix(in srgb, var(--success) 40%, transparent)',
                background: 'color-mix(in srgb, var(--success) 10%, transparent)',
                color: 'var(--success)',
              }}
            >
              {approving ? '…' : '✓ Approve'}
            </button>
          )}
          {lpApproved && (
            <span className="badge badge-done" style={{ marginLeft: 'auto' }}>
              ✓ Approved
            </span>
          )}
        </div>

        {/* Comment form — FIRST (like Lucas's tool) */}
        <form onSubmit={handlePost} style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          {pendingPin && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
              padding: '6px 8px', borderRadius: 6,
              background: 'var(--accent-muted)',
              border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
            }}>
              <span style={{
                width: 18, height: 18, borderRadius: '50%', background: 'var(--accent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 700, color: 'white', flexShrink: 0,
              }}>{pinnedOrdered.length + 1}</span>
              <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600, flex: 1 }}>Pinned to the page</span>
              <button type="button" onClick={() => setPendingPin(null)} aria-label="Remove pin" title="Remove pin"
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 15, padding: 0, lineHeight: 1 }}>×</button>
            </div>
          )}
          <select
            value={sectionTag}
            onChange={e => setSectionTag(e.target.value)}
            style={{ width: '100%', marginBottom: 8, fontSize: 12 }}
          >
            {LP_SECTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <input
            type="text"
            placeholder="Your name (optional)"
            value={authorName}
            onChange={e => setAuthorName(e.target.value)}
            style={{ marginBottom: 6, fontSize: 12 }}
          />
          <textarea
            placeholder="Leave feedback on the landing page"
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
              className="btn-primary btn-sm"
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
            const sColor = c.section_tag ? (SECTION_COLORS[c.section_tag] ?? 'var(--text-muted)') : undefined
            const isPinned = c.pin_x != null
            const pIdx = isPinned ? pinNumber(c.id) : null
            const isActive = activePin === c.id

            return (
              <div
                key={c.id}
                ref={el => { commentRefs.current[c.id] = el }}
                onClick={isPinned ? () => handlePinClick(c.id) : undefined}
                style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--border)',
                  cursor: isPinned ? 'pointer' : 'default',
                  background: isActive ? 'var(--accent-muted)' : undefined,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                  {isPinned ? (
                    <span style={{
                      width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                      background: isActive ? 'var(--accent)' : '#6366f1',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 700, color: 'white',
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
                      {canDelete && (
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); handleDelete(c.id) }}
                          aria-label="Delete comment"
                          title="Delete comment"
                          style={{
                            marginLeft: 'auto', background: 'none', border: 'none',
                            color: 'var(--text-muted)', cursor: 'pointer',
                            fontSize: 14, padding: '0 4px', lineHeight: 1,
                          }}
                        >
                          ×
                        </button>
                      )}
                    </div>
                    {c.section_tag && c.section_tag !== 'General' && (
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

// ─── Device frame ─────────────────────────────────────────────────────────────
// Renders its single iframe child at a true device viewport and CSS-scales it to
// fit the measured area. Desktop = 1440px in a browser-chrome window; mobile =
// 390×844 in a phone bezel. The child iframe keeps its ref (cloneElement only
// merges style), so it never remounts when the device toggles.
//
// Every box around the iframe uses `overflow: clip`, not `hidden`. A transform
// changes how the iframe is painted, not its layout box: the element is still
// 1440×N logical pixels tall, so a `hidden` wrapper sized to the scaled height
// has hundreds of pixels of scrollable overflow. `hidden` boxes can't be
// scrolled by the reviewer, but scripts can scroll them — and when the landing
// page scrolled one of its own elements into view (a footer signup form taking
// focus, a chat widget, an anchor), Chrome carried the leftover scroll out of
// the frame and into this wrapper. That shifted the iframe up inside the box,
// leaving a short strip of page over a blank white area; the bridge's hold-top
// then reset the page's own scroll, but not the wrapper's. `clip` forbids all
// scrolling, programmatic included. The onScroll reset covers browsers that
// still treat clip as hidden.
const keepUnscrolled = (event: UIEvent<HTMLDivElement>) => {
  event.currentTarget.scrollTop = 0
  event.currentTarget.scrollLeft = 0
}

function DeviceFrame({
  device,
  box,
  url,
  children,
}: {
  device: 'desktop' | 'mobile'
  box: { w: number; h: number }
  url: string | null
  children: ReactElement<{ style?: CSSProperties }>
}) {
  // Before the ResizeObserver reports a size, render nothing — the loading
  // overlay covers this area until the first measurement lands.
  if (box.w < 2 || box.h < 2) return <div style={{ width: '100%', height: '100%' }} />

  const baseStyle = children.props.style ?? {}

  if (device === 'mobile') {
    const LOGICAL_W = 390
    const LOGICAL_H = 844
    const BEZEL = 12
    const PAD = 20
    const scale = Math.min(
      1,
      (box.w - PAD * 2 - BEZEL * 2) / LOGICAL_W,
      (box.h - PAD * 2 - BEZEL * 2) / LOGICAL_H,
    )
    const screenW = LOGICAL_W * scale
    const screenH = LOGICAL_H * scale
    const child = cloneElement(children, {
      style: { ...baseStyle, width: LOGICAL_W, height: LOGICAL_H, transform: `scale(${scale})`, transformOrigin: 'top left' },
    })
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: PAD }}>
        <div style={{
          padding: BEZEL,
          borderRadius: 44 * scale + BEZEL,
          background: '#0b0b0d',
          boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
        }}>
          <div onScroll={keepUnscrolled} style={{ position: 'relative', width: screenW, height: screenH, borderRadius: 40 * scale, overflow: 'clip', background: '#fff' }}>
            {child}
            {/* Notch */}
            <div style={{
              position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
              width: 130 * scale, height: 24 * scale,
              background: '#0b0b0d', borderRadius: `0 0 ${16 * scale}px ${16 * scale}px`,
              pointerEvents: 'none',
            }} />
          </div>
        </div>
      </div>
    )
  }

  // Desktop
  const LOGICAL_W = 1440
  const CHROME_H = 34
  const PAD = 16
  const scale = Math.min(1, (box.w - PAD * 2) / LOGICAL_W)
  const frameW = LOGICAL_W * scale
  const viewportH = Math.max(0, box.h - PAD * 2 - CHROME_H)
  const iframeLogicalH = scale > 0 ? viewportH / scale : viewportH
  const child = cloneElement(children, {
    style: { ...baseStyle, width: LOGICAL_W, height: iframeLogicalH, transform: `scale(${scale})`, transformOrigin: 'top left' },
  })
  let host = ''
  try { host = url ? new URL(url).host : '' } catch { host = url ?? '' }
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: PAD }}>
      <div onScroll={keepUnscrolled} style={{ width: frameW, borderRadius: 10, overflow: 'clip', border: '1px solid var(--border)', boxShadow: '0 16px 48px rgba(0,0,0,0.4)', background: '#fff' }}>
        {/* Browser chrome */}
        <div style={{ height: CHROME_H, background: 'var(--surface-raised)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5f57' }} />
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#febc2e' }} />
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#28c840' }} />
          </div>
          {host && (
            <div style={{
              flex: 1, height: 20, borderRadius: 5, background: 'var(--surface-2)',
              display: 'flex', alignItems: 'center', padding: '0 10px',
              fontSize: 11, color: 'var(--text-muted)', maxWidth: 420,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {host}
            </div>
          )}
        </div>
        <div onScroll={keepUnscrolled} style={{ width: frameW, height: viewportH, overflow: 'clip', background: '#fff' }}>
          {child}
        </div>
      </div>
    </div>
  )
}
