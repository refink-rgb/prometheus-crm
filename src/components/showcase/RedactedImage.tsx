import type { CSSProperties } from 'react'
import type { BlurRegion } from '@/data/case-studies/types'

// Render-time redaction for uploaded assets.
//
// Uploaded creatives and landing-page screenshots routinely still carry the
// client's wordmark — in a headline, in body copy, printed on the product. The
// showcase page is sent to prospects, so those have to be unreadable. We blur
// them at render time from percentage rectangles stored on the image, rather
// than baking a treated file, so a region can be corrected or dropped without
// re-uploading the asset.
//
// Blur radius is expressed in `cqw` (a share of the container's width) so the
// same region is equally illegible on a 288px carousel thumbnail and on the
// full-width landing-page screenshot. A fixed px fallback is declared first in
// `ShowcaseStyles` for engines without container query units — never no blur.
//
// IMPORTANT: percentages are of the IMAGE BOX. Only use these on an image that
// fills its box without cropping (`object-fit: contain`, or `cover` where the
// box and the file share an aspect ratio) — a crop would shift every region.

export function BlurRegions({ regions }: { regions?: BlurRegion[] | null }) {
  if (!regions || regions.length === 0) return null
  return (
    <>
      {regions.map((r, i) => (
        <div
          key={i}
          aria-hidden
          className="pe-blur"
          style={{
            left: `${r.xPct}%`,
            top: `${r.yPct}%`,
            width: `${r.wPct}%`,
            height: `${r.hPct}%`,
          }}
        />
      ))}
    </>
  )
}

/** An `<img>` plus its blur regions, in a container the regions are measured against. */
export default function RedactedImage({
  src,
  alt,
  regions,
  style,
  wrapperStyle,
  loading = 'lazy',
}: {
  src: string
  alt: string
  regions?: BlurRegion[] | null
  /** Applied to the <img>. */
  style?: CSSProperties
  /** Applied to the positioning wrapper. */
  wrapperStyle?: CSSProperties
  loading?: 'lazy' | 'eager'
}) {
  return (
    <div className="pe-blur-box" style={wrapperStyle}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} loading={loading} decoding="async" style={style} />
      <BlurRegions regions={regions} />
    </div>
  )
}
