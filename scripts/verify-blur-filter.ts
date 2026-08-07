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

import { isMark } from '../src/lib/ai/mark-geometry.ts'

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

  // ── Floor: unchanged ─────────────────────────────────────────────────────
  // Below this a page speckles with blurs over nothing; the brand name in fine
  // print is deliberately left alone.
  { name: 'hairline artefact under the height floor', w: 0.3, h: 0.01, keep: false },
  { name: 'band under the height floor', w: 1.0, h: 0.015, keep: false },
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

console.log(failed ? `\n${failed} failure(s)` : `\nAll ${CASES.length} cases + boundary properties pass.`)
process.exit(failed ? 1 : 0)
