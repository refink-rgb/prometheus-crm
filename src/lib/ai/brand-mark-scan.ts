import sharp from 'sharp'
import { detectBrandMarks } from './gemini'
import type { BlurRegion, CaseStudy } from '@/data/case-studies/types'

// Automatic redaction pass over a report's uploaded assets.
//
// The text guard in `marketing-actions.ts` catches the brand name in report
// COPY. It cannot see the far more common leak: the wordmark burned into the
// creative or the landing-page screenshot. This module finds those and records
// them as blur regions on the image, which the showcase components render over
// (see `RedactedImage.tsx`). Nothing is written back to the stored asset.
//
// Scanning runs ONE IMAGE PER CALL, driven from the client, and never as part
// of generating the report. A report is a form the author has just filled in by
// hand — losing it to a slow or failed scan is not an acceptable trade.

/**
 * Width of the working copy tiles are cut from. Wide enough for the model to
 * read body copy on a full-page screenshot, small enough that the whole image
 * fits in memory as raw pixels.
 */
const WORK_WIDTH = 1400
/** Tiles are square: a tall page needs vertical resolution, not wide tiles. */
const TILE_ASPECT = 1
/** Tiles overlap so a mark straddling a cut is still whole in one of them. */
const TILE_OVERLAP = 0.08
const MAX_CONCURRENCY = 4

// Sizing. A redaction should read as deliberate and sit tight to the mark —
// matching how the treated assets we already ship are done, where the patch
// hugs the letterforms and stops. Padding proportional to the IMAGE (rather
// than to the mark) is what made these read as smudges: a fixed 1.2% of a
// 1632px creative is ~20px of halo on every side of a 35px line of text.

/**
 * Margin around a mark, as a share of the mark's HEIGHT — on both axes, so the
 * margin is even in pixels. Scaling each axis by its own dimension instead
 * overpads a wide line of text, adding more horizontal halo than it removes.
 */
const PAD_RATIO = 0.25
/** Floor, as a share of the image, so a hairline box still gets some margin. */
const PAD_MIN_PCT = 0.12
/**
 * Blur radius as a share of the mark's own height. Scaled to the mark so a
 * word of body copy gets a small blur and a full logo gets a large one —
 * a single radius for both is what drew the eye.
 */
const BLUR_RATIO = 0.5
const BLUR_MIN_CQW = 0.4
const BLUR_MAX_CQW = 4
/** Largest share of a tile one mark may claim before it is treated as a miss. */
const MAX_REGION_AREA = 0.12
/**
 * Smallest mark worth blurring, as a share of the tile's height. Only the big
 * logos on the page are redacted — the brand name in body copy is left alone,
 * because a page speckled with little blurs draws far more attention than the
 * word does.
 *
 * Measured against the real page rather than guessed: on a 2940px-wide
 * screenshot cut into 1400px tiles, a header logo is ~3.1% of tile height and
 * a line of body copy ~1.1%, so the floor sits between them. An earlier 4.5%
 * was above the logo itself and silently suppressed everything.
 */
const MIN_REGION_HEIGHT = 0.02

type Tile = { buffer: Buffer; topPct: number; heightPct: number }

/**
 * Slice an image into overlapping tiles for the model.
 *
 * A full-page screenshot can be 6x taller than it is wide. Sent whole, the
 * model sees ~1k pixels of height for 17k pixels of page and misses everything
 * but the largest marks, so the image is cut into squares scanned separately.
 *
 * The source is decoded exactly once, into a downscaled raw buffer that every
 * tile is then extracted from. Extracting from the original file per tile
 * instead re-decodes it each time — for a 2940x17588 screenshot that is ~200MB
 * of pixels per tile, which is what exhausted the serverless function's memory.
 */
async function toTiles(input: Buffer): Promise<{ tiles: Tile[]; aspect: number }> {
  const meta = await sharp(input, { limitInputPixels: false }).metadata()
  if (!meta.width || !meta.height) throw new Error('Could not read image dimensions.')
  const aspect = meta.height / meta.width

  const { data, info } = await sharp(input, { limitInputPixels: false })
    .resize({ width: Math.min(meta.width, WORK_WIDTH), withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const { width, height, channels } = info
  const tileHeight = Math.min(height, Math.round(width * TILE_ASPECT))
  const step = Math.max(1, Math.round(tileHeight * (1 - TILE_OVERLAP)))

  const tops: number[] = []
  for (let top = 0; top < height; top += step) {
    tops.push(Math.min(top, height - tileHeight))
    if (top + tileHeight >= height) break
  }

  // Sequential: each extract is cheap, but holding every encoded tile's
  // intermediate buffers at once is not.
  const tiles: Tile[] = []
  for (const top of tops) {
    tiles.push({
      buffer: await sharp(data, { raw: { width, height, channels } })
        .extract({ left: 0, top, width, height: tileHeight })
        .jpeg({ quality: 85 })
        .toBuffer(),
      topPct: (top / height) * 100,
      heightPct: (tileHeight / height) * 100,
    })
  }
  return { tiles, aspect }
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n))
}

/**
 * Pad a region and clip it to the image. `aspect` (height/width of the source)
 * converts the mark's height into a share of the image's width, so the margin
 * comes out the same number of pixels on both axes.
 */
function pad(r: BlurRegion, aspect: number): BlurRegion {
  const px = Math.max(r.hPct * aspect * PAD_RATIO, PAD_MIN_PCT)
  const py = Math.max(r.hPct * PAD_RATIO, PAD_MIN_PCT)
  const x = clamp(r.xPct - px)
  const y = clamp(r.yPct - py)
  return {
    ...r,
    xPct: x,
    yPct: y,
    wPct: clamp(r.xPct + r.wPct + px) - x,
    hPct: clamp(r.yPct + r.hPct + py) - y,
  }
}

