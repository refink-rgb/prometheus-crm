'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  Creative,
  CreativeBenchmark,
  CreativeSortKey,
} from '@/data/case-studies/types'
import { fmtInt, fmtPct, fmtRoas, fmtUsd, EMPTY } from './format'

// Internal spend derivation for the "spend" sort only (revenue / roas is an exact
// identity, not an invented metric); spend is never displayed as a stat.
function spendOf(c: Creative): number | null {
  const { revenue, roas } = c.metrics
  if (revenue == null || roas == null || roas === 0) return null
  return revenue / roas
}

const SORTS: { key: CreativeSortKey; label: string }[] = [
  { key: 'revenue', label: 'Revenue' },
  { key: 'roas', label: 'ROAS' },
  { key: 'uniqueOutboundCtr', label: 'CTR' },
  { key: 'spend', label: 'Spend' },
]

function sortValue(c: Creative, key: CreativeSortKey): number | null {
  switch (key) {
    case 'revenue':
      return c.metrics.revenue
    case 'roas':
      return c.metrics.roas
    case 'uniqueOutboundCtr':
      return c.metrics.uniqueOutboundCtr
    case 'spend':
      return spendOf(c)
  }
}

export default function CreativeGallery({
  creatives,
  benchmark,
  isFixture,
}: {
  creatives: Creative[]
  benchmark: CreativeBenchmark
  isFixture?: boolean
}) {
  const [sortKey, setSortKey] = useState<CreativeSortKey>('revenue')
  const [openId, setOpenId] = useState<string | null>(null)

  const sorted = useMemo(() => {
    return [...creatives].sort((a, b) => {
      const av = sortValue(a, sortKey)
      const bv = sortValue(b, sortKey)
      // Nulls always sort last regardless of direction.
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      return bv - av // descending — best first
    })
  }, [creatives, sortKey])

  const openCreative = creatives.find((c) => c.id === openId) ?? null

  return (
    <section aria-label="Creative gallery" style={{ padding: '24px 0 72px' }}>
      <div className="pe-container">
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
            marginBottom: 24,
          }}
        >
          <div>
            <p className="pe-eyebrow" style={{ marginBottom: 10 }}>
              The creative that drove it
            </p>
            <h2
              style={{
                fontSize: 'clamp(24px, 3.4vw, 34px)',
                fontWeight: 600,
                letterSpacing: '-0.02em',
                margin: 0,
                color: 'var(--pe-white)',
              }}
            >
              Every ad, measured against the account
            </h2>
          </div>

          {/* Sort control */}
          <div
            role="group"
            aria-label="Sort creatives"
            style={{
              display: 'inline-flex',
              gap: 4,
              padding: 4,
              borderRadius: 100,
              border: '1px solid var(--pe-border)',
              background: 'var(--pe-card)',
            }}
          >
            {SORTS.map((s) => {
              const active = s.key === sortKey
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setSortKey(s.key)}
                  aria-pressed={active}
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    padding: '7px 16px',
                    borderRadius: 100,
                    border: 'none',
                    cursor: 'pointer',
                    background: active ? 'var(--pe-lime)' : 'transparent',
                    color: active ? 'var(--pe-navy)' : 'var(--pe-off)',
                    transition: 'background .15s',
                  }}
                >
                  {s.label}
                </button>
              )
            })}
          </div>
        </div>

        {isFixture && (
          <p
            style={{
              fontSize: 12,
              color: 'var(--pe-muted)',
              margin: '0 0 20px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 100,
                background: 'var(--pe-teal)',
                display: 'inline-block',
              }}
            />
            Sample data — per-creative figures are placeholders pending the live export.
          </p>
        )}

        {creatives.length === 0 ? (
          <div className="pe-card" style={{ padding: 40, textAlign: 'center', color: 'var(--pe-muted)' }}>
            Creative data not available yet.
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
              gap: 18,
            }}
          >
            {sorted.map((c) => (
              <CreativeCard key={c.id} creative={c} benchmark={benchmark} onOpen={() => setOpenId(c.id)} />
            ))}
          </div>
        )}
      </div>

      {openCreative && (
        <CreativeDetailModal
          creative={openCreative}
          benchmark={benchmark}
          onClose={() => setOpenId(null)}
        />
      )}
    </section>
  )
}

// ─── Card ────────────────────────────────────────────────────────────────────

function CreativeCard({
  creative,
  benchmark,
  onOpen,
}: {
  creative: Creative
  benchmark: CreativeBenchmark
  onOpen: () => void
}) {
  const { metrics } = creative
  const beatsCtr =
    metrics.uniqueOutboundCtr != null &&
    benchmark.uniqueOutboundCtr != null &&
    metrics.uniqueOutboundCtr > benchmark.uniqueOutboundCtr

  return (
    <div
      className="pe-card pe-card-sm"
      style={{
        display: 'flex',
        flexDirection: 'column',
        cursor: 'pointer',
        position: 'relative',
        outline: creative.isTopPerformer ? '1px solid rgba(211,240,95,0.5)' : undefined,
      }}
      role="button"
      tabIndex={0}
      aria-label={`${creative.label} — view details`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
    >
      {creative.isTopPerformer && (
        <span
          className="pe-chip"
          style={{ position: 'absolute', top: 10, left: 10, zIndex: 2 }}
        >
          ★ Top performer
        </span>
      )}

      <CreativeMediaPreview creative={creative} />

      <div style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--pe-white)' }}>
            {creative.label}
          </span>
          {beatsCtr && (
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--pe-lime)' }}>▲ CTR</span>
          )}
        </div>

        {/* Compact metric row */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: 8,
            marginTop: 14,
          }}
        >
          <MiniMetric label="ROAS" value={fmtRoas(metrics.roas)} />
          <MiniMetric label="CTR" value={fmtPct(metrics.uniqueOutboundCtr)} />
          <MiniMetric label="Rev" value={fmtUsd(metrics.revenue, { decimals: 0 })} />
        </div>
      </div>
    </div>
  )
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--pe-muted)' }}>
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--pe-off)', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
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
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

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
      // Desktop hover — skipped under reduced-motion.
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

      {/* Explicit tap-to-play toggle for touch (also a mouse fallback). Stops
          propagation so it doesn't open the modal. Only meaningful with a video. */}
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

