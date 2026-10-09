'use client'

import { useState } from 'react'
import { clientSrc, internalSrc, isVideoAsset, posterOf, videoWaitingNote, type MediaAsset } from '@/lib/creative-media'

// A creative, shown as what it is: a picture, or a video that plays.
//
// Tiles (grids, filmstrips, thumbnails) are ALWAYS a still — Drive's poster
// frame plus a play badge — so a grid of twenty video ads stays light and never
// autoplays. The full view plays the file from our storage, which a client on
// the review link can watch without a Google sign-in.

export function PlayBadge({ size = 28 }: { size?: number }) {
  return (
    <span aria-hidden style={{
      position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
      width: size, height: size, borderRadius: '50%', background: 'rgba(0,0,0,0.62)',
      display: 'grid', placeItems: 'center', pointerEvents: 'none',
    }}>
      <span style={{
        width: 0, height: 0, marginLeft: size * 0.1,
        borderTop: `${size * 0.2}px solid transparent`, borderBottom: `${size * 0.2}px solid transparent`,
        borderLeft: `${size * 0.32}px solid #fff`,
      }} />
    </span>
  )
}

/** The still for a tile: a picture's own image, or a video's poster frame with a play badge. */
export function CreativeTile({ asset, src, alt = '', style, badge = 28 }: {
  asset: MediaAsset
  /** A picture's tile source, when the caller already resolved one. Ignored for videos. */
  src?: string | null
  alt?: string
  style?: React.CSSProperties
  badge?: number
}) {
  const [broken, setBroken] = useState(false)
  const video = isVideoAsset(asset)
  const url = video ? posterOf(asset, 600) : (src ?? posterOf(asset, 600))
  return (
    <span style={{ position: 'relative', display: 'block', ...style, overflow: 'hidden', background: video ? '#0b0b0b' : undefined }}>
      {/* A brand-new Drive video can have no poster yet: show a dark tile with the badge, not a broken image. */}
      {!broken && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={alt} loading="lazy" onError={() => setBroken(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      )}
      {video && <PlayBadge size={badge} />}
    </span>
  )
}

/**
 * The full view. A picture renders as an <img>; a video as a <video> with its
 * own controls, or — while it is still being copied from Drive — its poster and
 * one line saying why it cannot play yet.
 */
export function CreativePlayer({ asset, src, audience, style, alt = '' }: {
  asset: MediaAsset
  /** A specific version to show (a version row, or "what the client sees"). */
  src?: string | null
  audience: 'team' | 'client'
  style?: React.CSSProperties
  alt?: string
}) {
  const video = isVideoAsset(asset)
  const url = src ?? (audience === 'client' ? clientSrc(asset) : internalSrc(asset))

  if (!video) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url ?? posterOf(asset, 2048)} alt={alt} decoding="async" style={style} draggable={false} />
  }
  if (url) {
    return (
      <video
        key={url}
        src={url}
        poster={posterOf(asset, 2048)}
        controls
        playsInline
        preload="metadata"
        style={{ background: '#000', ...style }}
      />
    )
  }
  return (
    <span style={{ position: 'relative', display: 'block', ...style }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={posterOf(asset, 2048)} alt={alt} style={{ width: '100%', display: 'block', opacity: 0.55 }} />
      <span style={{
        position: 'absolute', left: 12, right: 12, bottom: 12, padding: '8px 10px', borderRadius: 8,
        background: 'rgba(0,0,0,0.72)', color: '#fff', fontSize: 12, lineHeight: 1.45,
      }}>{videoWaitingNote(asset, audience)}</span>
    </span>
  )
}
