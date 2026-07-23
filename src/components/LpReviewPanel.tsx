'use client'

import { useState, useRef, useCallback, useEffect, cloneElement } from 'react'
import type { ReactElement, CSSProperties } from 'react'
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
      pin_x: null,
      pin_y: null,
      section_tag: sectionTag,
      audience: 'client',
      attachment_urls: null,
    }
    setComments(prev => [optimistic, ...prev])

    try {
      await addProjectComment(token, authorName.trim() || 'Anonymous', commentText.trim(), {
        track: 'lp',
        section_tag: sectionTag,
      })
      setCommentText('')
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
      overflow: 'hidden',
      background: 'var(--surface)',
    }}>

      {/* ══════════════════════════════════════════════════════════════
          LEFT: LP Preview
      ══════════════════════════════════════════════════════════════ */}
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--surface-2)' }}>

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
        <div ref={embedRef} style={{ flex: 1, overflow: 'hidden', position: 'relative', background: lpUrl ? 'var(--surface-2)' : 'var(--surface)' }}>
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
                    style={{ border: 'none', display: 'block', background: '#ffffff' }}
                    title="Landing page preview"
                    sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                  />
                </DeviceFrame>

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

            return (
              <div
                key={c.id}
                style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                  <span style={{
                    width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                    background: 'var(--surface-raised)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12,
                  }}>💬</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{c.author_name}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => handleDelete(c.id)}
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
          <div style={{ position: 'relative', width: screenW, height: screenH, borderRadius: 40 * scale, overflow: 'hidden', background: '#fff' }}>
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
      <div style={{ width: frameW, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)', boxShadow: '0 16px 48px rgba(0,0,0,0.4)', background: '#fff' }}>
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
        <div style={{ width: frameW, height: viewportH, overflow: 'hidden', background: '#fff' }}>
          {child}
        </div>
      </div>
    </div>
  )
}
