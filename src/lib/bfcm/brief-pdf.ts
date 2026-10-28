import { PDFDocument, PDFName, PDFString, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import type { Brand, PlanSnapshot, StageOffer } from './model'
import type { MotionReference } from './content'
import { phaseAllocation } from './phase-allocation'

export const BFCM_PDF_FONT_PATHS = {
  regular: '/showcase/creative-edit-2026-10-21/assets/font-0.ttf',
  bold: '/showcase/creative-edit-2026-10-21/assets/font-3.ttf',
  mono: '/showcase/creative-edit-2026-10-21/assets/font-7.ttf',
} as const
export type BriefPdfFonts = { regular: Uint8Array; bold: Uint8Array; mono: Uint8Array }
export type BriefPdfInput = {
  brand: Brand
  snapshot: PlanSnapshot
  version: number
  lockedAt: string
  motionReferences: MotionReference[]
  files: { id: string; name: string }[]
  /** A staff-authenticated plan URL only. Never pass a capability-token URL. */
  planUrl?: string
}
const navy = rgb(15 / 255, 34 / 255, 51 / 255)
const cyan = rgb(0, 228 / 255, 230 / 255)
const muted = rgb(.35, .43, .49)
const pale = rgb(.95, .98, .98)
const safeUrl = (value: string) => {
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : null } catch { return null }
}
function planLink(input: BriefPdfInput) {
  if (!input.planUrl) return null
  try {
    const u = new URL(input.planUrl)
    return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash && u.pathname === `/bfcm-creatives/${input.brand.slug}` ? u.href : null
  } catch { return null }
}

