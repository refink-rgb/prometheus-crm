// Checks for the brief cheat sheet's rules. No test framework in this repo, so
// this is a standalone script:
//
//   npx tsx scripts/check-brief-cheatsheet.ts            check
//   npx tsx scripts/check-brief-cheatsheet.ts --print    print each real brief's values (to write a new .expected.json)
//
// Exits non-zero on any failure. `scripts` is in the tsconfig exclude list, so
// nothing here reaches `next build`.
//
// Three parts:
//   1. Real briefs, stored rows as the database holds them. Each
//      scripts/fixtures/NAME.expected.json names its extraction file and the
//      values the card, the viewer and the price check must show for it. Both
//      files are client material, so scripts/fixtures/ is gitignored and this
//      file quotes none of it. Without fixtures, this part is skipped with a note.
//   2. A made-up short ad brief (scripts/brief-fixtures/). It guards the other
//      direction: rules tuned on a long sales page must not eat a real ad
//      brief's headline options or ordinary words like "bar" and "block".
//   3. The normalizer's pick guard and new-row behaviour, on hand-written model output.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeBriefExtraction, sentencesOf, type BriefExtraction, type BriefImage } from '../src/lib/project-briefs'
import {
  buildBriefPages, buildCheatSheet, copyPicksText, imageryCaption, offerCheck, picksForDeck,
} from '../src/lib/brief-cheatsheet'

