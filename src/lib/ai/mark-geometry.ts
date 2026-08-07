// Pure geometry for the brand-mark scan: does a detected box look like a mark,
// and where does a box found inside a crop sit in the tile it came from?
//
// Kept out of `brand-mark-scan.ts` so it stays free of `sharp` and the Gemini
// client and can be imported by `scripts/verify-blur-filter.ts` directly (same
// reason `caseStudyExtract.ts` sits outside its 'use server' module).
//
// This decides whether a client's logo ships readable on a page sent to
// prospects, so every boundary here is asserted in that script.

/**
 * Smallest mark worth blurring, as a share of the tile's height.
 *
 * This was 0.02, chosen to sit above a line of body copy (~1.1% of tile height)
 * so the page was not speckled with blurs over the brand name in fine print.
 * That reasoning traded recall for tidiness, and the trade is off: a report went
 * out with the wordmark legible. Small marks now blur too. A tidy page that
 * names the client is worth less than a slightly speckled one that does not.
 */
export const MIN_REGION_HEIGHT = 0.008

/**
 * Largest share of a tile one mark may claim before it is treated as a section
 * rather than a mark. A brand mark is never a third of the frame; a box that
 * big is the model boxing the bar, card or photo the mark sits in.
 *
 * Being over this is no longer a reason to discard. It is a reason to look
 * again, closer — see `refine` in brand-mark-scan.ts. Only when that second
 * look finds nothing does the shape rules below decide.
 */
export const MAX_REGION_AREA = 0.12

/**
 * The fallback when a closer look fails: blur the whole BAND.
 *
 * A site header and footer run the full width of the page, so the model
 * routinely returns one box for the bar rather than for the logo inside it. A
 * bar is not what the area cap protects — that is there to stop the model
 * boxing a card or a hero photo, and those are chunky, roughly square or taller
 * than wide. A bar is a wide, flat strip.
 *
 * The height ceiling is deliberately generous (a third of the tile): the footer
 * on the page that prompted this is a deep brown band with the wordmark centred
 * in it, and a ceiling tight enough to look elegant is what let it through.
 * Blurring the whole strip is worse-looking than blurring the logo, and better
 * than shipping the logo.
 */
export const BAND_MIN_ASPECT = 3
export const BAND_MAX_HEIGHT = 0.35

/** Why a detected box was or was not turned into a blur. */
export type MarkVerdict = 'mark' | 'band' | 'too-small' | 'too-large'

/**
 * Classify a detected box. `w` and `h` are shares of the TILE, which is square,
 * so `w / h` is the box's true aspect ratio.
 *
 * 'band' is separated from 'mark' because the two want different handling
 * upstream: a mark is used as-is, a band is only used once a closer look has
 * failed to find the logo inside it.
 */
export function classify(w: number, h: number): MarkVerdict {
  if (h < MIN_REGION_HEIGHT) return 'too-small'
  if (w * h <= MAX_REGION_AREA) return 'mark'
  if (h <= BAND_MAX_HEIGHT && w / h >= BAND_MIN_ASPECT) return 'band'
  return 'too-large'
}

/** Would this box be blurred as it stands? */
export function isMark(w: number, h: number): boolean {
  const v = classify(w, h)
  return v === 'mark' || v === 'band'
}

/** A box in 0–1000 coordinates of whatever image it was found in. */
export type Box = { x0: number; y0: number; x1: number; y1: number }

/**
 * Map a box found inside a CROP back into the coordinates of the tile the crop
 * was cut from. Both are 0–1000 of their own image.
 *
 * The whole point of the second look is a tighter box, so getting this wrong
 * silently moves every refined blur somewhere else on the page — which looks
 * exactly like a redaction working, over the wrong pixels. Hence its own
 * assertions in the verify script.
 */
export function rebaseIntoTile(crop: Box, found: Box): Box {
  const w = crop.x1 - crop.x0
  const h = crop.y1 - crop.y0
  return {
    x0: crop.x0 + (found.x0 / 1000) * w,
    y0: crop.y0 + (found.y0 / 1000) * h,
    x1: crop.x0 + (found.x1 / 1000) * w,
    y1: crop.y0 + (found.y1 / 1000) * h,
  }
}
