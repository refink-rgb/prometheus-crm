// The Editor cheat sheet: what a static-ad designer needs out of a read brief,
// worked out once, here, with no React and no server.
//
// BriefCheatSheet, BriefPageViewer and scripts/check-brief-cheatsheet.ts all
// run these same functions, so the numbers on the card, the viewer's badges and
// the checked fixture values cannot drift apart.
//
// Two kinds of stored row:
//   ai_picks true   the read chose ad lines itself (ad_picks) and wrote ad_rules.
//                   Slots, MUST and NEVER come from those only. A slot the model
//                   left empty stays empty: rules never pad it.
//   ai_picks false  an older read. The rules below pick lines, sort mandatories
//                   and spot section titles, so every stored row works without a
//                   Re-read. The same rules also cover a new row's line whose
//                   `fit` is missing.
//
// Nothing here rewrites a line. Every text returned is the brief's own, as stored.

import {
  BRIEF_SLOTS, matchKey, lineKey,
  type BriefCopyKind, type BriefExtraction, type BriefImage, type BriefSlot,
} from './project-briefs'

// ── Types the UI consumes ────────────────────────────────────────────────

export type DeckColumn = 'ad_headlines' | 'ad_subcopies' | 'ad_eyebrows'

/** The project's copy deck, as PreviewProjectView passes it down. */
export interface BriefDeck { headlines: string[]; subcopies: string[]; eyebrows: string[] }

/** One line offered for an ad slot. `copyIndex` points into `x.copy`. */
export interface SlotLine {
  text: string
  copyIndex: number
  kind: BriefCopyKind
  location: string
  /** PDF page or slide number; null when the location does not parse. */
  page: number | null
  /** Thumbnail of the source page or slide; null when there is no preview. */
  image: BriefImage | null
  verified: boolean | null
  /** One whole sentence lifted from a longer line (AI picks only). */
  sentence: boolean
  /** Where "+ Deck" puts it; null for CTA. */
  deckColumn: DeckColumn | null
}

export interface OfferLine { text: string; copyIndex: number; location: string; page: number | null; image: BriefImage | null }

export type SellPrice =
  /** Exactly two prices and one copy line holds both: strike the larger, bold the smaller. */
  | { kind: 'strike'; was: string; now: string }
  /** Up to 3 prices, exactly as written. */
  | { kind: 'chips'; chips: string[]; more: number }

export interface SellRow {
  /** offer.name, or the first product's name. */
  product: string
  /** Up to 3 product names under it (the one already shown as `product` is left out). */
  products: string[]
  moreProducts: number
  price: SellPrice | null
  /** Up to 2 conditions, the best gift/value line and the best risk-reversal line first. */
  conditions: string[]
  moreConditions: number
  /** Copy only: never offered to the deck. */
  offerLine: OfferLine | null
  /** No product and no price: the card shows "No product or price in this brief." */
  empty: boolean
}

export type SayRow =
  | {
    source: 'angle'
    text: string
    /** The angle's words sit inside a copy line; false = tag it "AI's wording". */
    verbatim: boolean
    page: number | null
    image: BriefImage | null
    moreAngles: number
  }
  | { source: 'tagline'; text: string; page: number | null; image: BriefImage | null; moreAngles: 0 }

export interface PutRow {
  /** 'ai' = "Picked by AI from the brief's own lines"; 'rules' = "Picked by rules · Re-read for AI picks". */
  source: 'ai' | 'rules'
  /** Up to 3 options per slot, best first. */
  slots: Record<BriefSlot, SlotLine[]>
  /** All four slots empty. */
  empty: boolean
}

export interface ShowItem {
  image: BriefImage
  /** PDF page or slide number, when the picture has one. */
  page: number | null
  /** 60 characters or fewer. */
  caption: string
  /** The caption before shortening, for a title attribute. */
  captionFull: string
  /** The brief calls it a placeholder (a mockup box, not a photo). */
  placeholder: boolean
}

export interface RuleList {
  items: string[]
  /** How many there are in all ("3 of 20"). */
  total: number
  source: 'ai' | 'rules'
}

export interface AskRow {
  items: { text: string; computed: boolean }[]
  /** Ad questions not shown. */
  more: number
  /** Gaps about page parts (sticky bar, FAQ, press logos), left out of the card. */
  pageOnly: number
  /** "Questions on ‹title›:\n1. …" with every ad question, shown or not. */
  copyText: string
}

export interface CheatSheet {
  /** Lines were compared with the file's text (DOCX, PPTX, TXT). false for PDFs and images. */
  linesChecked: boolean
  /** "Landing-page brief · ad lines are lifted from page copy". */
  landingPage: boolean
  sell: SellRow
  /** null = hide the row. */
  say: SayRow | null
  put: PutRow
  /** Up to 3; empty = hide the row. */
  show: ShowItem[]
  /** Every shown caption says placeholder: add "(mockup boxes, not photos · real assets in Products ↑)". */
  showAllPlaceholders: boolean
  must: RuleList & {
    /** Old rows: mandatories dropped as page layout ("· 12 page-layout rules in Full read"). 0 for AI rules. */
    layoutRules: number
  }
  never: RuleList
  ask: AskRow
  fullRead: { lines: number; pages: number; rules: number }
}

/**
 * What a line is, for the viewer's "All text on this page":
 * ad = usable on an ad · offer = the offer line (copy only) · heading = "Brief heading" ·
 * image-slot = "Image slot: …" · note = "Note to the team" · text = everything else.
 */
export type LineRole = 'ad' | 'offer' | 'heading' | 'image-slot' | 'note' | 'text'

export interface PageLine {
  copyIndex: number
  kind: BriefCopyKind
  text: string
  location: string
  page: number | null
  verified: boolean | null
  role: LineRole
  /** Ranking inside "Use on an ad"; null when the line is not usable. */
  score: number | null
  /** Where "+ Deck" puts it; null for offer lines, CTAs, disclaimers and non-ad lines. */
  deckColumn: DeckColumn | null
  words: number
}

