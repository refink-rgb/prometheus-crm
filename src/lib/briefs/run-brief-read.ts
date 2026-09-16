import type { createClient } from '@/lib/supabase/server'
import {
  BRIEF_BUCKET, BRIEF_MODEL, MAX_BRIEF_IMAGES,
  briefImagePath, briefIsEmpty, markVerbatim, normalizeBriefExtraction,
  type BriefImage,
} from '@/lib/project-briefs'
import { BriefReadError, extractBriefSource, type BriefSource, type ExtractedImage } from './extract-source'
import { removeBriefFolder } from './storage'
import { readBriefWithGemini } from '@/lib/ai/brief-reader'

type Db = Awaited<ReturnType<typeof createClient>>

export interface ClaimedBrief {
  id: string
  project_id: string
  storage_path: string
  mime_type: string
  file_name: string
}

// 265s of the route's 300: the last 35s are for writing the result or the
// failure, so a row never outlives its function in 'reading'.
const RUN_BUDGET_MS = 265_000

export async function runBriefRead(supabase: Db, brief: ClaimedBrief): Promise<void> {
  const started = Date.now()
  const deadline = started + RUN_BUDGET_MS
  const isPdf = brief.mime_type === 'application/pdf'
  const secs = () => `${Math.round((Date.now() - started) / 1000)}s`
  let encrypted = false
  // `gone`: the update matched no row, so the brief was removed mid-read (by an
  // editor, or with its project or brand).
  const write = async (patch: Record<string, unknown>): Promise<{ error: string | null; gone: boolean }> => {
    const { data, error } = await supabase.from('project_briefs').update(patch).eq('id', brief.id).select('id')
    return { error: error?.message ?? null, gone: !error && !data?.length }
  }
  const stillThere = async (): Promise<boolean> => {
    const { data, error } = await supabase.from('project_briefs').select('id').eq('id', brief.id).maybeSingle()
    return !!data || !!error   // a failed check is not proof of removal
  }
  // Whatever this read saved has no row to point at, and nothing else will
  // ever delete it. Take it back and stop.
  const abandon = async (at: string) => {
    await removeBriefFolder(supabase, brief.project_id, brief.id)
    console.log('[brief read] brief removed mid-read, files cleaned', brief.id, at, secs())
  }

  try {
    const { data: blob, error: dlErr } = await supabase.storage.from(BRIEF_BUCKET).download(brief.storage_path)
    if (dlErr || !blob) throw new BriefReadError(`Could not fetch the file from storage${dlErr ? `: ${dlErr.message}` : ''}.`)
    const buf = Buffer.from(await blob.arrayBuffer())
    // Only changes the WORDING of a failure. Permission-only encryption (no
    // open password) reads fine, so this must never block the read.
    encrypted = isPdf && buf.includes('/Encrypt')

    const { brandName, projectName } = await names(supabase, brief.project_id)
    const source = await extractBriefSource(buf, brief.mime_type, deadline)
    // Parsing a big deck takes a while. Checked before any picture is stored
    // and before Gemini is paid for.
    if (!(await stillThere())) return abandon('before pictures')

    // Pictures are saved before the model runs: a deck's pictures are worth
    // showing even when the read fails.
    if (source.kind !== 'pdf') {
      const images = await storeImages(supabase, brief, source.images)
      const saved = await write({
        images,
        images_status: source.images.length > images.length && images.length === 0 ? 'failed' : 'done',
        images_note: imagesNote(source, images.length),
      })
      if (saved.gone) return abandon('after pictures')
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Math.max(15_000, deadline - Date.now()))
    let raw: unknown
    try {
      raw = await readBriefWithGemini({
        brandName, projectName, fileName: brief.file_name, source,
        pdf: isPdf ? buf : null, signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }

    const extraction = normalizeBriefExtraction(raw)
    if (!extraction || briefIsEmpty(extraction)) {
      throw new BriefReadError('The AI found nothing to extract. If the brief is mostly pictures, export it as a PDF so its pages are read visually.')
    }
    if (source.kind === 'text') markVerbatim(extraction, source.text)

    const { error, gone } = await write({
      extraction_status: 'done',
      extraction,
      extraction_error: null,
      extraction_model: BRIEF_MODEL,
      extracted_at: new Date().toISOString(),
    })
    if (gone) return abandon('after the read')
    if (error) throw new Error(`The read finished but could not be saved: ${error}`)
    console.log('[brief read] done', brief.id, brief.mime_type, secs())
  } catch (e) {
    const message = friendlyError(e, isPdf, encrypted)
    console.error('[brief read] failed', brief.id, brief.mime_type, secs(), message, e)
    const { error, gone } = await write({ extraction_status: 'failed', extraction_error: message })
    if (gone) await abandon('after a failure')
    else if (error) console.error('[brief read] could not record the failure', brief.id, error)
  }
}

async function names(supabase: Db, projectId: string): Promise<{ brandName: string; projectName: string }> {
  const { data: project } = await supabase.from('projects').select('name, brand_id').eq('id', projectId).maybeSingle()
  const p = project as { name: string | null; brand_id: string } | null
  if (!p) return { brandName: '', projectName: '' }
  const { data: brand } = await supabase.from('brands').select('name').eq('id', p.brand_id).maybeSingle()
  return { brandName: (brand as { name: string } | null)?.name ?? '', projectName: p.name ?? '' }
}

function imagesNote(source: BriefSource, savedCount: number): string | null {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  const lost = source.images.length - savedCount
  if (lost > 0) return `${plural(lost, 'picture', 'pictures')} could not be saved.`
  const parts: string[] = []
  if (source.imagesOverCap > 0) {
    parts.push(`${plural(source.imagesOverCap, 'more picture is', 'more pictures are')} in the file but not shown (limit ${MAX_BRIEF_IMAGES}).`)
  }
  if (source.imagesOutOfTime > 0) {
    parts.push(`${plural(source.imagesOutOfTime, 'picture was', 'pictures were')} skipped to leave the AI time to read.`)
  }
  return parts.length ? `${parts.join(' ')} Download the original for the rest.` : null
}

async function storeImages(supabase: Db, brief: ClaimedBrief, images: ExtractedImage[]): Promise<BriefImage[]> {
  const bucket = supabase.storage.from(BRIEF_BUCKET)
  const out: BriefImage[] = []
  for (let i = 0; i < images.length; i += 6) {
    const saved = await Promise.all(images.slice(i, i + 6).map(async (im): Promise<BriefImage | null> => {
      const full = briefImagePath(brief.project_id, brief.id, im.n, 'full', 'webp')
      const thumb = briefImagePath(brief.project_id, brief.id, im.n, 'thumb', 'webp')
      const [a, b] = await Promise.all([
        bucket.upload(full, im.full, { contentType: 'image/webp', upsert: true, cacheControl: '3600' }),
        bucket.upload(thumb, im.thumb, { contentType: 'image/webp', upsert: true, cacheControl: '3600' }),
      ])
      if (a.error || b.error) {
        console.error('[brief read] picture not saved', full, a.error?.message ?? b.error?.message)
        return null
      }
      return { n: im.n, page: im.page, source: im.source, full, thumb, w: im.w, h: im.h }
    }))
    for (const s of saved) if (s) out.push(s)
  }
  return out
}

function friendlyError(e: unknown, isPdf: boolean, encrypted: boolean): string {
  if (e instanceof BriefReadError) return e.message
  const msg = e instanceof Error ? e.message : String(e)
  if ((e instanceof Error && e.name === 'AbortError') || /abort/i.test(msg)) {
    return 'Reading took longer than 4½ minutes and was stopped. Split the brief into parts, or export a lighter PDF, and upload again.'
  }
  if (/GEMINI_API_KEY/.test(msg)) return 'The AI is not configured on the server (GEMINI_API_KEY is missing).'
  if (/\b429\b|quota|RESOURCE_EXHAUSTED/i.test(msg)) return 'The AI is rate-limited right now. Wait a minute, then Re-read.'
  if (/\b50[03]\b|overloaded|UNAVAILABLE/i.test(msg)) return 'The AI service is busy right now. Wait a minute, then Re-read.'
  // Only a rejection OF THE FILE is explained by encryption. Checked after the
  // rate-limit and outage cases so those are never blamed on the PDF.
  if (encrypted && /INVALID_ARGUMENT|\b400\b|could not open|password|encrypt/i.test(msg)) {
    return 'This PDF is encrypted or password-protected, so it could not be read. Open it, Print, then Save as PDF to make an unprotected copy, and upload that.'
  }
  if (isPdf && /page|too large|exceed|limit|INVALID_ARGUMENT|\b400\b/i.test(msg)) {
    return `Gemini could not read this PDF (${msg.slice(0, 140)}). PDFs over 1,000 pages cannot be read; split it.`
  }
  return `The AI read failed: ${msg.slice(0, 200)}`
}
