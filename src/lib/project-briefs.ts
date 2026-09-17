// Creative briefs uploaded to a project, and what the AI read out of them.
//
// No directive: the browser uses the limits, types and readers; the server
// enforces the same limits. The AI's output is stored raw in
// project_briefs.extraction and is ALWAYS read back through
// normalizeBriefExtraction — a model's JSON is not a type, and a row written
// by an older prompt must still render.

import { MB, resolveDocTypeIn, safeDocNameIn, type DocTypeSpec } from './doc-files'

export const BRIEF_BUCKET = 'project-briefs'
export const BRIEF_MODEL = 'gemini-2.5-flash'

export const BRIEF_TYPES: Record<string, DocTypeSpec> = {
  'application/pdf': { ext: 'pdf', label: 'PDF', inline: true, opensIn: null },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    { ext: 'pptx', label: 'PPTX', inline: false, opensIn: 'PowerPoint' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    { ext: 'docx', label: 'DOCX', inline: false, opensIn: 'Word' },
  'text/plain': { ext: 'txt', label: 'TXT', inline: true, opensIn: null },
  'image/png': { ext: 'png', label: 'PNG', inline: true, opensIn: null },
  'image/jpeg': { ext: 'jpg', label: 'JPG', inline: true, opensIn: null },
  'image/webp': { ext: 'webp', label: 'WEBP', inline: true, opensIn: null },
}

export const BRIEF_ACCEPT = [
  '.pdf', '.pptx', '.docx', '.txt', '.png', '.jpg', '.jpeg', '.webp',
  ...Object.keys(BRIEF_TYPES),
].join(',')

export const resolveBriefType = (file: { name: string; type: string }): string | null =>
  resolveDocTypeIn(BRIEF_TYPES, file, { jpeg: 'image/jpeg' })

export const safeBriefName = (raw: string, contentType: string): string =>
  safeDocNameIn(BRIEF_TYPES, raw, contentType)

// MUST equal the project-briefs bucket's file_size_limit (52428800).
export const MAX_BRIEF_BYTES = 50 * MB
export const MAX_BRIEF_IMAGES = 40        // pictures pulled from a PPTX/DOCX
export const MAX_PDF_PREVIEW_PAGES = 40   // pages drawn from a PDF
export const IMAGE_FULL_PX = 1600
export const IMAGE_THUMB_PX = 768         // also what the model sees: one 768px tile = 258 tokens
export const MIN_IMAGE_PX = 150           // both sides smaller = an icon or bullet, skipped
export const STALE_READING_MS = 330_000   // route maxDuration 300s + 30s
/** Signed picture URLs. The reader re-signs 10 minutes before they expire. */
export const BRIEF_IMAGE_URL_TTL_SECONDS = 3600

export const briefSourcePath = (projectId: string, briefId: string, ext: string): string =>
  `${projectId}/${briefId}/source.${ext}`

export const briefImagePath = (
  projectId: string, briefId: string, n: number, size: 'full' | 'thumb', ext: 'webp' | 'jpg',
): string => `${projectId}/${briefId}/img-${String(n).padStart(3, '0')}-${size}.${ext}`

export const isReadingStale = (
  b: { extraction_status: string; extraction_started_at: string | null }, now: number,
): boolean =>
  b.extraction_status === 'reading' &&
  (!b.extraction_started_at || now - Date.parse(b.extraction_started_at) > STALE_READING_MS)

// ── Stored images ────────────────────────────────────────────────────────

export type BriefImageSource = 'pdf-page' | 'pptx' | 'docx' | 'upload'

export interface BriefImage {
  n: number
  /** PDF page or PPTX slide; null for Word and single-image briefs. */
  page: number | null
  source: BriefImageSource
  full: string
  thumb: string
  w: number
  h: number
}

const IMAGE_SOURCES: readonly string[] = ['pdf-page', 'pptx', 'docx', 'upload']

export function readBriefImages(raw: unknown): BriefImage[] {
  return recs(raw, 80)
    .flatMap((o): BriefImage[] => {
      const n = posInt(o.n)
      const full = str(o.full, 400)
      const thumb = str(o.thumb, 400)
      if (!n || !full || !thumb) return []
      return [{
        n, page: posInt(o.page) || null,
        source: IMAGE_SOURCES.includes(o.source as string) ? (o.source as BriefImageSource) : 'upload',
        full, thumb, w: posInt(o.w), h: posInt(o.h),
      }]
    })
    .sort((a, b) => a.n - b.n)
}

// ── The AI read ──────────────────────────────────────────────────────────

export const COPY_KINDS = ['headline', 'subheadline', 'body', 'cta', 'eyebrow', 'tagline', 'disclaimer', 'other'] as const
export type BriefCopyKind = (typeof COPY_KINDS)[number]
export const COPY_LABELS: Record<BriefCopyKind, string> = {
  headline: 'Headlines', subheadline: 'Subheadlines', body: 'Body copy', cta: 'Calls to action',
  eyebrow: 'Eyebrows', tagline: 'Taglines', disclaimer: 'Disclaimers', other: 'Other copy',
}
export const IMAGE_KINDS = ['product', 'lifestyle', 'mockup', 'ad-example', 'inspiration', 'logo', 'chart', 'screenshot', 'other'] as const

/** The stored copy list keeps this many lines. A 24-page landing-page brief ran past the old 150 at p. 16. */
export const MAX_BRIEF_COPY = 250

export const COPY_FITS = ['ad', 'long', 'note'] as const
export type BriefCopyFit = (typeof COPY_FITS)[number]

export interface BriefCopy {
  kind: BriefCopyKind
  text: string
  location: string
  /** true/false = checked against the file's text (DOCX/PPTX/TXT). null = could not check (PDF, image). */
  verified: boolean | null
  /**
   * The model's judgement: "ad" fits one static image as written, "long" is
   * page copy, "note" is a note to the team. null on rows read before the
   * field existed; the cheat sheet's rules decide for those lines.
   */
  fit: BriefCopyFit | null
}

export const BRIEF_SLOTS = ['eyebrow', 'headline', 'subline', 'cta'] as const
export type BriefSlot = (typeof BRIEF_SLOTS)[number]

/** A line the model chose for one slot of a static ad. Always the BRIEF's words, never the model's. */
export interface BriefPick {
  slot: BriefSlot
  text: string
  /** Index into `copy`. The UI reads location and verified from there. */
  copy_index: number
  /** true when the pick is one whole sentence of a longer copy line. */
  sentence: boolean
}

export const BRIEF_TYPE_VALUES = ['ad', 'landing-page', 'campaign', 'other'] as const
export type BriefType = (typeof BRIEF_TYPE_VALUES)[number]

export interface BriefAdRule { type: 'must' | 'never'; text: string; location: string }

export interface BriefExtraction {
  title: string
  summary: string
  offer: { name: string; mechanic: string; price_points: string[]; code: string; dates: string; conditions: string[] }
  products: { name: string; details: string }[]
  audience: { who: string; pains: string[]; desires: string[] }
  angles: string[]
  tone: string[]
  copy: BriefCopy[]
  deliverables: { format: string; sizes: string; quantity: string; notes: string }[]
  mandatories: string[]
  dos: string[]
  donts: string[]
  references: { description: string; url: string | null; location: string }[]
  pages: { page: number; summary: string; has_imagery: boolean; imagery: string }[]
  images: { id: number; caption: string; kind: string }[]
  gaps: string[]
  reading_notes: string
  /** true when the read asked for ad_picks (even if it found none). false = an older read: rules pick instead. */
  ai_picks: boolean
  ad_picks: BriefPick[]
  /** Rules for what goes ON a static ad image. Empty on older reads. */
  ad_rules: BriefAdRule[]
  /** '' on older reads. */
  brief_type: '' | BriefType
  /** true when the model returned more copy than MAX_BRIEF_COPY and the rest was dropped. */
  copy_capped: boolean
}

// Array.from splits by code point, not UTF-16 unit: .slice(0, max) could cut an
// emoji in half, leaving a lone surrogate that Postgres jsonb rejects — and the
// whole finished read was then saved as failed.
const str = (v: unknown, max = 2000): string =>
  typeof v === 'string' ? Array.from(v.replace(/\u0000/g, '').trim()).slice(0, max).join('') : ''
const strs = (v: unknown, maxItems = 30, maxLen = 600): string[] =>
  Array.isArray(v) ? Array.from(new Set(v.map(x => str(x, maxLen)).filter(Boolean))).slice(0, maxItems) : []
const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
function recs(v: unknown, maxItems: number): Record<string, unknown>[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)).slice(0, maxItems)
}
const posInt = (v: unknown): number =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 100_000 ? v : 0
const httpUrl = (v: unknown): string | null => {
  const u = str(v, 2000)
  return /^https?:\/\/\S+$/i.test(u) ? u : null
}