export interface BriefPicture {
  image: BriefImage
  caption: string
  captionFull: string
}

export interface BriefPageEntry {
  /** Position in `entries`: the viewer's state. */
  index: number
  key: string
  /** "p. 4", "slide 4", "picture 3" or "Brief". */
  label: string
  page: number | null
  pictures: BriefPicture[]
  /** PDF: the AI's one-line page summary. */
  summary: string
  /** PDF: the AI's description of the page's imagery, in full. */
  imagery: string
  hasImagery: boolean
  /** All text placed on this page, in document order. */
  lines: PageLine[]
  /** "Use on an ad": the 5 highest scores, shown in document order. */
  usable: PageLine[]
  usableCount: number
  /** The read was capped before this page: "No text kept for this page…". */
  noTextKept: boolean
}

export interface BriefPages {
  /** pdf = one entry per page · slides = one per slide · pictures = one per Word picture · single = one image · text = no pictures. */
  layout: 'pdf' | 'slides' | 'pictures' | 'single' | 'text'
  entries: BriefPageEntry[]
  /** Page or slide number → entry index. */
  pageIndex: Record<number, number>
  /** BriefImage.n → entry index. */
  imageIndex: Record<number, number>
  /** "By section" for DOCX and TXT (and any brief without page numbers): grouped by location, "" = Unplaced, last. */
  sections: { heading: string; lines: PageLine[] }[]
  /** PDF and PPTX lines whose location does not parse to a page. */
  unplaced: PageLine[]
  /** Set when the read kept only part of the copy. lastPage = the last page that has any. */
  truncated: { lastPage: number | null; kept: number } | null
  counts: { withCopy: number; withPictures: number; withAdLines: number; all: number }
}

export type OfferChip = {
  tone: 'ok' | 'info' | 'warn'
  text: string
  /** 'go-to-offer' = the chip carries "Go to Offer ↑" (scrolls to #creative-offer). */
  action: 'go-to-offer' | null
}

// ── Helpers (spec section 2) ─────────────────────────────────────────────

const STOPWORDS = new Set((
  "the and for with from your you our are was this that these those not but its it's into than then them they their " +
  'what who how why all any can get got has have had just more most much only own same such very will would about above ' +
  'after again also been being both did does each few here her his him off once other over some there under until when ' +
  'where which while'
).split(' '))

export const wordCount = (t: string): number => t.trim().split(/\s+/).filter(Boolean).length

/** matchKey words of 3+ characters (or with a digit), stopwords out. */
export const tokens = (t: string): string[] =>
  matchKey(t).split(' ').filter(w => (w.length >= 3 || /\d/.test(w)) && !STOPWORDS.has(w))

export const pageOf = (location: string): number | null => {
  const m = /^(?:p\.?|page|slide)\s*(\d+)/i.exec(location.trim())
  return m ? Number(m[1]) : null
}

// A number with thousands groups ("1,379", "1.379") and optional two decimals
// ("5.49", "1.379,00"), or a plain number.
const NUM = String.raw`\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`
const MONEY = new RegExp(String.raw`(?:A\$|AU\$|US\$|CA\$|NZ\$|[£$€])\s?(?:${NUM})|(?:${NUM})\s?€`, 'g')

const ONE_AMOUNT = `(?:${MONEY.source})`
/** "£99 £49", "£20 - £30": two amounts with nothing but a separator between them. */
const SIDE_BY_SIDE = new RegExp(`${ONE_AMOUNT}\\s*[-–—/|·]?\\s*${ONE_AMOUNT}`)
// Built at runtime: tsconfig targets ES2017, and TS rejects \p{..} literals below ES2018.
const LETTER = new RegExp('\\p{L}', 'u')

/**
 * Money amounts in a text as comparable keys, currency and cents:
 * "£1,299" and "£1299.00" → "£:129900"; "1.379,00 €" → "€:137900".
 */
export const moneyIn = (t: string): string[] =>
  (t.match(MONEY) ?? []).map(m => {
    const sign = (/A\$|AU\$|US\$|CA\$|NZ\$|[£$€]/.exec(m)?.[0] ?? '').replace(/^(AU|A)\$$/, 'A$')
    return `${sign}:${centsOf(m.replace(/[^\d.,]/g, ''))}`
  })

const centsOfKey = (key: string): number => Number(key.slice(key.indexOf(':') + 1))

// Cents, so a European "1.379,00 €" is not read as 1.379 and the struck price stays the bigger one.
const amountOf = centsOfKey

const endsPunct = (t: string): boolean => /[.!?]["')\]]?$/.test(t.trim())
const LISTY = /^(\d+[.)]\s|bonus\b)/i
const JARGON = /\b(wireframe|mock-?ups?|buy box|value stack|call to action|hero section|how it looks|the copy|layout|placeholder|section \d+|block \d+)\b/i
const WHOLE_TITLES = new Set(['hero', 'guarantee', 'faq', 'faqs', 'reviews', 'testimonials', 'header', 'footer'])
const CART = /\b(add to (cart|bag|basket)|checkout)\b/i
const LANDING = /\b(sales page|landing page|wireframe)\b/i

const PAGE_LAYOUT = /\b(sections?|blocks?|sticky|faqs?|buy box|ticker bars?|offer bar|testimonials?|full-width band|buttons?|comparison table|wireframe|mock-?ups?|hero|layout|first screen|above the fold|value stack|call to action|specs|add to cart)\b/i
const LOOK = /\b(colou?rs?|fonts?|typefaces?|logos?|palette)\b/i
const ON_AD = /\b(price|claims?|legal|returns?|delivery|guarantee|free|warranty|disclaimer)\b/i