/** Local-only rendering. Call with an authorized, saved history snapshot, never an editable draft. */
export async function createBfcmBriefPdf(input: BriefPdfInput, fontBytes: BriefPdfFonts): Promise<Uint8Array> {
  const { brand, snapshot: s } = input
  if (s.status !== 'locked' || s.brandSlug !== brand.slug || !Number.isSafeInteger(input.version) || input.version < 1 || !Number.isFinite(Date.parse(input.lockedAt))) throw new Error('A saved, confirmed plan version is required for PDF download.')
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit)
  const [regular, bold, mono] = await Promise.all([pdf.embedFont(fontBytes.regular, { subset: false }), pdf.embedFont(fontBytes.bold, { subset: false }), pdf.embedFont(fontBytes.mono, { subset: false })])
  pdf.setTitle(`${brand.name} - BFCM creative brief - Version ${input.version}`)
  pdf.setAuthor('CTC')
  pdf.setSubject('Confirmed BFCM creative plan')
  pdf.setCreator('Prometheus CRM')
  const width = 595.28, height = 841.89, margin = 48, contentWidth = width - margin * 2
  let page: PDFPage, y = 0
  const supported = new Set(regular.getCharacterSet())
  const checkText = (text: string) => {
    for (const char of text) if (!['\n', '\r', '\t'].includes(char) && !supported.has(char.codePointAt(0)!)) throw new Error('The PDF font cannot render one or more characters in this plan. The saved plan has not been changed.')
  }
  const draw = (text: string, x: number, at: number, size = 10, font = regular, color = navy) => {
    checkText(text)
    page.drawText(text, { x, y: at, size, font, color })
  }
  const newPage = () => {
    page = pdf.addPage([width, height])
    page.drawRectangle({ x: 0, y: height - 7, width, height: 7, color: cyan })
    draw('CTC / BFCM CREATIVES', margin, height - 32, 9, bold)
    draw(`VERSION ${input.version}`, width - margin - 80, height - 32, 8, mono, muted)
    y = height - 62
  }
  const ensure = (space: number) => { if (y - space < 48) newPage() }
  const linkAnnotation = (url: string, x: number, baseline: number, w: number, size: number) => {
    const uri = safeUrl(url)
    if (!uri) return
    const annot = pdf.context.register(pdf.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [x, baseline - 2, x + w, baseline + size], Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PDFString.of(uri) } }))
    page.node.addAnnot(annot)
  }
  type Span = { text: string; url?: string }
  // Keep all user text and paragraph breaks; long URLs wrap without clipping.
  const paragraph = (text: string, opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; gap?: number; url?: string } = {}) => {
    const size = opts.size ?? 10, font = opts.font ?? regular, lineHeight = size * 1.48
    const spans: Span[] = []
    const pattern = /https?:\/\/[^\s<>"']+/gi
    let pos = 0
    for (const match of text.matchAll(pattern)) {
      const start = match.index!, url = match[0].replace(/[.,;:!?)}\]]+$/, '')
      spans.push({ text: text.slice(pos, start) }, { text: url, url: safeUrl(url) ?? undefined })
      pos = start + url.length
    }
    spans.push({ text: text.slice(pos) })
    let line: Span[] = [], used = 0
    const flush = () => {
      ensure(lineHeight)
      let x = margin
      for (const span of line) {
        const str = span.text.replace(/\t/g, '    ')
        draw(str, x, y, size, font, span.url || opts.url ? rgb(0, .42, .44) : opts.color ?? navy)
        const w = font.widthOfTextAtSize(str, size)
        if (span.url || opts.url) linkAnnotation(span.url ?? opts.url!, x, y, w, size)
        x += w
      }
      y -= lineHeight; line = []; used = 0
    }
    for (const span of spans) for (const token of span.text.split(/(\r\n|\n|\r|[^\S\r\n]+)/).filter(Boolean)) {
      if (/^[\r\n]+$/.test(token)) { flush(); continue }
      const normalized = token.replace(/\t/g, '    ')
      const tokenWidth = font.widthOfTextAtSize(normalized, size)
      if (used && used + tokenWidth > contentWidth) flush()
      let chunk = ''
      for (const char of normalized) {
        const w = font.widthOfTextAtSize(char, size)
        if (used + w > contentWidth && (line.length || chunk)) { if (chunk) line.push({ text: chunk, url: span.url }); flush(); chunk = '' }
        chunk += char; used += w
      }
      if (chunk) line.push({ text: chunk, url: span.url })
    }
    if (line.length) flush()
    y -= opts.gap ?? 7
  }
  const heading = (title: string) => { ensure(62); y -= 8; page.drawRectangle({ x: margin, y: y - 3, width: 3, height: 17, color: cyan }); draw(title, margin + 11, y, 14, bold); y -= 27 }
  const field = (label: string, value: string) => { ensure(36); paragraph(label, { size: 8, font: bold, color: muted, gap: 1 }); paragraph(value || 'Not provided') }
  const row = (label: string, pre: number | string, bf: number | string, total: number | string, header = false) => {
    ensure(25)
    if (header) page.drawRectangle({ x: margin, y: y - 6, width: contentWidth, height: 24, color: pale })
    draw(label, margin + 8, y, 9, header ? bold : regular)
    for (const [value, x] of [[pre, 370], [bf, 440], [total, 510]] as const) {
      const text = String(value), font = header ? bold : mono
      draw(text, x - font.widthOfTextAtSize(text, 9), y, 9, font)
    }
    y -= 25
  }
  newPage()
  paragraph(brand.name, { size: 25, font: bold, gap: 3 })
  paragraph('BFCM creative brief', { size: 16, font: bold })
  paragraph(`Confirmed version ${input.version} | ${new Date(input.lockedAt).toISOString().replace('T', ' ').replace('.000Z', ' UTC').replace('Z', ' UTC')}`, { size: 9, color: muted })
  const staffUrl = planLink(input)
  if (staffUrl) paragraph(`Plan: ${staffUrl}`, { size: 9 })

  heading('Creative allocation')
  const allocation = phaseAllocation(s)
  paragraph(`Pre-Black Friday ${allocation.prePercent}% / Black Friday ${100 - allocation.prePercent}%. Whole-number quantities based on the saved phase split.`, { size: 9, color: muted })
  row('Type', 'Pre-BF', 'BF', 'Total', true)
  for (const group of allocation.groups) {
    ensure(110); row(group.label, '', '', '', true)
    for (const item of group.rows) row(item.label, item.pre, item.bf, item.total)
    row(`${group.label} subtotal`, group.pre, group.bf, group.total, true)
  }
  row('Total allocated', allocation.pre, allocation.bf, allocation.total, true)

  heading('Planned offers')
  const offer = (name: string, value: StageOffer, inactive = false) => {
    ensure(65); paragraph(name, { size: 12, font: bold })
    if (inactive) paragraph('Retained information only - inactive, not applied to this plan.', { size: 9, color: muted })
    field('Planned offer', value.offer)
    field('Start date / End date', `${value.startDate || 'Not provided'} / ${value.endDate || 'Not provided'}`)
    field('Included products / collections', value.sitewide ? 'Sitewide' : value.included)
    field('Exclusions', value.hasExclusions ? value.exclusions : 'No exclusions')
    if (value.sitewide && value.included) field('Retained inclusions - not applied', value.included)
    if (!value.hasExclusions && value.exclusions) field('Retained exclusions - not applied', value.exclusions)
  }
  if (s.noPreBf) paragraph('No pre-Black Friday promotion.', { font: bold })
  else offer('Pre-Black Friday', s.offers.pre)
  offer('Black Friday', s.offers.bf)
  if (s.noPreBf && Object.values(s.offers.pre).some(v => typeof v === 'string' && v)) {
    offer('Pre-Black Friday - inactive retained inputs', s.offers.pre, true)
    paragraph(`Retained split: ${s.prePercent}% pre-BF / ${100 - s.prePercent}% BF. Effective split: 0% / 100%.`, { size: 9, color: muted })
  }

  heading('Copy')
  if (s.useClientCopy) {
    paragraph('Client-provided copy', { font: bold })
    paragraph('Use the client materials recorded in Notes & files. CRM copy lines and their approvals are not used in this plan.')
  } else {
    paragraph(`Copy approval: ${s.approvedCopiesRevision === s.copyRevision ? 'Confirmed' : 'Not confirmed'}`, { font: bold })
    const sources = { 'BF anterior': 'Previous BF', Recente: 'Recent', Nova: 'New' }
    for (const [index, copy] of s.copies.entries()) {
      ensure(50)
      paragraph(`${String(index + 1).padStart(2, '0')} | ${sources[copy.source]} | ${(s.approvedCopyIds ?? []).includes(copy.id) ? 'Approved' : 'Not approved'}`, { size: 8, font: bold, color: muted, gap: 2 })
      paragraph(copy.text || 'No copy text provided')
    }
  }
  heading('Notes & files')
  field('Notes', s.notes || 'No notes recorded.')
  paragraph('Files', { size: 12, font: bold })
  if (!(s.fileIds ?? []).length) paragraph('No files attached to this version.')
  for (const id of s.fileIds ?? []) {
    const file = input.files.find(f => f.id === id)
    paragraph(file?.name ?? `File metadata unavailable (ID: ${id})`)
  }
  if ((s.fileIds ?? []).length) paragraph(staffUrl ? 'Open the plan link above and sign in to download attachments. Attachment contents are not included in this PDF.' : 'Open this plan in Prometheus to download attachments through authorized access. Attachment contents are not included in this PDF.', { size: 9, color: muted })
  heading('Motion & audio')
  field('Voiceover', s.voiceover ? 'Allowed' : 'Not allowed')
  field('Sound effects (SFX)', s.sfx ? 'Allowed' : 'Not allowed')
  paragraph('Selected references', { size: 12, font: bold })
  if (!s.motionIds.length) paragraph('No motion references selected.')
  for (const id of s.motionIds) {
    const ref = input.motionReferences.find(r => r.id === id)
    if (!ref) { paragraph(`Reference unavailable (ID: ${id}). No video link available.`); continue }
    ensure(60); paragraph(ref.title, { font: bold, gap: 2 })
    paragraph(`${ref.category} | ${ref.format}`, { size: 9, color: muted })
    paragraph(safeUrl(ref.videoUrl) ? `Video reference: ${ref.videoUrl}` : 'Video reference unavailable.', { size: 9 })
  }
  const pages = pdf.getPages()
  for (const [index, p] of pages.entries()) {
    page = p
    page.drawLine({ start: { x: margin, y: 34 }, end: { x: width - margin, y: 34 }, thickness: .5, color: rgb(.83, .88, .9) })
    draw('CTC / PROMETHEUS', margin, 21, 7, bold, muted)
    draw(`${index + 1} / ${pages.length}`, width - margin - 35, 21, 7, mono, muted)
  }
  // The document never launches actions automatically; only explicit safe HTTP(S) links are clickable.
  pdf.catalog.delete(PDFName.of('OpenAction'))
  return pdf.save()
}

/** Loads only bundled, public, same-origin fonts; no plan content leaves this browser. */
export async function loadBfcmBriefFonts(): Promise<BriefPdfFonts> {
  const entries = await Promise.all(Object.entries(BFCM_PDF_FONT_PATHS).map(async ([key, path]) => {
    const response = await fetch(path, { credentials: 'same-origin' })
    if (!response.ok) throw new Error('Unable to load the PDF fonts. Please try again.')
    return [key, new Uint8Array(await response.arrayBuffer())] as const
  }))
  return Object.fromEntries(entries) as BriefPdfFonts
}
