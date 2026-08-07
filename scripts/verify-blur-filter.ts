// Checks for the brand-mark size filter. No test framework in this repo, so
// this is a standalone script (same shape as scripts/verify-results.ts):
//
//   node --experimental-strip-types scripts/verify-blur-filter.ts
//
// Exits non-zero on any failure. `scripts` is in the tsconfig exclude list, so
// nothing here reaches `next build`.
//
// What this guards: `isMark` is the last thing standing between a detected
// client logo and a showcase page sent to prospects. A box it rejects is not
// blurred, and nothing downstream notices — the page renders clean and the mark
// is readable. The reported failure was exactly that: the model boxed a
// full-width header/footer band, the area cap rejected it for being too big to
// be a mark, and the logo inside it shipped.
//
// The cap still has to hold. It exists so the model boxing a hero photo or a
// product card does not blur the thing the page is showing off. So the two
// behaviours worth breaking the build over are BOTH directions:
//
//   1. A BAND IS A MARK — a wide, short strip survives the area cap.
//   2. A BLOCK IS NOT — anything chunky is still rejected, however it is sized.

import {
  isMark,
  classify,
  rebaseIntoTile,
  MIN_REGION_HEIGHT,
  type Box,
} from '../src/lib/ai/mark-geometry.ts'

// Boxes are shares of one square tile: [width, height].
const CASES: { name: string; w: number; h: number; keep: boolean }[] = [
  // ── Marks: kept ──────────────────────────────────────────────────────────
  { name: 'header logo, tight box', w: 0.12, h: 0.031, keep: true },
  { name: 'wordmark in body copy', w: 0.08, h: 0.022, keep: true },
  { name: 'wide headline containing the brand', w: 0.7, h: 0.05, keep: true },
  { name: 'logo printed on a product', w: 0.09, h: 0.04, keep: true },

  // ── Bands: the regression this script exists for ─────────────────────────
  // Full-width strips over the area cap. Before the band rule every one of
  // these was dropped, which is how a logo reached a prospect.
  { name: 'full-width header bar, over the cap', w: 1.0, h: 0.13, keep: true },
  { name: 'full-width footer band with centred wordmark', w: 1.0, h: 0.19, keep: true },
  { name: 'near-full-width band', w: 0.85, h: 0.15, keep: true },

  // ── Blocks: still rejected, the cap doing its job ────────────────────────
  { name: 'hero photo (wide but deep)', w: 1.0, h: 0.45, keep: false },
  { name: 'product card', w: 0.32, h: 0.42, keep: false },
  { name: 'whole tile', w: 1.0, h: 1.0, keep: false },
  { name: 'tall sidebar', w: 0.25, h: 0.6, keep: false },
  { name: 'square block over the cap', w: 0.4, h: 0.4, keep: false },

  // ── Small marks: now kept ────────────────────────────────────────────────
  // The floor used to sit above a line of body copy, which is also where a
  // small wordmark sits. "Blur the big ones and the small ones" is the whole
  // requirement, so the floor now only excludes what cannot be read at all.
  { name: 'small wordmark in a footer', w: 0.06, h: 0.012, keep: true },
  { name: 'brand name in body copy', w: 0.05, h: 0.011, keep: true },
  { name: 'hairline artefact below the floor', w: 0.3, h: 0.004, keep: false },
]

let failed = 0
for (const { name, w, h, keep } of CASES) {
  const got = isMark(w, h)
  const ok = got === keep
  if (!ok) failed++
  const area = (w * h).toFixed(3)
  const aspect = (w / h).toFixed(1)
  console.log(
    `${ok ? 'ok  ' : 'FAIL'}  ${name}\n      ${w}x${h} (area ${area}, aspect ${aspect}) → ${got ? 'blur' : 'skip'}, expected ${keep ? 'blur' : 'skip'}`,
  )
}

