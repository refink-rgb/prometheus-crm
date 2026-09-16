// Turn an uploaded brief into (a) what the model reads and (b) the pictures
// the page shows.
//
// Words go to Gemini; PIXELS come from the file. A model can describe a picture
// but cannot hand it back, and asking it to crop is guesswork.
//   PPTX  slide text in PRESENTATION order (ppt/presentation.xml sldIdLst — the
//         slideN.xml filenames are out of order in any reordered deck), speaker
//         notes, and every picture each slide embeds.
//   DOCX  mammoth HTML -> text, pictures in document order.
//   TXT   the text.  Image  the image.
//   PDF   nothing here: Gemini reads PDF pages natively, and page previews are
//         drawn in the browser (components/preview/render-pdf-pages.ts).
// Each kept picture becomes two WebPs and an [IMG n] marker where it appears,
// so the model can caption picture 7 knowing it sits on slide 5.

import { createHash } from 'crypto'
import sharp from 'sharp'
import type JSZip from 'jszip'
import { xmlToText } from '@/lib/ai/brand-guideline'
import { IMAGE_FULL_PX, IMAGE_THUMB_PX, MAX_BRIEF_IMAGES, MIN_IMAGE_PX } from '@/lib/project-briefs'

/** A failure the editor can act on. Its message is shown to them verbatim. */
export class BriefReadError extends Error {}

export interface ExtractedImage {
  n: number
  page: number | null
  source: 'pptx' | 'docx' | 'upload'
  full: Buffer
  thumb: Buffer
  w: number
  h: number
  /**
   * Single-image briefs only: what the MODEL reads. Capped by width alone, so a
   * tall screenshot keeps legible text — `full` fits a 1600×1600 box, which put
   * a 1440×12000 landing page at 192×1600 with 2px body text.
   */
  modelInput?: Buffer
}

export interface BriefSource {
  kind: 'pdf' | 'text' | 'image'
  format: 'pdf' | 'pptx' | 'docx' | 'txt' | 'image'
  /** Document text with [IMG n] markers; '' for pdf and image. */
  text: string
  images: ExtractedImage[]
  /** Distinct, showable pictures not kept because of the MAX_BRIEF_IMAGES cap. */
  imagesOverCap: number
  /** Distinct, showable pictures skipped to leave the model its share of the time budget. */
  imagesOutOfTime: number
}

const TEXT_CAP = 200_000
const UNDECODABLE = /\.(emf|wmf|wdp|jxr|hdp)$/i   // sharp cannot decode, browsers cannot show
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

interface Candidate { key: string; page: number | null; read: () => Promise<Buffer> }
type Rel = { target: string; type: string; external: boolean }