// Built at runtime: tsconfig targets ES2017, and TS rejects \p{..} literals below ES2018.
const NON_WORD = new RegExp('[^\\p{L}\\p{N}]+', 'gu')
/** Case- and punctuation-blind key for "is this the same line". The card, viewer, deck and server action all compare with it. */
export const matchKey = (t: string): string => t.normalize('NFKC').toLowerCase().replace(NON_WORD, ' ').trim()

/**
 * matchKey for "is this the SAME line": keeps what makes one offer line differ
 * from another. matchKey drops symbols, so "Get $15 off" and "Get 15% off" were
 * one key, and "£5.49" and "£549" too. Thousands commas still don't count.
 * Used for AI picks and copy-deck duplicates; matchKey stays for word overlap.
 */
export const lineKey = (t: string): string => matchKey(
  t.normalize('NFKC')
    .replace(/(\d),(?=\d{3}(?!\d))/g, '$1')
    .replace(/(\d)[.,](\d)/g, '$1p$2')
    .replace(/%/g, ' pct ').replace(/\$/g, ' usd ').replace(/£/g, ' gbp ').replace(/€/g, ' eur '),
)

export function normalizeBriefExtraction(raw: unknown): BriefExtraction | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const offer = rec(r.offer)
  const audience = rec(r.audience)

  const seen = new Set<string>()
  const deduped = recs(r.copy, 300).flatMap((c): BriefCopy[] => {
    const text = str(c.text, 1500)
    const kind = (COPY_KINDS as readonly string[]).includes(c.kind as string) ? (c.kind as BriefCopyKind) : 'other'
    const key = `${kind}\u0000${text}`
    if (!text || seen.has(key)) return []
    seen.add(key)
    return [{
      kind, text, location: str(c.location, 80),
      verified: typeof c.verified === 'boolean' ? c.verified : null,
      fit: (COPY_FITS as readonly string[]).includes(c.fit as string) ? (c.fit as BriefCopyFit) : null,
    }]
  })
  const copy = deduped.slice(0, MAX_BRIEF_COPY)
  // A stored row carries the flag forward; a fresh read sets it when lines were dropped here.
  const copyCapped = r.copy_capped === true || deduped.length > MAX_BRIEF_COPY ||
    (Array.isArray(r.copy) && r.copy.length > 300)

  return {
    title: str(r.title, 200),
    summary: str(r.summary, 1200),
    offer: {
      name: str(offer.name, 300), mechanic: str(offer.mechanic, 1000),
      price_points: strs(offer.price_points, 12, 200), code: str(offer.code, 100),
      dates: str(offer.dates, 200), conditions: strs(offer.conditions, 12, 400),
    },
    products: recs(r.products, 40)
      .map(p => ({ name: str(p.name, 200), details: str(p.details, 400) }))
      .filter(p => p.name),
    audience: { who: str(audience.who, 600), pains: strs(audience.pains, 12), desires: strs(audience.desires, 12) },
    angles: strs(r.angles, 20),
    tone: strs(r.tone, 12, 120),
    copy,
    deliverables: recs(r.deliverables, 30)
      .map(d => ({ format: str(d.format, 120), sizes: str(d.sizes, 200), quantity: str(d.quantity, 60), notes: str(d.notes, 400) }))
      .filter(d => d.format || d.sizes || d.notes),
    mandatories: strs(r.mandatories, 20),
    dos: strs(r.dos, 20),
    donts: strs(r.donts, 20),
    references: recs(r.references, 30)
      .map(x => ({ description: str(x.description, 400), url: httpUrl(x.url), location: str(x.location, 80) }))
      .filter(x => x.description || x.url),
    pages: recs(r.pages, 1000)
      .map(p => ({ page: posInt(p.page), summary: str(p.summary, 400), has_imagery: p.has_imagery === true, imagery: str(p.imagery, 400) }))
      .filter(p => p.page > 0),
    images: recs(r.images, 80)
      .map(i => ({
        id: posInt(i.id), caption: str(i.caption, 400),
        kind: (IMAGE_KINDS as readonly string[]).includes(i.kind as string) ? (i.kind as string) : 'other',
      }))
      .filter(i => i.id > 0),
    gaps: strs(r.gaps, 6, 200),
    reading_notes: str(r.reading_notes, 300),
    ai_picks: Array.isArray(r.ad_picks),
    ad_picks: readPicks(r.ad_picks, copy),
    ad_rules: recs(r.ad_rules, 40)
      .flatMap((o): BriefAdRule[] => {
        const text = str(o.text, 300)
        return text && (o.type === 'must' || o.type === 'never')
          ? [{ type: o.type, text, location: str(o.location, 80) }]
          : []
      })
      .slice(0, 10),
    brief_type: (BRIEF_TYPE_VALUES as readonly string[]).includes(r.brief_type as string) ? (r.brief_type as BriefType) : '',
    copy_capped: copyCapped,
  }
}

