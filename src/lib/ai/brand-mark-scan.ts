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
// It never blocks a generation: an unreachable image or a model error is logged
// and the report ships with whatever regions were found. The author still owns
// the final look at the page.

// A full-page screenshot can be 6x taller than it is wide. Sent whole, the
// model sees ~1k pixels of height for 17k pixels of page and misses everything
// but the largest marks, so anything taller than this gets sliced into
// roughly-square tiles that are scanned independently.
const MAX_TILE_ASPECT = 1.4
/** Tiles overlap so a mark straddling a cut is still whole in one of them. */
const TILE_OVERLAP = 0.08
/** Longest edge handed to the model. Above this is bandwidth, not detail. */
const TILE_MAX_EDGE = 1400
/** Grow every box by this share of the image — models cut wordmarks fine. */
const PAD_PCT = 1.2
const MAX_CONCURRENCY = 4

type Tile = { buffer: Buffer; topPct: number; heightPct: number }

/** Slice a tall image into overlapping tiles, each downscaled for the model. */
async function toTiles(input: Buffer): Promise<Tile[]> {
  const img = sharp(input, { limitInputPixels: false })
  const { width, height } = await img.metadata()
  if (!width || !height) throw new Error('Could not read image dimensions.')

  const tileHeight = Math.min(height, Math.round(width * MAX_TILE_ASPECT))
  const step = Math.max(1, Math.round(tileHeight * (1 - TILE_OVERLAP)))

  const tops: number[] = []
  for (let top = 0; top < height; top += step) {
    tops.push(Math.min(top, height - tileHeight))
    if (top + tileHeight >= height) break
  }

  return Promise.all(
    tops.map(async (top) => ({
      buffer: await sharp(input, { limitInputPixels: false })
        .extract({ left: 0, top, width, height: tileHeight })
        .resize({ width: TILE_MAX_EDGE, height: TILE_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 88 })
        .toBuffer(),
      topPct: (top / height) * 100,
      heightPct: (tileHeight / height) * 100,
    })),
  )
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n))
}

/** Pad a region and clip it to the image. */
function pad(r: BlurRegion): BlurRegion {
  const x = clamp(r.xPct - PAD_PCT)
  const y = clamp(r.yPct - PAD_PCT)
  return {
    ...r,
    xPct: x,
    yPct: y,
    wPct: clamp(r.xPct + r.wPct + PAD_PCT) - x,
    hPct: clamp(r.yPct + r.hPct + PAD_PCT) - y,
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

  const tiles = await toTiles(input)
  const perTile = await mapWithLimit(tiles, MAX_CONCURRENCY, async (tile) => {
    const marks = await detectBrandMarks(tile.buffer.toString('base64'), 'image/jpeg', brandName)
    return marks.map(({ box: [ymin, xmin, ymax, xmax], what }) =>
      pad({
        xPct: clamp((xmin / 1000) * 100),
        // Box coordinates are relative to the tile — rebase onto the full image.
        yPct: clamp(tile.topPct + (ymin / 1000) * tile.heightPct),
        wPct: clamp(((xmax - xmin) / 1000) * 100),
        hPct: clamp(((ymax - ymin) / 1000) * tile.heightPct),
        note: what,
      }),
    )
  })

  return merge(perTile.flat().filter((r) => r.wPct > 0 && r.hPct > 0))
}

export type ScanSummary = { scanned: number; regions: number; failures: string[] }

/**
 * Scan every uploaded asset in a report and attach the blur regions in place.
 * Best-effort by design — see the note at the top of this file.
 */
export async function applyBrandMarkBlur(data: CaseStudy, brandName: string): Promise<ScanSummary> {
  const targets: { src: string; assign: (r: BlurRegion[]) => void; label: string }[] = []

  if (data.landing.image.src) {
    targets.push({
      src: data.landing.image.src,
      assign: (r) => (data.landing.image.blurRegions = r),
      label: 'landing page',
    })
  }
  data.creatives.forEach((c) => {
    if (c.media.poster.src) {
      targets.push({
        src: c.media.poster.src,
        assign: (r) => (c.media.poster.blurRegions = r),
        label: c.label,
      })
    }
  })
  if (data.proof?.src) {
    const proof = data.proof
    targets.push({ src: proof.src, assign: (r) => (proof.blurRegions = r), label: 'ad account proof' })
  }

  const summary: ScanSummary = { scanned: 0, regions: 0, failures: [] }

  // Assets in sequence, tiles within an asset in parallel — a tall landing page
  // is already several concurrent calls on its own.
  for (const t of targets) {
    try {
      const regions = await scanImageForBrandMarks(t.src, brandName)
      t.assign(regions)
      summary.scanned += 1
      summary.regions += regions.length
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      console.error('[brand-mark-scan]', t.label, detail)
      summary.failures.push(t.label)
    }
  }

  return summary
}