const PAGE_ONLY_GAP = /\b(sticky|offer bar|faqs?|star rating|press logos?|testimonials?|buy box|sections?|ticker)\b/i
const GAP_OFFER = /\b(price|offer|dates?|deadline|ends?)\b/i
const GAP_SIZE = /\b(sizes?|ratios?|formats?|dimensions)\b/i
const GAP_MISC = /\b(cta|logos?|products?|quantit(y|ies)|how many)\b/i

const SHOW_GOOD = /\b(product|flat lay|packshot|pack shot|gallery|bundle)\b/i
const SHOW_BAD = /\b(badge|seal|logos?|icon)\b/i
const SHOW_KINDS = ['product', 'lifestyle', 'ad-example', 'mockup']

const COND_VALUE = /\b(free|worth|gift|bonus|off)\b|%/i
const COND_RISK = /\b(returns?|guarantee|trial|warranty)\b/i

export const DECK_CAP: Record<DeckColumn, number> = { ad_headlines: 5, ad_subcopies: 5, ad_eyebrows: 3 }
export const SLOT_DECK_COLUMN: Record<BriefSlot, DeckColumn | null> = {
  eyebrow: 'ad_eyebrows', headline: 'ad_headlines', subline: 'ad_subcopies', cta: null,
}
export const SLOT_LABELS: Record<BriefSlot, string> = { eyebrow: 'EYEBROW', headline: 'HEADLINE', subline: 'SUBLINE', cta: 'CTA' }

/** The viewer's "+ Deck": eyebrow → eyebrows; headline/tagline → headlines; subheadline/body → subcopies. */
export function deckColumnForKind(kind: BriefCopyKind): DeckColumn | null {
  if (kind === 'eyebrow') return 'ad_eyebrows'
  if (kind === 'headline' || kind === 'tagline') return 'ad_headlines'
  if (kind === 'subheadline' || kind === 'body') return 'ad_subcopies'
  return null
}

const deckList = (deck: BriefDeck, column: DeckColumn): string[] =>
  column === 'ad_headlines' ? deck.headlines : column === 'ad_subcopies' ? deck.subcopies : deck.eyebrows

export const inDeck = (deck: BriefDeck, column: DeckColumn, text: string): boolean => {
  const k = lineKey(text)
  return !!k && deckList(deck, column).some(t => lineKey(t) === k)
}

/** Same cap as ProjectEditForm's padArray, which drops extras when that form saves. */
export const deckFull = (deck: BriefDeck, column: DeckColumn): boolean =>
  deckList(deck, column).filter(t => t.trim()).length >= DECK_CAP[column]

/**
 * A mockup's imagery note → a short caption: the first item only, without
 * "Image placeholder for" and its quotes. Reads word it differently each time
 * ("Image placeholder for 'A', image placeholder for 'B'", "Image placeholder
 * 'A', 'B' and 'C'"), so the first quoted item wins whatever surrounds it.
 */