let failures = 0
let checks = 0
function eq(label: string, actual: unknown, expected: unknown) {
  checks++
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a !== e) {
    failures++
    console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`)
  }
}
const ok = (label: string, cond: boolean) => eq(label, cond, true)

const PDF = 'application/pdf'
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const EMPTY_DECK = { headlines: [], subcopies: [], eyebrows: [] }
const here = (...p: string[]) => join(process.cwd(), 'scripts', ...p)
const normalize = (raw: unknown): BriefExtraction => {
  const x = normalizeBriefExtraction(raw)
  if (!x) throw new Error('fixture did not normalize')
  return x
}
const load = (path: string) => normalize(JSON.parse(readFileSync(path, 'utf8')))

// ── 1. Real briefs (gitignored fixtures) ─────────────────────────────────

interface Expected {
  /** File name in scripts/fixtures/. */
  extraction: string
  mime: string
  pageCount: number | null
  /** PDF: how many page previews to assume (pages 1..N). */
  previews: number
  /** The project's Offer text to run the price check against. */
  offerText: string
  /** Label → value, as --print writes them. Only the labels listed are checked. */
  expect: Record<string, unknown>
}

/** Every value the spec promises for a stored row, under a stable label. */
function snapshot(x: BriefExtraction, e: Expected): Record<string, unknown> {
  const images: BriefImage[] = Array.from({ length: e.previews }, (_, i) => ({
    n: i + 1, page: i + 1, source: 'pdf-page' as const,
    full: `p/b/img-${i + 1}-full.webp`, thumb: `p/b/img-${i + 1}-thumb.webp`, w: 1200, h: 1500,
  }))
  const sheet = buildCheatSheet(x, images, e.pageCount)
  const pages = buildBriefPages(x, images, e.mime, e.pageCount)
  const slot = (s: keyof typeof sheet.put.slots) => sheet.put.slots[s].map(l => [l.text, l.page])
  const lines = pages.entries.flatMap(en => en.lines)
  const productNames = [x.offer.name, ...x.products.map(p => p.name)]
  const bare = buildCheatSheet(x, [], e.pageCount)
  const out: Record<string, unknown> = {
    'row flags [ai_picks, picks, ad_rules, brief_type, copy_capped]': [x.ai_picks, x.ad_picks.length, x.ad_rules.length, x.brief_type, x.copy_capped],
    'strip: lines checked': sheet.linesChecked,
    'title tag: landing page': sheet.landingPage,
    'sell: product': sheet.sell.product,
    'sell: products [shown, more]': [sheet.sell.products, sheet.sell.moreProducts],
    'sell: price': sheet.sell.price,
    'sell: conditions [shown, more]': [sheet.sell.conditions, sheet.sell.moreConditions],
    'sell: offer line [text, page]': sheet.sell.offerLine && [sheet.sell.offerLine.text, sheet.sell.offerLine.page],
    'sell: empty': sheet.sell.empty,
    'price check': offerCheck(x, e.offerText),
    'say [source, text, verbatim, more angles]': sheet.say && [sheet.say.source, sheet.say.text, sheet.say.source === 'angle' && sheet.say.verbatim, sheet.say.moreAngles],
    'put: source': sheet.put.source,
    'put: eyebrow': slot('eyebrow'),
    'put: headline': slot('headline'),
    'put: subline': slot('subline'),
    'put: cta': slot('cta'),
    'put: headline thumbnails': sheet.put.slots.headline.map(l => l.image?.page ?? null),
    'put: add to deck count': picksForDeck(sheet.put, EMPTY_DECK).length,
    'put: copy picks': copyPicksText(sheet.put),
    'section titles': lines.filter(l => l.role === 'heading').map(l => l.text),
    'image-slot labels': lines.filter(l => l.role === 'image-slot').map(l => l.text),
    'product-name headlines [text, role]': lines.filter(l => l.kind === 'headline' && productNames.includes(l.text)).map(l => [l.text, l.role]),
    'show [page, caption, placeholder]': sheet.show.map(s => [s.page, s.caption, s.placeholder]),
    'show: all placeholders': sheet.showAllPlaceholders,
    'must [items, total, layout rules, source]': [sheet.must.items, sheet.must.total, sheet.must.layoutRules, sheet.must.source],
    'never': sheet.never.items,
    'ask [items, more, page-only]': [sheet.ask.items.map(q => q.text), sheet.ask.more, sheet.ask.pageOnly],
    'full read': sheet.fullRead,
    'viewer: badges': Object.fromEntries(pages.entries.filter(en => en.usableCount > 0).map(en => [en.label, en.usableCount])),
    'viewer: no text kept': pages.entries.filter(en => en.noTextKept).map(en => en.page),
    'viewer: truncated': pages.truncated,
    'viewer: counts': pages.counts,
    'viewer: layout [layout, entries, unplaced]': [pages.layout, pages.entries.length, pages.unplaced.length],
    'no previews [show, headline thumbnail]': [bare.show.length, bare.put.slots.headline[0]?.image ?? null],
  }
  // "Use on an ad" for every page that has lines: count, top 5 in document order, all-text count.
  for (const en of pages.entries.filter(p => p.usableCount > 0)) {
    out[`viewer: ${en.label} use on an ad [count, lines, all text]`] =
      [en.usableCount, en.usable.map(l => [l.text, l.role, l.deckColumn]), en.lines.length]
  }
  return out
}

const fixtureDir = here('fixtures')
const expectedFiles = existsSync(fixtureDir) ? readdirSync(fixtureDir).filter(f => f.endsWith('.expected.json')) : []
if (!expectedFiles.length) {
  console.log('skip: no scripts/fixtures/*.expected.json here (client fixtures, not in git)')
}
for (const file of expectedFiles) {
  const e = JSON.parse(readFileSync(join(fixtureDir, file), 'utf8')) as Expected
  const snap = snapshot(load(join(fixtureDir, e.extraction)), e)
  if (process.argv.includes('--print')) {
    console.log(JSON.stringify(snap, null, 2))
    continue
  }
  for (const [label, value] of Object.entries(e.expect)) {
    if (!(label in snap)) { failures++; checks++; console.error(`FAIL ${file}: no value named "${label}"`); continue }
    eq(`${file}: ${label}`, snap[label], value)
  }
}

// ── 2. Made-up short ad brief ────────────────────────────────────────────

{
  const x = load(here('brief-fixtures', 'synthetic-ad-brief.json'))
  const sheet = buildCheatSheet(x, [], null)
  const pages = buildBriefPages(x, [], PPTX, null)
  const lines = pages.entries.flatMap(e => e.lines)

  eq('synthetic: headline options survive', sheet.put.slots.headline.map(l => l.text).sort(),
    ['Sleep Deeper Tonight', 'Summer Sale', 'Wake Up Rested'])
  eq('synthetic: title line is the only section title', lines.filter(l => l.role === 'heading').map(l => l.text), ['Summer Sleep Sale'])
  eq('synthetic: "Block out the noise" is usable', lines.find(l => l.text === 'Block out the noise')?.role, 'ad')
  ok('synthetic: "Block out the noise" is a subline option', sheet.put.slots.subline.some(l => l.text === 'Block out the noise'))
  eq('synthetic: no mandatory dropped as page layout ("chocolate bar")', [sheet.must.layoutRules, sheet.must.total], [0, 4])
  ok('synthetic: product list keeps "Chocolate Bar Bundle"', sheet.sell.products.includes('Chocolate Bar Bundle'))
  eq('synthetic: unverified two-price line is not a subline', sheet.put.slots.subline.some(l => l.verified === false), false)
  eq('synthetic: two prices, one line holds both', sheet.sell.price, { kind: 'strike', was: '$69', now: '$49' })
  eq('synthetic: offer line', sheet.sell.offerLine?.text, 'Now $49, was $69 — use code SLEEP20')
  eq('synthetic: CTA', sheet.put.slots.cta.map(l => l.text), ['Shop the sale'])
  eq('synthetic: strip says lines were checked', sheet.linesChecked, true)
  eq('synthetic: not a landing page', sheet.landingPage, false)
  eq('synthetic: slides layout', [pages.layout, pages.entries.map(e => e.lines.length)], ['slides', [1, 5, 3]])
  eq('synthetic: offer check with code', offerCheck(x, 'Summer Sleep Sale: $49 (was $69) with code sleep20').map(c => c.text),
    ['$49 in Offer ✓', '$69 in Offer ✓', 'Code SLEEP20 in Offer ✓'])
  eq('synthetic: offer check, bare numbers count, code missing', offerCheck(x, 'Now 49, was 69.00').map(c => c.tone), ['ok', 'ok', 'warn'])
  eq('synthetic: offer check, price paid missing', offerCheck(x, 'Summer sale, $69 before')[0],
    { tone: 'warn', text: 'Check: $49 is not in the Offer section', action: 'go-to-offer' })
  eq('synthetic: offer check, comparison price missing', offerCheck(x, 'Now $49')[1],
    { tone: 'info', text: '$69 comparison price · brief only', action: null })
  eq('synthetic: offer check, empty Offer section', offerCheck(x, ' \n '), [{ tone: 'warn', text: 'Offer section is empty', action: 'go-to-offer' }])
  eq('synthetic: ask (tied at +2, document order)', sheet.ask.items.map(q => q.text), ['No end time for the sale', 'No sizes given'])
  eq('synthetic: copy picks', copyPicksText(sheet.put, { headline: 1 }).split('\n').map(l => l.split(':')[0]), ['EYEBROW', 'HEADLINE', 'SUBLINE', 'CTA'])
  eq('synthetic: deck counts skip lines already in the deck',
    [picksForDeck(sheet.put, EMPTY_DECK).length, picksForDeck(sheet.put, { headlines: [sheet.put.slots.headline[0].text.toUpperCase()], subcopies: [], eyebrows: [] }).length],
    [3, 2])
}

// ── 3. The pick guard and new rows ───────────────────────────────────────

{
  eq('sentencesOf', sentencesOf('Total value £99.99. You pay £49. "Really?" Yes'), ['Total value £99.99.', 'You pay £49.', '"Really?"', 'Yes'])
  eq('imageryCaption, unquoted', imageryCaption('Image placeholder for flat lay of the set, image placeholder for towel.'), 'flat lay of the set')
  eq('imageryCaption, quoted without "for"', imageryCaption("Image placeholder 'FLAT LAY, SET, OVERHEAD', 'SHAFT BAND, CLOSE'."), 'FLAT LAY, SET, OVERHEAD')
  eq('imageryCaption, apostrophe is not a quote', imageryCaption("Photo of the founder's bench, hands and tools."), "Photo of the founder's bench, hands and tools")

  const raw = {
    title: 'Test', brief_type: 'ad',
    copy: [
      { kind: 'headline', text: 'Test', location: 'p. 1', fit: 'ad' },
      { kind: 'headline', text: 'Sleep Deeper Tonight', location: 'p. 1', fit: 'ad' },
      { kind: 'body', text: 'Fall asleep faster. Wake up without the fog, every single morning this summer.', location: 'p. 1', fit: 'long' },
      { kind: 'cta', text: 'SHOP NOW', location: 'p. 2', fit: 'ad' },
      { kind: 'other', text: 'Hero section', location: 'p. 1', fit: 'note' },
      { kind: 'headline', text: 'A\nB c', location: 'p. 2', fit: 'wrong' },
      { kind: 'headline', text: 'Tonight only $49 $69', location: 'p. 2', fit: 'ad' },
      { kind: 'cta', text: '$49', location: 'p. 2', fit: 'ad' },
    ],
    ad_picks: [
      { slot: 'headline', text: 'Test' },                                   // the document's title: shown nowhere
      { slot: 'headline', text: 'Tonight only $49 $69' },                   // two prices side by side: shown nowhere
      { slot: 'cta', text: '$49' },                                          // a price on its own: shown nowhere
      { slot: 'headline', text: 'sleep deeper tonight!' },                  // case and punctuation differ: kept, brief's text shown
      { slot: 'headline', text: 'Sleep Deeper Tonight' },                   // duplicate: dropped
      { slot: 'headline', text: 'Sleep deeper, starting tonight' },         // reworded: dropped
      { slot: 'subline', text: 'Fall asleep faster.' },                     // one sentence of a longer line
      { slot: 'subline', text: 'Fall asleep faster. Wake up' },             // trimmed inside a sentence: dropped
      { slot: 'cta', text: 'SHOP NOW' },
      { slot: 'cta', text: 'A\nB c' },                                       // multi-line: dropped
      { slot: 'banner', text: 'SHOP NOW' },                                  // unknown slot: dropped
      { slot: 'eyebrow', text: 'Fall asleep faster. Wake up without the fog, every single morning this summer.' }, // too long
    ],
    ad_rules: [
      { type: 'must', text: 'Logo top left', location: 'p. 1' },
      { type: 'never', text: 'No beds with people', location: '' },
      { type: 'maybe', text: 'Dropped', location: '' },
    ],
    mandatories: ['Hero section first'], donts: ['Old dont'],
  }
  const x = normalize(raw)
  eq('new row flags', [x.ai_picks, x.brief_type, x.copy_capped], [true, 'ad', false])
  eq('fit read, invalid → null', x.copy.map(c => c.fit), ['ad', 'ad', 'long', 'ad', 'note', null, 'ad', 'ad'])
  eq('pick guard', x.ad_picks, [
    { slot: 'headline', text: 'Test', copy_index: 0, sentence: false },
    { slot: 'headline', text: 'Tonight only $49 $69', copy_index: 6, sentence: false },
    { slot: 'cta', text: '$49', copy_index: 7, sentence: false },
    { slot: 'headline', text: 'Sleep Deeper Tonight', copy_index: 1, sentence: false },
    { slot: 'subline', text: 'Fall asleep faster.', copy_index: 2, sentence: true },
    { slot: 'cta', text: 'SHOP NOW', copy_index: 3, sentence: false },
  ])
  eq('picks survive a round trip through storage', normalize(JSON.parse(JSON.stringify(x))).ad_picks, x.ad_picks)
  eq('ad rules', x.ad_rules, [{ type: 'must', text: 'Logo top left', location: 'p. 1' }, { type: 'never', text: 'No beds with people', location: '' }])

  const sheet = buildCheatSheet(x, [], 2)
  eq('new row: AI picks only, no rule padding', [sheet.put.source, sheet.put.slots.eyebrow.length, sheet.put.slots.subline[0].sentence], ['ai', 0, true])
  eq('new row: title, side-by-side prices and a bare price are never shown',
    [sheet.put.slots.headline.map(l => l.text), sheet.put.slots.cta.map(l => l.text)], [['Sleep Deeper Tonight'], ['SHOP NOW']])
  eq('new row: MUST and NEVER from ad_rules only', [sheet.must.items, sheet.must.source, sheet.never.items], [['Logo top left'], 'ai', ['No beds with people']])
  eq('new row: landing tag from brief_type', sheet.landingPage, false)
  const pages = buildBriefPages(x, [], PDF, 2)
  // Line 2 is fit "long" but a sentence of it is picked, so its page lists it.
  eq('new row: roles follow fit and picks', pages.entries.flatMap(e => e.lines).map(l => [l.copyIndex, l.role]),
    [[0, 'ad'], [1, 'ad'], [2, 'ad'], [4, 'note'], [3, 'ad'], [5, 'text'], [6, 'ad'], [7, 'ad']])
  eq('new row: 150 lines is not "capped" without the flag', buildBriefPages(normalize({
    ad_picks: [], copy: Array.from({ length: 150 }, (_, i) => ({ kind: 'body', text: `Line ${i}`, location: 'p. 1', fit: 'long' })),
  }), [], PDF, 3).truncated, null)

  const capped = normalize({ copy: Array.from({ length: 260 }, (_, i) => ({ kind: 'body', text: `Line ${i}`, location: 'p. 1' })) })
  eq('copy cap 250 and copy_capped', [capped.copy.length, capped.copy_capped], [250, true])
  eq('old row with exactly 150 lines reads as capped', buildBriefPages(normalize({
    copy: Array.from({ length: 150 }, (_, i) => ({ kind: 'body', text: `Line ${i}`, location: 'p. 1' })),
  }), [], PDF, 3).truncated, { lastPage: 1, kept: 150 })
  eq('copy_capped read back from storage', normalize({ copy: [], copy_capped: true }).copy_capped, true)
}

console.log(`${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)
