import type { createClient } from '@/lib/supabase/server'
import {
  BRIEF_BUCKET, BRIEF_MODEL, MAX_BRIEF_IMAGES,
  briefImagePath, briefIsEmpty, markVerbatim, normalizeBriefExtraction,
  type BriefImage,
} from '@/lib/project-briefs'
import { BriefReadError, extractBriefSource, type ExtractedImage } from './extract-source'
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
  const write = (patch: Record<string, unknown>) =>
    supabase.from('project_briefs').update(patch).eq('id', brief.id)

  try {
    const { data: blob, error: dlErr } = await supabase.storage.from(BRIEF_BUCKET).download(brief.storage_path)
    if (dlErr || !blob) throw new BriefReadError(`Could not fetch the file from storage${dlErr ? `: ${dlErr.message}` : ''}.`)
    const buf = Buffer.from(await blob.arrayBuffer())
    // Only changes the WORDING of a failure. Permission-only encryption (no
    // open password) reads fine, so this must never block the read.
    encrypted = isPdf && buf.includes('/Encrypt')

    const { brandName, projectName } = await names(supabase, brief.project_id)
    const source = await extractBriefSource(buf, brief.mime_type, deadline)

    // Pictures are saved before the model runs: a deck's pictures are worth
    // showing even when the read fails.
    if (source.kind !== 'pdf') {
      const images = await storeImages(supabase, brief, source.images)
      const lost = source.images.length - images.length
      await write({
        images,
        images_status: lost > 0 && images.length === 0 ? 'failed' : 'done',
        images_note: lost > 0
          ? `${lost} picture${lost === 1 ? '' : 's'} could not be saved.`
          : source.imagesOverCap > 0
            ? `${source.imagesOverCap} more picture${source.imagesOverCap === 1 ? '' : 's'} in the file are not shown (limit ${MAX_BRIEF_IMAGES}). Download the original for the rest.`
            : null,
      })
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

    const { error } = await write({
      extraction_status: 'done',
      extraction,
      extraction_error: null,
      extraction_model: BRIEF_MODEL,
      extracted_at: new Date().toISOString(),
    })
    if (error) throw new Error(`The read finished but could not be saved: ${error.message}`)
    console.log('[brief read] done', brief.id, brief.mime_type, secs())
  } catch (e) {
    const message = friendlyError(e, isPdf, encrypted)
    console.error('[brief read] failed', brief.id, brief.mime_type, secs(), message, e)
    const { error } = await write({ extraction_status: 'failed', extraction_error: message })
    if (error) console.error('[brief read] could not record the failure', brief.id, error.message)
  }
}

async function names(supabase: Db, projectId: string): Promise<{ brandName: string; projectName: string }> {
  const { data: project } = await supabase.from('projects').select('name, brand_id').eq('id', projectId).maybeSingle()
  const p = project as { name: string | null; brand_id: string } | null
  if (!p) return { brandName: '', projectName: '' }
  const { data: brand } = await supabase.from('brands').select('name').eq('id', p.brand_id).maybeSingle()
  return { brandName: (brand as { name: string } | null)?.name ?? '', projectName: p.name ?? '' }
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
  if (encrypted) {
    return 'This PDF is encrypted or password-protected, so it could not be read. Open it, Print, then Save as PDF to make an unprotected copy, and upload that.'
  }
  if (/GEMINI_API_KEY/.test(msg)) return 'The AI is not configured on the server (GEMINI_API_KEY is missing).'
  if (/\b429\b|quota|RESOURCE_EXHAUSTED/i.test(msg)) return 'The AI is rate-limited right now. Wait a minute, then Re-read.'
  if (isPdf && /page|too large|exceed|limit|INVALID_ARGUMENT|\b400\b/i.test(msg)) {
    return `Gemini could not read this PDF (${msg.slice(0, 140)}). PDFs over 1,000 pages cannot be read; split it.`
  }
  return `The AI read failed: ${msg.slice(0, 200)}`
}
