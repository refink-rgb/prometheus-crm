'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Creative } from '@/data/case-studies/types'

// A Netflix-style horizontal carousel of the ad examples we built. Purely
// illustrative — no per-ad metrics and no sort/filter control. Click a card to
// open a larger preview. `moreCount` (if > 0) adds a trailing "+ N more" card so
// readers know these are a sample of a larger test.
export default function CreativeGallery({
  creatives,
  moreCount = 0,
}: {
  creatives: Creative[]
  moreCount?: number
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const openCreative = creatives.find((c) => c.id === openId) ?? null

  return (
    <section aria-label="Creative gallery" style={{ padding: '24px 0 72px' }}>
      <div className="pe-container">
        <p className="pe-eyebrow" style={{ marginBottom: 10 }}>
          The creative we built
        </p>
        <h2
          style={{
            fontSize: 'clamp(24px, 3.4vw, 34px)',
            fontWeight: 600,
            letterSpacing: '-0.02em',
            margin: '0 0 28px',
            color: 'var(--pe-white)',
          }}
        >
          A look at the ads we built
        </h2>
      </div>

      {creatives.length === 0 ? (
        <div className="pe-container">
          <div className="pe-card" style={{ padding: 40, textAlign: 'center', color: 'var(--pe-muted)' }}>
            Creative examples coming soon.
          </div>
        </div>
      ) : (
        // Horizontal scroller. Edge padding matches the container so the first
        // card lines up with the rest of the page but cards can scroll past the
        // viewport edges like a Netflix row.
        <div
          role="list"
          aria-label="Ad examples"
          className="pe-carousel"
          style={{
            display: 'flex',
            gap: 18,
            overflowX: 'auto',
            scrollSnapType: 'x mandatory',
            padding: '4px max(24px, calc((100% - 1180px) / 2 + 24px)) 16px',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {creatives.map((c) => (
            <CreativeCard key={c.id} creative={c} onOpen={() => setOpenId(c.id)} />
          ))}
          {moreCount > 0 && <MoreCard count={moreCount} />}
        </div>
      )}

      {openCreative && <CreativeLightbox creative={openCreative} onClose={() => setOpenId(null)} />}

      <style
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html:
            '.pe-carousel::-webkit-scrollbar{height:8px}.pe-carousel::-webkit-scrollbar-thumb{background:var(--pe-border);border-radius:100px}',
        }}
      />
    </section>
  )
}

// ─── Card ────────────────────────────────────────────────────────────────────

function CreativeCard({ creative, onOpen }: { creative: Creative; onOpen: () => void }) {
  return (
    <div
      role="listitem"
      className="pe-card pe-card-sm"
      style={{
        flex: '0 0 clamp(220px, 66vw, 288px)',
        scrollSnapAlign: 'start',
        display: 'flex',
        flexDirection: 'column',
        cursor: 'pointer',
        overflow: 'hidden',
      }}
      tabIndex={0}
      aria-label={`${creative.label} — view larger`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
    >
      <CreativeMediaPreview creative={creative} />
      <div style={{ padding: 16 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--pe-white)' }}>{creative.label}</span>
      </div>
    </div>
  )
}

// Trailing "+ N more" card — signals the shown creatives are a sample.
function MoreCard({ count }: { count: number }) {
  return (
    <div
      aria-label={`Plus ${count} more ads in this test`}
      className="pe-card pe-card-sm"
      style={{
        flex: '0 0 clamp(180px, 50vw, 220px)',
        scrollSnapAlign: 'start',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        textAlign: 'center',
        padding: 24,
        border: '1px dashed var(--pe-border)',
        background: 'transparent',
      }}
    >
      <span style={{ fontSize: 'clamp(28px, 5vw, 40px)', fontWeight: 600, letterSpacing: '-0.03em', color: 'var(--pe-lime)' }}>
        +{count}
      </span>
      <span style={{ fontSize: 13, color: 'var(--pe-muted)' }}>more ads in this test</span>
    </div>
  )
}

// ─── Media preview (hover desktop / tap mobile, lazy, reduced-motion aware) ───

function CreativeMediaPreview({ creative }: { creative: Creative }) {
  const { media } = creative
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const hasVideo = media.kind === 'video' && Boolean(media.video)
  const posterSrc = media.poster.src

  const reducedMotion = () =>
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  const play = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    v.play().then(() => setPlaying(true)).catch(() => {})
  }, [])
  const stop = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    v.pause()
    v.currentTime = 0
    setPlaying(false)
  }, [])

  return (
    <div
      style={{
        position: 'relative',
        aspectRatio: '4 / 5',
        background: 'linear-gradient(160deg, #143349, #0F2536)',
        overflow: 'hidden',
      }}
      onPointerEnter={(e) => {
        if (hasVideo && e.pointerType === 'mouse' && !reducedMotion()) play()
      }}
      onPointerLeave={(e) => {
        if (hasVideo && e.pointerType === 'mouse') stop()
      }}
    >
      {hasVideo ? (
        <video
          ref={videoRef}
          src={media.video ?? undefined}
          poster={posterSrc ?? undefined}
          muted
          loop
          playsInline
          preload="none"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : posterSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={posterSrc}
          alt={media.poster.alt}
          loading="lazy"
          decoding="async"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <PlaceholderArt kind={media.kind} label={creative.label} />
      )}

      {hasVideo && (
        <button
          type="button"
          aria-label={playing ? 'Pause preview' : 'Play preview'}
          onClick={(e) => {
            e.stopPropagation()
            playing ? stop() : play()
          }}
          className="focus-ring-pill"
          style={{
            position: 'absolute',
            bottom: 10,
            right: 10,
            width: 34,
            height: 34,
            borderRadius: 100,
            border: 'none',
            background: 'rgba(12,30,45,0.7)',
            color: 'var(--pe-white)',
            cursor: 'pointer',
            fontSize: 14,
          }}
        >
          {playing ? '❚❚' : '▶'}
        </button>
      )}
    </div>
  )
}