export function imageryCaption(imagery: string): string {
  // The opening quote must start a word: the apostrophe in "founder's" is not one.
  const quoted = /(?:^|[\s(:,])['"‘“](.+?)['"’”](?=[\s,.;:)]|$)/.exec(imagery)
  const t = quoted
    ? quoted[1]
    : imagery
      .replace(/^(?:an?\s+)?(?:image|video|photo|picture|graphic(?:\s+badge)?)\s+placeholders?\s*(?:(?:for|of)\s*)?[:-]?\s*/i, '')
      .split(/,\s*(?:an?\s+)?(?:image|video|photo|picture|graphic)[^,]*placeholder/i)[0]
  return t.trim().replace(/^['"‘“]|['"’”]$/g, '').replace(/[.,;:]+$/, '').trim()
}

const clamp = (t: string, max: number): string => {
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1)
  const at = cut.lastIndexOf(' ')
  return `${(at > max / 2 ? cut.slice(0, at) : cut).replace(/[\s.,;:–—-]+$/, '')}…`
}

type Scored = { i: number; s: number }
const rankTop = (list: Scored[], n: number): Scored[] =>
  list.slice().sort((a, b) => b.s - a.s || a.i - b.i).slice(0, n)

// ── Shared reading of one extraction ─────────────────────────────────────

interface Analysis {
  x: BriefExtraction
  pages: (number | null)[]
  priceCount: (t: string) => number
  title: boolean[]
  slotLabel: boolean[]
  offerLine: boolean[]
  /** Rules' ranked options per slot (full lists, not cut to 3). */
  ruleSlots: Record<BriefSlot, Scored[]>
  /** Best pool score per line, ignoring "doesn't contain the headline pick"; null = in no pool. */
  poolScore: (number | null)[]
  /** Copy indexes the AI picked. */
  picked: Set<number>
}

function analyze(x: BriefExtraction, pageCount: number | null): Analysis {
  const copy = x.copy
  const pages = copy.map(c => pageOf(c.location))
  const prices = new Set(x.offer.price_points.flatMap(moneyIn))
  const priceCount = (t: string) => new Set(moneyIn(t).filter(m => prices.has(m))).size
  const codeKey = matchKey(x.offer.code)
  const holdsCode = (t: string) => !!codeKey && ` ${matchKey(t)} `.includes(` ${codeKey} `)

  const maxPage = Math.max(0, pageCount ?? 0, ...x.pages.map(p => p.page), ...pages.map(p => p ?? 0))
  const third = Math.ceil(maxPage / 3)
  const early = (i: number) => ((pages[i] ?? 1) <= third ? 1 : 0)
  const docStyle = copy.filter(c => c.kind === 'body' && c.text.length > 140).length >= 5
  const titleKey = matchKey(x.title)

  // Rules decide only where the model did not: every line of an old row, and a
  // new row's line whose fit is missing.
  const isSectionTitle = (i: number): boolean => {
    const c = copy[i]
    if (c.fit !== null || !['headline', 'subheadline', 'other'].includes(c.kind)) return false
    const w = wordCount(c.text)
    if (i === 0 && (pages[0] ?? 1) === 1 && titleKey && matchKey(c.text) === titleKey) return true
    if (w <= 8 && !endsPunct(c.text) && (JARGON.test(c.text) || WHOLE_TITLES.has(matchKey(c.text)))) return true
    // A short heading followed by what it heads. Document-style briefs only: in a
    // short ad brief a 3-word headline before a longer one is an alternative, not a title.
    if (docStyle && w <= 7 && !endsPunct(c.text) && !/[\d£$€%]/.test(c.text) && i + 1 < copy.length) {
      const n = copy[i + 1]
      const pa = pages[i], pb = pages[i + 1]
      const near = pa === null || pb === null || (pb - pa >= 0 && pb - pa <= 1)
      if (near && (
        (n.kind === 'headline' && wordCount(n.text) >= w + 3) ||
        n.kind === 'eyebrow' ||
        (n.kind === 'body' && n.text.length > 140)
      )) return true
    }
    return false
  }
  const title = copy.map((_, i) => isSectionTitle(i))

  const imageryKey = new Map(x.pages.filter(p => p.imagery).map(p => [p.page, ` ${matchKey(p.imagery)} `]))
  const slotLabel = copy.map((c, i) => {
    if (c.fit !== null || pages[i] === null || wordCount(c.text) < 2) return false
    const hay = imageryKey.get(pages[i] as number)
    const k = matchKey(c.text)
    return !!hay && !!k && hay.includes(` ${k} `)
  })

  const offerLine = copy.map((c, i) =>
    !c.text.includes('\n') && !title[i] && !slotLabel[i] &&
    priceCount(c.text) >= 2 && wordCount(c.text) >= 4 && wordCount(c.text) <= 16)

  const msg = new Set(tokens(`${x.angles[0] ?? ''} ${x.title}`))
  const onMessage = (t: string) => tokens(t).filter(w => msg.has(w)).length >= 2
  const productKeys = new Set([x.offer.name, ...x.products.map(p => p.name)].filter(Boolean).map(matchKey))
  const unverified = (i: number) => (copy[i].verified === false ? -5 : 0)

  // Every slot: no multi-line text, section titles, image-slot labels, or lines
  // with two prices side by side. Unverified lines stay, 5 points down, flagged.
  const base = (i: number) =>
    !copy[i].text.includes('\n') && !title[i] && !slotLabel[i] && priceCount(copy[i].text) < 2

  const inHeadline = (i: number) => {
    const c = copy[i], w = wordCount(c.text)
    return (c.kind === 'headline' || c.kind === 'tagline') && base(i) && w >= 2 && w <= 12 &&
      !productKeys.has(matchKey(c.text)) && !LISTY.test(c.text)
  }
  const headlineScore = (i: number) => {
    const t = copy[i].text
    return (onMessage(t) ? 3 : 0) + (priceCount(t) === 1 || holdsCode(t) ? 2 : 0) +
      (wordCount(t) <= 8 ? 2 : 0) + early(i) + unverified(i)
  }
  const all = copy.map((_, i) => i)
  const headlines = rankTop(all.filter(inHeadline).map(i => ({ i, s: headlineScore(i) })), copy.length)

  // Same-page and "right after it" bonuses hang off the headline in first place:
  // the AI's first headline pick on new rows, the rules' on old ones.
  const aiHeadline = x.ad_picks.find(p => p.slot === 'headline')
  const h0 = x.ai_picks ? (aiHeadline ? aiHeadline.copy_index : null) : (headlines[0]?.i ?? null)
  const samePage = (i: number) => h0 !== null && pages[i] !== null && pages[i] === pages[h0]
  const h0Key = h0 !== null ? matchKey(copy[h0].text) : ''

  const inEyebrow = (i: number) => copy[i].kind === 'eyebrow' && base(i) && wordCount(copy[i].text) <= 6
  const eyebrowScore = (i: number) =>
    (samePage(i) ? 2 : 0) + (onMessage(copy[i].text) ? 3 : 0) + early(i) + unverified(i)

  const inSubline = (i: number) => {
    const c = copy[i], w = wordCount(c.text)
    return (c.kind === 'subheadline' || c.kind === 'tagline' || c.kind === 'body') && base(i) &&
      w >= 4 && w <= 16 && !/:\s*$/.test(c.text) && !LISTY.test(c.text)
  }
  const containsHeadline = (i: number) => !!h0Key && i !== h0 && matchKey(copy[i].text).includes(h0Key)
  const firstAfter = h0 === null ? null : all.find(i => i > h0 && samePage(i) && inSubline(i) && !containsHeadline(i)) ?? null
  const sublineScore = (i: number) =>
    (i === firstAfter ? 3 : 0) + (onMessage(copy[i].text) ? 3 : 0) +
    (priceCount(copy[i].text) === 1 ? 2 : 0) + early(i) + unverified(i)

  const inCta = (i: number) => copy[i].kind === 'cta' && base(i) && wordCount(copy[i].text) <= 6
  const ctaScore = (i: number) =>
    (samePage(i) ? 2 : 0) + (priceCount(copy[i].text) === 1 ? 2 : 0) + early(i) +
    (CART.test(copy[i].text) ? -2 : 0) + unverified(i)

  const ruleSlots: Record<BriefSlot, Scored[]> = {
    eyebrow: rankTop(all.filter(inEyebrow).map(i => ({ i, s: eyebrowScore(i) })), copy.length),
    headline: headlines,
    subline: rankTop(all.filter(i => inSubline(i) && !containsHeadline(i)).map(i => ({ i, s: sublineScore(i) })), copy.length),
    cta: rankTop(all.filter(inCta).map(i => ({ i, s: ctaScore(i) })), copy.length),
  }

  // A line can serve on an ad whatever got picked, so the page count ignores
  // "doesn't contain the headline pick".
  const poolScore = copy.map((_, i) => {
    const s: number[] = []
    if (inEyebrow(i)) s.push(eyebrowScore(i))
    if (inHeadline(i)) s.push(headlineScore(i))
    if (inSubline(i)) s.push(sublineScore(i))
    if (inCta(i)) s.push(ctaScore(i))
    return s.length ? Math.max(...s) : null
  })

  return {
    x, pages, priceCount, title, slotLabel, offerLine, ruleSlots, poolScore,
    picked: new Set(x.ai_picks ? x.ad_picks.map(p => p.copy_index) : []),
  }
}

/**
 * Old rows: a line is usable when a slot pool takes it. New rows: when the model
 * said fit "ad", or picked it (a pick marked "long" must still be on its page in
 * the viewer, or the card's p. N chip opens a page that does not list it).
 * Offer lines always, at 2.
 */
function lineRole(a: Analysis, i: number): { role: LineRole; score: number | null } {
  const c = a.x.copy[i]
  if (a.offerLine[i]) return { role: 'offer', score: 2 }
  if (c.fit === 'note') return { role: 'note', score: null }
  if (c.fit === null && a.title[i]) return { role: 'heading', score: null }
  if (c.fit === null && a.slotLabel[i]) return { role: 'image-slot', score: null }
  if (c.fit === 'ad' || a.picked.has(i)) return { role: 'ad', score: (a.picked.has(i) ? 10 : 0) + (a.poolScore[i] ?? 0) }
  if (c.fit === null && a.poolScore[i] !== null) return { role: 'ad', score: a.poolScore[i] }
  return { role: 'text', score: null }
}

function imageFor(images: BriefImage[], page: number | null): BriefImage | null {
  if (page === null) return null
  return images.find(im => im.page === page && (im.source === 'pdf-page' || im.source === 'pptx')) ?? null
}

// ── The card ─────────────────────────────────────────────────────────────

export function buildCheatSheet(x: BriefExtraction, images: BriefImage[], pageCount: number | null): CheatSheet {
  const a = analyze(x, pageCount)
  const copy = x.copy

  // 1 SELL
  const product = x.offer.name || x.products[0]?.name || ''
  const productKey = matchKey(product)
  const otherProducts = x.products.map(p => p.name).filter(n => matchKey(n) !== productKey)
  const prices = x.offer.price_points
  const price = sellPrice(x)

  // The best value line and the best risk-reversal line before a second of either.
  const tier = (t: string) => (COND_VALUE.test(t) ? 1 : COND_RISK.test(t) ? 2 : 3)
  const ranked = x.offer.conditions.map((t, i) => ({ t, i, tier: tier(t) }))
    .sort((p, q) => p.tier - q.tier || p.i - q.i)
  const lead = [ranked.find(r => r.tier === 1), ranked.find(r => r.tier === 2)].filter((r): r is (typeof ranked)[number] => !!r)
  const conditions = [...lead, ...ranked.filter(r => !lead.includes(r))].slice(0, 2)

  const offerIdx = copy.map((c, i) => ({ i, w: wordCount(c.text) })).filter(o => a.offerLine[o.i])
    .sort((p, q) => p.w - q.w || p.i - q.i)[0]?.i
  const offerLine: OfferLine | null = offerIdx === undefined ? null : {
    text: copy[offerIdx].text, copyIndex: offerIdx, location: copy[offerIdx].location,
    page: a.pages[offerIdx], image: imageFor(images, a.pages[offerIdx]),
  }

  const sell: SellRow = {
    product,
    products: otherProducts.slice(0, 3),
    moreProducts: Math.max(0, otherProducts.length - 3),
    price,
    conditions: conditions.map(r => r.t),
    moreConditions: Math.max(0, x.offer.conditions.length - conditions.length),
    offerLine,
    empty: !product && !prices.length,
  }

  // 2 SAY
  let say: SayRow | null = null
  if (x.angles.length) {
    const k = matchKey(x.angles[0])
    const at = k ? copy.findIndex(c => ` ${matchKey(c.text)} `.includes(` ${k} `)) : -1
    const page = at >= 0 ? a.pages[at] : null
    say = {
      source: 'angle', text: x.angles[0], verbatim: at >= 0, page, image: imageFor(images, page),
      moreAngles: x.angles.length - 1,
    }
  } else {
    const t = copy.findIndex(c => c.kind === 'tagline')
    if (t >= 0) say = { source: 'tagline', text: copy[t].text, page: a.pages[t], image: imageFor(images, a.pages[t]), moreAngles: 0 }
  }

  // 3 PUT ON THE AD
  const slotLine = (slot: BriefSlot, i: number, text: string, sentence: boolean): SlotLine => ({
    text, copyIndex: i, kind: copy[i].kind, location: copy[i].location, page: a.pages[i],
    image: imageFor(images, a.pages[i]), verified: copy[i].verified, sentence, deckColumn: SLOT_DECK_COLUMN[slot],
  })
  // The prompt forbids these picks and the model makes them anyway (seen on a
  // real landing-page re-read: a "was £X now £Y" line as a headline, and the
  // document's own title). Dropping one is not padding: nothing from the rules
  // takes its place.
  const titleKey = matchKey(x.title)
  const badPick = (text: string, i: number) =>
    SIDE_BY_SIDE.test(text) ||
    !LETTER.test(text.replace(MONEY, ' ')) ||
    (i === 0 && !!titleKey && matchKey(text) === titleKey)
  const slots = {} as Record<BriefSlot, SlotLine[]>
  for (const slot of BRIEF_SLOTS) {
    slots[slot] = x.ai_picks
      ? x.ad_picks.filter(p => p.slot === slot && copy[p.copy_index] && !badPick(p.text, p.copy_index)).slice(0, 3)
        .map(p => slotLine(slot, p.copy_index, p.text, p.sentence))
      : a.ruleSlots[slot].slice(0, 3).map(o => slotLine(slot, o.i, copy[o.i].text, false))
  }
  const put: PutRow = {
    source: x.ai_picks ? 'ai' : 'rules',
    slots,
    empty: BRIEF_SLOTS.every(s => slots[s].length === 0),
  }

  // 4 SHOW
  const productTokens = new Set(x.products.flatMap(p => tokens(p.name)))
  const showScore = (t: string) =>
    (SHOW_GOOD.test(t) ? 2 : 0) + new Set(tokens(t).filter(w => productTokens.has(w))).size - (SHOW_BAD.test(t) ? 3 : 0)
  type ShowCand = { i: number; s: number; item: ShowItem }
  const cands: ShowCand[] = []
  const pdfPages = images.filter(im => im.source === 'pdf-page')
  if (pdfPages.length) {
    for (const p of x.pages) {
      const im = p.has_imagery ? pdfPages.find(q => q.page === p.page) : undefined
      if (!im) continue
      const full = imageryCaption(p.imagery)
      cands.push({
        i: p.page, s: showScore(p.imagery),
        item: { image: im, page: p.page, caption: clamp(full, 60), captionFull: full, placeholder: /placeholder/i.test(p.imagery) },
      })
    }
  } else {
    for (const c of x.images) {
      const im = images.find(q => q.n === c.id)
      if (!im || !SHOW_KINDS.includes(c.kind)) continue
      cands.push({
        i: c.id, s: showScore(c.caption),
        item: { image: im, page: im.page, caption: clamp(c.caption, 60), captionFull: c.caption, placeholder: /placeholder/i.test(c.caption) },
      })
    }
  }
  const show = cands.slice().sort((p, q) => q.s - p.s || p.i - q.i).slice(0, 3).map(c => c.item)

  // MUST · NEVER
  let must: CheatSheet['must']
  let never: RuleList
  if (x.ai_picks) {
    const m = x.ad_rules.filter(r => r.type === 'must').map(r => r.text)
    const n = x.ad_rules.filter(r => r.type === 'never').map(r => r.text)
    must = { items: m.slice(0, 3), total: m.length, source: 'ai', layoutRules: 0 }
    never = { items: n.slice(0, 3), total: n.length, source: 'ai' }
  } else {
    const kept = x.mandatories.map((t, i) => ({ t, i })).filter(o => !PAGE_LAYOUT.test(o.t))
    const top = rankTop(kept.map(o => ({
      i: o.i, s: (LOOK.test(o.t) ? 2 : 0) + (ON_AD.test(o.t) ? 1 : 0) + (/\d/.test(o.t) ? 1 : 0),
    })), 3)
    must = {
      items: top.map(o => x.mandatories[o.i]), total: x.mandatories.length, source: 'rules',
      layoutRules: x.mandatories.length - kept.length,
    }
    // Donts in their own order, never filtered: a rule must never hide a don't.
    never = { items: x.donts.slice(0, 3), total: x.donts.length, source: 'rules' }
  }

  // 5 ASK THE CLIENT
  const computed: string[] = []
  if (!x.offer.price_points.length) computed.push('What price goes on the ad?')
  if (!slots.headline.length) computed.push('Which headline should the ad use?')
  const adGaps = x.gaps.map((t, i) => ({ t, i })).filter(o => !PAGE_ONLY_GAP.test(o.t))
  const rankedGaps = rankTop(adGaps.map(o => ({
    i: o.i,
    s: (GAP_OFFER.test(o.t) ? 2 : 0) + (GAP_SIZE.test(o.t) ? 2 : 0) + (GAP_MISC.test(o.t) ? 1 : 0),
  })), x.gaps.length).map(o => x.gaps[o.i])
  const questions = [
    ...computed.map(text => ({ text, computed: true })),
    ...rankedGaps.map(text => ({ text, computed: false })),
  ]
  const ask: AskRow = {
    items: questions.slice(0, 3),
    more: Math.max(0, questions.length - 3),
    pageOnly: x.gaps.length - adGaps.length,
    copyText: questionsText(x.title, questions.map(q => q.text)),
  }

  const maxCopyPage = Math.max(0, ...a.pages.map(p => p ?? 0), ...x.pages.map(p => p.page))
  return {
    linesChecked: copy.some(c => c.verified !== null),
    landingPage: x.brief_type ? x.brief_type === 'landing-page' : LANDING.test(x.summary),
    sell, say, put, show,
    showAllPlaceholders: show.length > 0 && show.every(s => s.placeholder),
    must, never, ask,
    fullRead: {
      lines: copy.length,
      pages: pageCount ?? maxCopyPage,
      rules: x.mandatories.length + x.dos.length + x.donts.length + x.ad_rules.length,
    },
  }
}

// ── The page viewer and Full read ────────────────────────────────────────

const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export function buildBriefPages(x: BriefExtraction, images: BriefImage[], mime: string, pageCount: number | null): BriefPages {
  const a = analyze(x, pageCount)
  const layout: BriefPages['layout'] =
    mime === 'application/pdf' ? 'pdf'
      : mime === PPTX ? 'slides'
        : mime === DOCX ? 'pictures'
          : mime.startsWith('image/') ? 'single'
            : 'text'

  const lines: PageLine[] = x.copy.map((c, i) => {
    const { role, score } = lineRole(a, i)
    return {
      copyIndex: i, kind: c.kind, text: c.text, location: c.location, page: a.pages[i], verified: c.verified,
      role, score, words: wordCount(c.text),
      // Only what the deck accepts: one line, 300 characters at most (checkDeckLines refuses the rest).
      deckColumn: role === 'ad' && c.text.length <= 300 && !/[\r\n]/.test(c.text) ? deckColumnForKind(c.kind) : null,
    }
  })

  // The model's page numbers stop where the stored copy stopped. An old row kept
  // 150 lines; a new one says so with copy_capped.
  const capped = x.copy_capped || (!x.ai_picks && x.copy.length === 150)
  const pagesWithCopy = lines.map(l => l.page).filter((p): p is number => p !== null)
  const lastPage = pagesWithCopy.length ? Math.max(...pagesWithCopy) : null
  const truncated = capped ? { lastPage, kept: x.copy.length } : null

  const captionOf = (im: BriefImage): string => {
    if (im.source === 'pdf-page') return imageryCaption(x.pages.find(p => p.page === im.page)?.imagery ?? '')
    return x.images.find(c => c.id === im.n)?.caption ?? ''
  }
  const picture = (im: BriefImage): BriefPicture => {
    const full = captionOf(im)
    return { image: im, caption: clamp(full, 60), captionFull: full }
  }

  const entry = (
    key: string, label: string, page: number | null, pics: BriefImage[], pageLines: PageLine[], hasImagery?: boolean,
  ): Omit<BriefPageEntry, 'index'> => {
    const usableAll = pageLines.filter(l => l.score !== null)
    const top = new Set(rankTop(usableAll.map(l => ({ i: l.copyIndex, s: l.score as number })), 5).map(o => o.i))
    const info = page !== null && layout === 'pdf' ? x.pages.find(p => p.page === page) : undefined
    return {
      key, label, page,
      pictures: pics.map(picture),
      summary: info?.summary ?? '',
      imagery: info?.imagery ?? '',
      hasImagery: hasImagery ?? pics.length > 0,
      lines: pageLines,
      usable: pageLines.filter(l => top.has(l.copyIndex)),
      usableCount: usableAll.length,
      noTextKept: !!truncated && page !== null && pageLines.length === 0 && (lastPage === null || page > lastPage),
    }
  }

  const raw: Omit<BriefPageEntry, 'index'>[] = []
  const byPage = (n: number) => lines.filter(l => l.page === n)
  const sortedImages = images.slice().sort((p, q) => p.n - q.n)

  if (layout === 'pdf' || layout === 'slides') {
    const src = layout === 'pdf' ? 'pdf-page' : 'pptx'
    const numbered = sortedImages.filter(im => im.source === src && im.page !== null)
    const last = Math.max(
      0, pageCount ?? 0, ...x.pages.map(p => p.page), ...pagesWithCopy, ...numbered.map(im => im.page as number),
    )
    for (let n = 1; n <= last; n++) {
      const pics = numbered.filter(im => im.page === n)
      const info = layout === 'pdf' ? x.pages.find(p => p.page === n) : undefined
      raw.push(entry(
        `${layout}-${n}`, layout === 'pdf' ? `p. ${n}` : `slide ${n}`, n,
        layout === 'pdf' ? pics.slice(0, 1) : pics, byPage(n),
        layout === 'pdf' ? info?.has_imagery === true : undefined,
      ))
    }
    // A deck picture with no slide number still gets shown, after the slides.
    for (const im of sortedImages.filter(im => im.source === src && im.page === null)) {
      raw.push(entry(`picture-${im.n}`, `picture ${im.n}`, null, [im], []))
    }
  } else if (layout === 'pictures') {
    for (const im of sortedImages) raw.push(entry(`picture-${im.n}`, `picture ${im.n}`, null, [im], []))
  } else if (layout === 'single') {
    raw.push(entry('single', 'Brief', null, sortedImages, lines))
  } else if (sortedImages.length) {
    for (const im of sortedImages) raw.push(entry(`picture-${im.n}`, `picture ${im.n}`, null, [im], []))
  }

  const entries: BriefPageEntry[] = raw.map((e, index) => ({ ...e, index }))
  const pageIndex: Record<number, number> = {}
  const imageIndex: Record<number, number> = {}
  for (const e of entries) {
    if (e.page !== null && pageIndex[e.page] === undefined) pageIndex[e.page] = e.index
    for (const p of e.pictures) if (imageIndex[p.image.n] === undefined) imageIndex[p.image.n] = e.index
  }

  // "By section": the location heading each line sits under, in first-seen
  // order, with lines that have none last as Unplaced.
  const groups = new Map<string, PageLine[]>()
  for (const l of lines) {
    const h = layout === 'pdf' || layout === 'slides' ? (l.page === null ? '' : l.location) : l.location
    if (!groups.has(h)) groups.set(h, [])
    groups.get(h)!.push(l)
  }
  const sections = Array.from(groups, ([heading, ls]) => ({ heading, lines: ls }))
    .sort((p, q) => (p.heading === '' ? 1 : 0) - (q.heading === '' ? 1 : 0))

  return {
    layout, entries, pageIndex, imageIndex, sections,
    unplaced: layout === 'pdf' || layout === 'slides' ? lines.filter(l => l.page === null) : [],
    truncated,
    counts: {
      withCopy: entries.filter(e => e.lines.length > 0).length,
      withPictures: entries.filter(e => e.hasImagery).length,
      withAdLines: entries.filter(e => e.usableCount > 0).length,
      all: entries.length,
    },
  }
}

// ── Price check against the project's Offer section ──────────────────────

/**
 * A number as an amount in cents. Two digits after the last separator are the
 * decimals ("£5.49", "1.379,00 €"); any other separator groups thousands
 * ("£1,379", "1.379"). So £5.49 is never £549.
 */
function centsOf(num: string): number {
  const dec = /[.,](\d{2})$/.exec(num)
  const whole = (dec ? num.slice(0, -3) : num).replace(/\D/g, '')
  return Number(whole || '0') * 100 + (dec ? Number(dec[1]) : 0)
}

/**
 * Amounts in the Offer text, in cents. A number with a currency sign always
 * counts; a bare one ("549") counts only when it is not a percentage, a count of
 * days/weeks/months/years or a quantity, so "30-day returns" never confirms a
 * $30 price.
 */
function offerAmounts(text: string): Set<number> {
  const out = new Set<number>()
  const re = /(A\$|AU\$|US\$|CA\$|NZ\$|[£$€])?\s?(\d[\d.,]*\d|\d)(\s?€)?(?=(\s?-?\s?(?:%|percent\b|days?\b|nights?\b|weeks?\b|months?\b|years?\b|yrs?\b|hours?\b|x\b|packs?\b|pcs?\b|pieces?\b|items?\b|ml\b|kg\b|g\b|oz\b|lbs?\b|cm\b|mm\b))?)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const priced = !!(m[1] || m[3])
    if (!priced && m[4]) continue
    out.add(centsOf(m[2]))
  }
  return out
}

/**
 * Prices, percentages and the code only, never prose. `offerText` is the
 * project's offer + offer_description + retail_price + discount + tiered_offer.
 */
export function offerCheck(x: BriefExtraction, offerText: string): OfferChip[] {
  if (!offerText.trim()) {
    return x.offer.price_points.length || x.offer.code
      ? [{ tone: 'warn', text: 'Offer section is empty', action: 'go-to-offer' }]
      : []
  }
  const amounts = offerAmounts(offerText)
  const hasAmount = (price: string) => {
    const keys = moneyIn(price)
    return keys.length > 0 && keys.every(k => amounts.has(centsOfKey(k)))
  }
  const hasPercent = (price: string) => {
    const m = /(\d+(?:[.,]\d+)?)\s?%/.exec(price)
    return !!m && new RegExp(`(^|[^\\d.,])${m[1].replace(/[.,]/g, '[.,]')}\\s?%`).test(offerText)
  }

  const chips: OfferChip[] = []
  const miss = (p: string): OfferChip => ({ tone: 'warn', text: `Check: ${p} is not in the Offer section`, action: 'go-to-offer' })
  const sheet = sellPrice(x)
  if (sheet?.kind === 'strike') {
    chips.push(hasAmount(sheet.now) ? { tone: 'ok', text: `${sheet.now} in Offer ✓`, action: null } : miss(sheet.now))
    chips.push(hasAmount(sheet.was)
      ? { tone: 'ok', text: `${sheet.was} in Offer ✓`, action: null }
      : { tone: 'info', text: `${sheet.was} comparison price · brief only`, action: null })
  } else {
    for (const p of x.offer.price_points.slice(0, 3)) {
      const checkable = moneyIn(p).length > 0 || /\d\s?%/.test(p)
      if (!checkable) continue
      const found = moneyIn(p).length > 0 ? hasAmount(p) : hasPercent(p)
      chips.push(found ? { tone: 'ok', text: `${p} in Offer ✓`, action: null } : miss(p))
    }
  }
  if (x.offer.code) {
    const found = ` ${matchKey(offerText)} `.includes(` ${matchKey(x.offer.code)} `)
    chips.push(found
      ? { tone: 'ok', text: `Code ${x.offer.code} in Offer ✓`, action: null }
      : { tone: 'warn', text: `Check: code ${x.offer.code} is not in the Offer section`, action: 'go-to-offer' })
  }
  return chips
}

/**
 * Strike through the larger price only when there are exactly two and one copy
 * line holds both ("£99 £49"); anything else is chips, words as written.
 */
function sellPrice(x: BriefExtraction): SellPrice | null {
  const prices = x.offer.price_points
  if (!prices.length) return null
  const keys = prices.map(moneyIn)
  const pair = prices.length === 2 && keys.every(k => k.length === 1) &&
    amountOf(keys[0][0]) !== amountOf(keys[1][0]) &&
    x.copy.some(c => { const m = new Set(moneyIn(c.text)); return m.has(keys[0][0]) && m.has(keys[1][0]) })
  if (pair) {
    const big = amountOf(keys[0][0]) > amountOf(keys[1][0]) ? 0 : 1
    return { kind: 'strike', was: prices[big], now: prices[1 - big] }
  }
  return { kind: 'chips', chips: prices.slice(0, 3), more: Math.max(0, prices.length - 3) }
}

// ── Clipboard text ───────────────────────────────────────────────────────

/** "EYEBROW: …\nHEADLINE: …", empty slots skipped. `chosen` = the option each slot is cycled to (default 0). */
export function copyPicksText(put: PutRow, chosen: Partial<Record<BriefSlot, number>> = {}): string {
  return BRIEF_SLOTS
    .map(slot => ({ slot, line: put.slots[slot][chosen[slot] ?? 0] }))
    .filter(o => !!o.line)
    .map(o => `${SLOT_LABELS[o.slot]}: ${o.line.text}`)
    .join('\n')
}

/** The shown picks that "+ Add N to Copy deck" would send: eyebrow, headline and subline not already in the deck. */
export function picksForDeck(
  put: PutRow, deck: BriefDeck, chosen: Partial<Record<BriefSlot, number>> = {},
): { column: DeckColumn; text: string; verified: boolean | null }[] {
  return BRIEF_SLOTS.flatMap(slot => {
    const line = put.slots[slot][chosen[slot] ?? 0]
    const column = SLOT_DECK_COLUMN[slot]
    return line && column && !inDeck(deck, column, line.text) ? [{ column, text: line.text, verified: line.verified }] : []
  })
}

export const questionsText = (title: string, questions: string[]): string =>
  questions.length
    ? `Questions on ${title || 'the brief'}:\n${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`
    : ''