function overlaps(a: BlurRegion, b: BlurRegion): boolean {
  return (
    a.xPct < b.xPct + b.wPct &&
    b.xPct < a.xPct + a.wPct &&
    a.yPct < b.yPct + b.hPct &&
    b.yPct < a.yPct + a.hPct
  )
}

/**
 * Union overlapping regions. Tiles overlap by design, so the same mark is
 * usually reported twice; two abutting blurs also read as a seam on the page.
 */
function merge(regions: BlurRegion[]): BlurRegion[] {
  const out: BlurRegion[] = []
  for (const r of regions) {
    let cur = r
    for (let i = out.length - 1; i >= 0; i--) {
      if (!overlaps(cur, out[i])) continue
      const o = out.splice(i, 1)[0]
      const x = Math.min(cur.xPct, o.xPct)
      const y = Math.min(cur.yPct, o.yPct)
      cur = {
        xPct: x,
        yPct: y,
        wPct: Math.max(cur.xPct + cur.wPct, o.xPct + o.wPct) - x,
        hPct: Math.max(cur.yPct + cur.hPct, o.yPct + o.hPct) - y,
        note: cur.note ?? o.note,
      }
    }
    out.push(cur)
  }
  return out
}

async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return results
}

/** Find every region of one image that shows the brand. Throws on a hard failure. */
export async function scanImageForBrandMarks(url: string, brandName: string): Promise<BlurRegion[]> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not fetch asset (${res.status}).`)
  const input = Buffer.from(await res.arrayBuffer())

  const { tiles, aspect } = await toTiles(input)
  let detected = 0
  const perTile = await mapWithLimit(tiles, MAX_CONCURRENCY, async (tile) => {
    const marks = await detectBrandMarks(tile.buffer.toString('base64'), 'image/jpeg', brandName)
    detected += marks.length
    return marks
      .filter(({ x0, y0, x1, y1 }) => {
        const height = (y1 - y0) / 1000
        // A brand mark is never a third of the frame. Anything that big is the
        // model boxing the card, photo or paragraph the mark sits in, and
        // blurring it would swallow the very thing the page is showing off.
        const area = ((x1 - x0) / 1000) * height
        return area <= MAX_REGION_AREA && height >= MIN_REGION_HEIGHT
      })
      .map(({ x0, y0, x1, y1, what }) =>
        pad(
          {
            xPct: clamp((x0 / 1000) * 100),
            // Vertical values are relative to the TILE — rebase onto the full
            // image. Horizontal values already span the full width.
            yPct: clamp(tile.topPct + (y0 / 1000) * tile.heightPct),
            wPct: clamp(((x1 - x0) / 1000) * 100),
            hPct: clamp(((y1 - y0) / 1000) * tile.heightPct),
            note: what,
          },
          aspect,
        ),
      )
  })

  const kept = perTile.flat()
  // "Found nothing" has two very different causes — the model saw nothing, or
  // the size filter threw it all away. Log both so they can be told apart.
  console.log(
    `[brand-mark-scan] ${tiles.length} tiles, ${detected} detected, ${kept.length} kept after size filter`,
  )

  return merge(kept.filter((r) => r.wPct > 0 && r.hPct > 0)).map((r) => ({
    ...r,
    // Sized after merging, so a fused box gets the radius its final size needs.
    // `hPct` is a share of image HEIGHT; cqw is a share of container WIDTH.
    blurCqw: +Math.min(BLUR_MAX_CQW, Math.max(BLUR_MIN_CQW, r.hPct * aspect * BLUR_RATIO)).toFixed(2),
  }))
}

// ─── Addressing one image inside a stored report ─────────────────────────────
//
// The client scans an asset at a time, so each call has to name which one.
// Keys are derived from the report's own shape, never from an array index — a
// regenerate can reorder creatives.

export type ScanTarget = { key: string; label: string; src: string }

/**
 * The assets scanned for brand marks — the landing page only.
 *
 * The creatives and the ad-account screenshot are deliberately left alone. The
 * creatives we ship already carry their redaction baked in by hand, and the
 * screenshot shows ad names rather than the brand, so scanning them only added
 * blurs over artwork the page exists to show. `setScanRegions` still handles
 * the other keys, so an existing report's stored regions stay renderable.
 */
export function listScanTargets(data: CaseStudy): ScanTarget[] {
  if (!data.landing.image.src) return []
  return [{ key: 'landing', label: 'Landing page', src: data.landing.image.src }]
}

/**
 * Drop regions from anything no longer scanned. Reports blurred before the
 * scan narrowed to the landing page still carry regions on their creatives,
 * and those keep rendering until something clears them.
 */
export function clearUnscannedRegions(data: CaseStudy): void {
  const scanned = new Set(listScanTargets(data).map((t) => t.key))
  if (data.proof && !scanned.has('proof')) data.proof.blurRegions = null
  if (!scanned.has('landing')) data.landing.image.blurRegions = null
  data.creatives.forEach((c) => {
    if (!scanned.has(`creative:${c.id}`)) c.media.poster.blurRegions = null
  })
}

/** Attach regions to the image named by `key`. Returns false if it is gone. */
export function setScanRegions(data: CaseStudy, key: string, regions: BlurRegion[]): boolean {
  if (key === 'proof') {
    if (!data.proof) return false
    data.proof.blurRegions = regions
    return true
  }
  if (key === 'landing') {
    data.landing.image.blurRegions = regions
    return true
  }
  const id = key.startsWith('creative:') ? key.slice('creative:'.length) : null
  const creative = id ? data.creatives.find((c) => c.id === id) : null
  if (!creative) return false
  creative.media.poster.blurRegions = regions
  return true
}