// Neutral placeholder — carries no brand art. Shown until redacted derivatives land.
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

// ─── Detail modal (keyboard accessible) ──────────────────────────────────────

function CreativeDetailModal({
  creative,
  benchmark,
  onClose,
}: {
  creative: Creative
  benchmark: CreativeBenchmark
  onClose: () => void
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const { metrics } = creative

  useEffect(() => {
    panelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  const rows: { label: string; value: string }[] = [
    { label: 'Impressions', value: fmtInt(metrics.impressions) },
    { label: 'CPM', value: fmtUsd(metrics.cpm) },
    { label: 'Unique outbound CTR', value: fmtPct(metrics.uniqueOutboundCtr) },
    { label: 'CPC', value: fmtUsd(metrics.cpc) },
    { label: 'Purchases', value: fmtInt(metrics.purchases) },
    { label: 'Revenue', value: fmtUsd(metrics.revenue) },
    { label: 'ROAS', value: fmtRoas(metrics.roas) },
    { label: 'Cost per purchase', value: fmtUsd(metrics.costPerPurchase) },
  ]

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(6,16,24,0.72)',
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
        aria-label={`${creative.label} metrics`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="pe-card"
        style={{
          width: 'min(760px, 100%)',
          maxHeight: '90vh',
          overflowY: 'auto',
          outline: 'none',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '18px 22px',
            borderBottom: '1px solid var(--pe-border)',
            background: 'var(--pe-card-2)',
            position: 'sticky',
            top: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h3 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: 'var(--pe-white)' }}>
              {creative.label}
            </h3>
            {creative.isTopPerformer && <span className="pe-chip">★ Top performer</span>}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="focus-ring-pill"
            style={{
              width: 34,
              height: 34,
              borderRadius: 100,
              border: '1px solid var(--pe-border)',
              background: 'transparent',
              color: 'var(--pe-off)',
              cursor: 'pointer',
              fontSize: 16,
            }}
          >
            ✕
          </button>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.1fr)',
            gap: 22,
            padding: 22,
          }}
          className="pe-modal-grid"
        >
          <div
            style={{
              aspectRatio: '4 / 5',
              borderRadius: 16,
              overflow: 'hidden',
              background: 'linear-gradient(160deg, #143349, #0F2536)',
            }}
          >
            {creative.media.poster.src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={creative.media.poster.src}
                alt={creative.media.poster.alt}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <PlaceholderArt kind={creative.media.kind} label={creative.label} />
            )}
          </div>

          <div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label} style={{ borderBottom: '1px solid var(--pe-border)' }}>
                    <td style={{ padding: '11px 0', fontSize: 14, color: 'var(--pe-muted)' }}>{r.label}</td>
                    <td
                      style={{
                        padding: '11px 0',
                        fontSize: 16,
                        fontWeight: 600,
                        color: 'var(--pe-off)',
                        textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {r.value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Against the account benchmark */}
            <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <BenchmarkRow
                label="CTR vs account"
                value={metrics.uniqueOutboundCtr}
                bench={benchmark.uniqueOutboundCtr}
                fmt={(n) => fmtPct(n)}
              />
              <BenchmarkRow
                label="ROAS vs account"
                value={metrics.roas}
                bench={benchmark.roas}
                fmt={(n) => fmtRoas(n)}
              />
            </div>
          </div>
        </div>
      </div>

      <style
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: `@media (max-width:640px){.pe-modal-grid{grid-template-columns:1fr !important;}}`,
        }}
      />
    </div>
  )
}

function BenchmarkRow({
  label,
  value,
  bench,
  fmt,
}: {
  label: string
  value: number | null
  bench: number | null
  fmt: (n: number | null) => string
}) {
  const beats = value != null && bench != null && value > bench
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 14px',
        borderRadius: 12,
        background: 'rgba(255,255,255,0.04)',
      }}
    >
      <span style={{ fontSize: 13, color: 'var(--pe-muted)' }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 600 }}>
        <span style={{ color: beats ? 'var(--pe-lime)' : 'var(--pe-off)' }}>{fmt(value)}</span>
        <span style={{ color: 'var(--pe-muted)', fontWeight: 400 }}>
          {' '}
          vs {bench == null ? EMPTY : fmt(bench)}
        </span>
        {beats && <span style={{ color: 'var(--pe-lime)' }}> ▲</span>}
      </span>
    </div>
  )
}