// Neutral placeholder — carries no brand art. Shown when no image is provided.
function PlaceholderArt({ kind, label }: { kind: string; label: string }) {
  return (
    <div
      aria-hidden
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        color: 'var(--pe-muted)',
      }}
    >
      <span style={{ fontSize: 26, opacity: 0.5 }}>{kind === 'video' ? '►' : '▧'}</span>
      <span style={{ fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{label}</span>
    </div>
  )
}

// ─── Lightbox (keyboard accessible, no metrics) ──────────────────────────────

function CreativeLightbox({ creative, onClose }: { creative: Creative; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    panelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  const src = creative.media.poster.src

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(6,16,24,0.82)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={creative.label}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          maxWidth: 'min(560px, 100%)',
          maxHeight: '90vh',
          outline: 'none',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 14,
        }}
      >
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="focus-ring-pill"
          style={{
            position: 'absolute',
            top: -14,
            right: -14,
            width: 36,
            height: 36,
            borderRadius: 100,
            border: '1px solid var(--pe-border)',
            background: 'var(--pe-navy)',
            color: 'var(--pe-off)',
            cursor: 'pointer',
            fontSize: 16,
            zIndex: 1,
          }}
        >
          ✕
        </button>

        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={creative.media.poster.alt}
            style={{
              maxWidth: '100%',
              maxHeight: '82vh',
              width: 'auto',
              height: 'auto',
              borderRadius: 16,
              display: 'block',
            }}
          />
        ) : (
          <div style={{ width: 360, aspectRatio: '4 / 5', borderRadius: 16, overflow: 'hidden' }}>
            <PlaceholderArt kind={creative.media.kind} label={creative.label} />
          </div>
        )}

        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--pe-white)' }}>{creative.label}</span>
      </div>
    </div>
  )
}
