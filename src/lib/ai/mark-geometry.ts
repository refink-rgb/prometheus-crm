// Pure geometry for the brand-mark scan: does a detected box look like a mark?
//
// Kept out of `brand-mark-scan.ts` so it stays free of `sharp` and the Gemini
// client and can be imported by `scripts/verify-blur-filter.ts` directly (same
// reason `caseStudyExtract.ts` sits outside its 'use server' module).
//
// This decides whether a client's logo ships readable on a page sent to
// prospects, so every boundary here is asserted in that script.

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
export const MIN_REGION_HEIGHT = 0.02

/**
 * Largest share of a tile one mark may claim before it is treated as a miss.
 * A brand mark is never a third of the frame. Anything that big is the model
 * boxing the card, photo or paragraph the mark sits in, and blurring it would
 * swallow the very thing the page is showing off.
 */
export const MAX_REGION_AREA = 0.12

/**
 * The exception to that cap: a header or footer BAND.
 *
 * A site header runs the full width of the page, so the model frequently
 * returns one box for the whole bar rather than for the logo sitting in it.
 * That box breaks the area cap, and dropping it left the mark it contains fully
 * readable — a miss at the top and bottom of a landing-page screenshot, which
 * is exactly where a logo is most certain to appear.
 *
 * A bar is not what the cap protects against. The cap is there to stop the
 * model boxing a card or a photo, and those are chunky: roughly square, or
 * taller than wide. A bar is a thin full-width strip. Rescue that shape and
 * nothing else, and accept that the whole strip gets blurred rather than just
 * the logo — the alternative on offer is not a tighter blur, it is no blur.
 */
export const BAND_MIN_ASPECT = 3
export const BAND_MAX_HEIGHT = 0.2

/**
 * Is a detected box a mark we should blur, or the model boxing the thing the
 * mark sits in? `w` and `h` are shares of the TILE, which is square, so `w / h`
 * is the box's true aspect ratio.
 */
export function isMark(w: number, h: number): boolean {
  if (h < MIN_REGION_HEIGHT) return false
  if (w * h <= MAX_REGION_AREA) return true
  return h <= BAND_MAX_HEIGHT && w / h >= BAND_MIN_ASPECT
}