// The one real limit on picks: Gemini may ignore the prompt's. It runs on every
// normalize, so picks always point at the current `copy` (a stored row read
// back re-matches its own picks), and markVerbatim needs no change.
const PICK_WORDS: Record<BriefSlot, number> = { eyebrow: 6, headline: 12, subline: 20, cta: 8 }

/** Sentences of a line, each with its own end punctuation. No lookbehind: tsconfig targets ES2017. */
export function sentencesOf(t: string): string[] {
  const parts = t.split(/([.!?]["')\]]*\s+)/), out: string[] = []
  for (let i = 0; i < parts.length; i += 2) out.push((parts[i] + (parts[i + 1] ?? '')).trim())
  return out.filter(Boolean)
}

function readPicks(raw: unknown, copy: BriefCopy[]): BriefPick[] {
  const whole = new Map<string, number>(), part = new Map<string, { i: number; text: string }>()
  copy.forEach((c, i) => {
    const k = lineKey(c.text)
    if (k && !whole.has(k)) whole.set(k, i)
    for (const s of sentencesOf(c.text)) {
      const sk = lineKey(s)
      if (sk && !part.has(sk)) part.set(sk, { i, text: s })
    }
  })
  const n: Record<BriefSlot, number> = { eyebrow: 0, headline: 0, subline: 0, cta: 0 }
  const seen = new Set<string>()
  return recs(raw, 24).flatMap((o): BriefPick[] => {
    const slot = o.slot as BriefSlot
    if (!(BRIEF_SLOTS as readonly string[]).includes(slot) || n[slot] >= 3) return []
    const k = lineKey(str(o.text, 300))
    if (!k || seen.has(`${slot}:${k}`)) return []
    const w = whole.get(k), p = w === undefined ? part.get(k) : undefined
    if (w === undefined && !p) return []                     // not the brief's words: dropped, never shown
    const text = w !== undefined ? copy[w].text : p!.text    // displayed text is the BRIEF's, not the model's
    if (text.includes('\n') || text.trim().split(/\s+/).length > PICK_WORDS[slot]) return []
    seen.add(`${slot}:${k}`)
    n[slot]++
    return [{ slot, text, copy_index: w ?? p!.i, sentence: w === undefined }]
  })
}

export const briefIsEmpty = (x: BriefExtraction): boolean =>
  !x.summary && !x.copy.length && !x.offer.mechanic && !x.offer.name && !x.products.length &&
  !x.pages.length && !x.images.length && !x.mandatories.length && !x.angles.length

/**
 * The one hallucination check that is actually checkable: for text formats,
 * does each extracted line appear in the file, ignoring case and punctuation?
 * PDFs have no server-side text layer, so their copy stays verified: null.
 */
export function markVerbatim(x: BriefExtraction, documentText: string): void {
  const hay = ` ${matchKey(documentText.replace(/\[IMG \d+\]/g, ' '))} `
  x.copy = x.copy.map(c => {
    const key = matchKey(c.text)
    return { ...c, verified: key ? hay.includes(` ${key} `) : null }
  })
}