export async function extractBriefSource(buf: Buffer, mimeType: string, deadline: number): Promise<BriefSource> {
  if (mimeType === 'application/pdf') {
    return { kind: 'pdf', format: 'pdf', text: '', images: [], imagesOverCap: 0, imagesOutOfTime: 0 }
  }
  if (mimeType === 'text/plain') {
    const text = buf.toString('utf8').replace(/^\uFEFF/, '').trim()
    if (text.length < 20) throw new BriefReadError('This .txt file is empty or nearly empty.')
    return { kind: 'text', format: 'txt', text: text.slice(0, TEXT_CAP), images: [], imagesOverCap: 0, imagesOutOfTime: 0 }
  }
  if (mimeType === 'image/png' || mimeType === 'image/jpeg' || mimeType === 'image/webp') {
    const im = await toWebps(buf, 1)
    if (!im) throw new BriefReadError('This image could not be opened. Re-export it as PNG or JPG and upload again.')
    // Width-capped only. 16000 tall stays under WebP's 16383px ceiling; a 1600-wide
    // strip that tall is a few MB, inside Gemini's inline limit.
    let modelInput: Buffer | undefined
    try {
      modelInput = await sharp(buf, { failOn: 'none', limitInputPixels: 120_000_000 }).rotate()
        .resize({ width: 1600, height: 16000, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer()
    } catch { modelInput = undefined }   // falls back to `full` in brief-reader
    return { kind: 'image', format: 'image', text: '', images: [{ n: 1, page: null, source: 'upload', ...im, modelInput }], imagesOverCap: 0, imagesOutOfTime: 0 }
  }
  if (mimeType === PPTX) return fromPptx(buf, deadline)
  if (mimeType === DOCX) return fromDocx(buf, deadline)
  throw new BriefReadError(`Unsupported file type ${mimeType}.`)
}

async function fromPptx(buf: Buffer, deadline: number): Promise<BriefSource> {
  const JSZipLib = (await import('jszip')).default
  let zip: JSZip
  try {
    zip = await JSZipLib.loadAsync(buf)
  } catch {
    throw new BriefReadError('This .pptx could not be opened. It may be damaged or password-protected. Export it as a PDF and upload that.')
  }
  const presPath = 'ppt/presentation.xml'
  const presXml = await zip.file(presPath)?.async('string')
  if (!presXml) throw new BriefReadError('This .pptx has no readable slides. Export it as a PDF and upload that.')

  const presRels = await readRels(zip, presPath)
  const idList = presXml.match(/<p:sldIdLst>([\s\S]*?)<\/p:sldIdLst>/)?.[1] ?? ''
  const slidePaths = Array.from(idList.matchAll(/\br:id="([^"]+)"/g))
    .map(m => presRels.get(m[1]))
    .filter((r): r is Rel => !!r && !r.external && !!zip.file(r.target))
    .map(r => r.target)
  if (!slidePaths.length) throw new BriefReadError('No slides found in this .pptx. Export it as a PDF and upload that.')

  const blocks: string[] = []
  const cands: Candidate[] = []
  for (const [i, slidePath] of slidePaths.entries()) {
    const slide = i + 1
    const xml = await zip.file(slidePath)!.async('string')
    const rels = await readRels(zip, slidePath)

    const markers: string[] = []
    for (const m of xml.matchAll(/<a:blip\b[^>]*?\br:embed="([^"]+)"/g)) {
      const rel = rels.get(m[1])
      if (!rel || rel.external || UNDECODABLE.test(rel.target)) continue
      const file = zip.file(rel.target)
      if (!file) continue
      // Keyed by media path: a picture reused on three slides is one image with three markers.
      cands.push({ key: rel.target, page: slide, read: () => file.async('nodebuffer') })
      markers.push(`\u0000${rel.target}\u0000`)
    }

    const notesRel = Array.from(rels.values()).find(r => r.type === 'notesSlide' && !r.external)
    const notesXml = notesRel ? await zip.file(notesRel.target)?.async('string') : undefined
    const notes = notesXml ? xmlToText(notesXml) : ''
    const hidden = /<p:sld\b[^>]*\bshow="0"/.test(xml)

    blocks.push([
      `--- Slide ${slide}${hidden ? ' (hidden in the deck)' : ''} ---`,
      xmlToText(xml),
      markers.join(' '),
      notes ? `Speaker notes: ${notes}` : '',
    ].filter(Boolean).join('\n'))
  }

  const kept = await keepImages(cands, 'pptx', deadline)
  const text = resolveMarkers(blocks.join('\n\n'), kept.nByKey)
  const words = text.replace(/\[IMG \d+\]/g, '').replace(/--- Slide \d+[^\n]*---/g, '').trim()
  if (words.length < 20 && !kept.images.length) {
    throw new BriefReadError('This deck has no readable text or pictures. If it is all artwork, export it as a PDF so its pages are read visually.')
  }
  return { kind: 'text', format: 'pptx', text: text.slice(0, TEXT_CAP), images: kept.images, imagesOverCap: kept.overCap, imagesOutOfTime: kept.outOfTime }
}

async function fromDocx(buf: Buffer, deadline: number): Promise<BriefSource> {
  // Same interop guard as docxToText in brand-guideline.ts.
  const mod = await import('mammoth')
  const mammoth = (mod as unknown as { default?: typeof mod }).default ?? mod
  if (typeof mammoth?.convertToHtml !== 'function') {
    throw new BriefReadError('The Word reader failed to load. Export the brief as a PDF and upload that.')
  }

  const cands: Candidate[] = []
  let html: string
  try {
    const result = await mammoth.convertToHtml({ buffer: buf }, {
      convertImage: mammoth.images.imgElement(async image => {
        if (/emf|wmf/i.test(image.contentType)) return { src: '' }
        const key = `docx-${cands.length + 1}`
        const bytes = await image.readAsBuffer()   // read now: tested inside the callback only
        cands.push({ key, page: null, read: async () => bytes })
        return { src: `brief-img:${key}` }
      }),
    })
    html = result.value
  } catch {
    throw new BriefReadError('This .docx could not be opened. It may be damaged or password-protected. Export it as a PDF and upload that.')
  }

  const kept = await keepImages(cands, 'docx', deadline)
  const text = resolveMarkers(htmlToText(html), kept.nByKey)
  if (text.replace(/\[IMG \d+\]/g, '').trim().length < 20 && !kept.images.length) {
    throw new BriefReadError('No readable text or pictures in this .docx. Export it as a PDF so its pages are read visually.')
  }
  return { kind: 'text', format: 'docx', text: text.slice(0, TEXT_CAP), images: kept.images, imagesOverCap: kept.overCap, imagesOutOfTime: kept.outOfTime }
}

async function keepImages(
  cands: Candidate[], source: 'pptx' | 'docx', deadline: number,
): Promise<{ images: ExtractedImage[]; nByKey: Map<string, number>; overCap: number; outOfTime: number }> {
  const images: ExtractedImage[] = []
  const nByKey = new Map<string, number>()
  const byHash = new Map<string, number>()
  const notKept = new Set<string>()   // hashes counted as not shown, so a reuse is not counted twice
  let overCap = 0
  let outOfTime = 0

  for (const c of cands) {
    if (nByKey.has(c.key)) continue
    let bytes: Buffer
    try { bytes = await c.read() } catch { continue }
    // De-dup BEFORE the cap: picture #1 reused after the 40th is still [IMG 1].
    const hash = createHash('sha256').update(bytes).digest('hex')
    const dup = byHash.get(hash)
    if (dup) { nByKey.set(c.key, dup); continue }
    if (notKept.has(hash)) continue

    // Leave 150s of the 265s budget for the model.
    const late = Date.now() > deadline - 150_000
    if (late || images.length >= MAX_BRIEF_IMAGES) {
      // Counted only if it would have been shown: icons and undecodable files never are.
      if (await showable(bytes, MIN_IMAGE_PX)) {
        notKept.add(hash)
        if (late) outOfTime++; else overCap++
      }
      continue
    }

    const im = await toWebps(bytes, MIN_IMAGE_PX)
    if (!im) continue
    const n = images.length + 1
    images.push({ n, page: c.page, source, ...im })
    nByKey.set(c.key, n)
    byHash.set(hash, n)
  }
  return { images, nByKey, overCap, outOfTime }
}

/** Header read only: the same test toWebps applies, without encoding anything. */
async function showable(bytes: Buffer, minPx: number): Promise<boolean> {
  try {
    const meta = await sharp(bytes, { failOn: 'none', limitInputPixels: 120_000_000 }).metadata()
    return !!meta.width && !!meta.height && (meta.width >= minPx || meta.height >= minPx)
  } catch {
    return false
  }
}

async function toWebps(bytes: Buffer, minPx: number): Promise<{ full: Buffer; thumb: Buffer; w: number; h: number } | null> {
  try {
    const base = sharp(bytes, { failOn: 'none', limitInputPixels: 120_000_000 }).rotate()
    const meta = await base.metadata()
    if (!meta.width || !meta.height) return null
    if (meta.width < minPx && meta.height < minPx) return null
    const full = await base.clone()
      .resize({ width: IMAGE_FULL_PX, height: IMAGE_FULL_PX, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true })
    const thumb = await base.clone()
      .resize({ width: IMAGE_THUMB_PX, height: IMAGE_THUMB_PX, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 72 })
      .toBuffer()
    return { full: full.data, thumb, w: full.info.width, h: full.info.height }
  } catch {
    return null
  }
}

async function readRels(zip: JSZip, partPath: string): Promise<Map<string, Rel>> {
  const slash = partPath.lastIndexOf('/')
  const dir = partPath.slice(0, slash)
  const file = zip.file(`${dir}/_rels/${partPath.slice(slash + 1)}.rels`)
  const map = new Map<string, Rel>()
  if (!file) return map
  const xml = await file.async('string')
  for (const m of xml.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const attrs: Record<string, string> = {}
    for (const a of m[1].matchAll(/([\w:]+)="([^"]*)"/g)) attrs[a[1]] = a[2]
    if (!attrs.Id || !attrs.Target) continue
    const external = attrs.TargetMode === 'External'
    map.set(attrs.Id, {
      target: external ? attrs.Target : resolvePart(dir, attrs.Target),
      type: (attrs.Type ?? '').split('/').pop() ?? '',
      external,
    })
  }
  return map
}

function resolvePart(dir: string, target: string): string {
  let t = target
  try { t = decodeURIComponent(target) } catch { /* keep as written */ }
  const parts = (t.startsWith('/') ? t.slice(1) : `${dir}/${t}`).split('/')
  const out: string[] = []
  for (const p of parts) {
    if (p === '..') out.pop()
    else if (p && p !== '.') out.push(p)
  }
  return out.join('/')
}

function htmlToText(html: string): string {
  return html
    .replace(/<img\b[^>]*\bsrc="brief-img:([^"]+)"[^>]*>/g, (_, key: string) => ` \u0000${key}\u0000 `)
    .replace(/<h[1-6]\b[^>]*>/g, '\n\n## ')
    .replace(/<li\b[^>]*>/g, '\n- ')
    .replace(/<\/(p|h[1-6]|li|tr|table)>|<br\s*\/?>/g, '\n')
    .replace(/<\/t[dh]>/g, ' | ')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function resolveMarkers(text: string, nByKey: Map<string, number>): string {
  return text.replace(/\u0000([^\u0000]+)\u0000/g, (_, key: string) => {
    const n = nByKey.get(key)
    return n ? `[IMG ${n}]` : ''
  })
}