// The boundary itself, stated as a property rather than a point: at any width
// wide enough to be a bar, height decides. This is what stops a future tweak
// to the constants quietly reopening the leak.
for (const w of [0.7, 0.85, 1.0]) {
  if (!isMark(w, 0.13)) {
    console.log(`FAIL  a ${w}-wide bar 0.13 tall must blur`)
    failed++
  }
  if (isMark(w, 0.5)) {
    console.log(`FAIL  a ${w}-wide block 0.5 deep must not blur`)
    failed++
  }
}

// ── The verdicts drive different handling, so they are asserted by name ─────
// 'band' and 'too-large' both go for a second look; only 'band' survives it
// failing. Collapsing the two would either blur hero photos or, as shipped,
// silently drop footers.
const VERDICTS: { name: string; w: number; h: number; want: string }[] = [
  { name: 'tight logo', w: 0.1, h: 0.03, want: 'mark' },
  { name: 'deep footer band', w: 1.0, h: 0.3, want: 'band' },
  { name: 'hero photo', w: 1.0, h: 0.5, want: 'too-large' },
  { name: 'sub-pixel noise', w: 0.2, h: 0.002, want: 'too-small' },
]
for (const { name, w, h, want } of VERDICTS) {
  const got = classify(w, h)
  if (got !== want) {
    console.log(`FAIL  ${name}: classify(${w}, ${h}) = ${got}, expected ${want}`)
    failed++
  } else {
    console.log(`ok    ${name} → ${got}`)
  }
}

// ── Crop → tile mapping ────────────────────────────────────────────────────
// A refined box is only useful if it lands where the logo actually is. An error
// here does not look like a bug: the page renders with a confident blur over
// the wrong pixels and the mark still readable beside it.
const REBASE: { name: string; crop: Box; found: Box; want: Box }[] = [
  {
    name: 'logo centred in a full-width header bar',
    crop: { x0: 0, y0: 0, x1: 1000, y1: 100 },
    found: { x0: 450, y0: 200, x1: 550, y1: 800 },
    want: { x0: 450, y0: 20, x1: 550, y1: 80 },
  },
  {
    name: 'mark in a crop offset down the tile',
    crop: { x0: 200, y0: 600, x1: 700, y1: 800 },
    found: { x0: 0, y0: 0, x1: 1000, y1: 1000 },
    want: { x0: 200, y0: 600, x1: 700, y1: 800 },
  },
  {
    name: 'quarter box inside an offset crop',
    crop: { x0: 100, y0: 100, x1: 500, y1: 500 },
    found: { x0: 500, y0: 500, x1: 1000, y1: 1000 },
    want: { x0: 300, y0: 300, x1: 500, y1: 500 },
  },
]
for (const { name, crop, found, want } of REBASE) {
  const got = rebaseIntoTile(crop, found)
  const same = (['x0', 'y0', 'x1', 'y1'] as const).every((k) => Math.abs(got[k] - want[k]) < 0.001)
  if (!same) {
    console.log(`FAIL  rebase ${name}: got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`)
    failed++
  } else {
    console.log(`ok    rebase ${name}`)
  }
}

// A refined box must never escape the crop it was found in — that would blur
// a region the model never looked at.
{
  const crop = { x0: 300, y0: 400, x1: 600, y1: 500 }
  const got = rebaseIntoTile(crop, { x0: 0, y0: 0, x1: 1000, y1: 1000 })
  if (got.x0 < crop.x0 || got.y0 < crop.y0 || got.x1 > crop.x1 || got.y1 > crop.y1) {
    console.log('FAIL  a rebased box escaped its crop')
    failed++
  } else {
    console.log('ok    a rebased box stays inside its crop')
  }
}

// The floor is a documented number, not an accident: assert what it admits.
if (!isMark(0.05, MIN_REGION_HEIGHT)) {
  console.log('FAIL  a box exactly at the floor must blur')
  failed++
}

console.log(failed ? `\n${failed} failure(s)` : `\nAll ${CASES.length} cases + boundary properties pass.`)
process.exit(failed ? 1 : 0)
