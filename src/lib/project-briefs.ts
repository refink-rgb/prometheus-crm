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

export interface BriefCopy {
  kind: BriefCopyKind
  text: string
  location: string
  /** true/false = checked against the file's text (DOCX/PPTX/TXT). null = could not check (PDF, image). */
  verified: boolean | null
}

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
}

const str = (v: unknown, max = 2000): string =>
  typeof v === 'string' ? v.replace(/\u0000/g, '').trim().slice(0, max) : ''
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

export function normalizeBriefExtraction(raw: unknown): BriefExtraction | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const offer = rec(r.offer)
  const audience = rec(r.audience)

  const seen = new Set<string>()
  const copy = recs(r.copy, 250).flatMap((c): BriefCopy[] => {
    const text = str(c.text, 1500)
    const kind = (COPY_KINDS as readonly string[]).includes(c.kind as string) ? (c.kind as BriefCopyKind) : 'other'
    const key = `${kind}\u0000${text}`
    if (!text || seen.has(key)) return []
    seen.add(key)
    return [{ kind, text, location: str(c.location, 80), verified: typeof c.verified === 'boolean' ? c.verified : null }]
  }).slice(0, 150)

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
  }
}

export const briefIsEmpty = (x: BriefExtraction): boolean =>
  !x.summary && !x.copy.length && !x.offer.mechanic && !x.offer.name && !x.products.length &&
  !x.pages.length && !x.images.length && !x.mandatories.length && !x.angles.length

// Built at runtime: tsconfig targets ES2017, and TS rejects \p{..} literals below ES2018.
const NON_WORD = new RegExp('[^\\p{L}\\p{N}]+', 'gu')
const matchKey = (t: string): string => t.normalize('NFKC').toLowerCase().replace(NON_WORD, ' ').trim()

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
