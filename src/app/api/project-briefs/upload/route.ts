import { NextResponse, after } from 'next/server'
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import { bearerToken, validateEditorToken } from '@/lib/editor-auth'
import { MB, isUuid } from '@/lib/doc-files'
import {
  BRIEF_BUCKET, BRIEF_TYPES, MAX_BRIEF_BYTES,
  briefSourcePath, resolveBriefType, safeBriefName,
} from '@/lib/project-briefs'
import { runBriefRead, type ClaimedBrief } from '@/lib/briefs/run-brief-read'

/**
 * POST /api/project-briefs/upload      (Authorization: Bearer <editor token>)
 *
 * Lets a person's AI assistant (ChatGPT, Claude, Codex) add a brief to a
 * project without a browser session, a Supabase login or repo access. It can
 * do one thing: put a file in a project's brief list, exactly as the upload
 * box on the project page does. It cannot read, change or remove a brief.
 *
 * Three ways to send one, because the tools differ in what they can post:
 *
 *   1. Text.   JSON { project_id, text, file_name?, track? }
 *              The words are stored as a .txt brief.
 *   2. A file. multipart/form-data with project_id, file, track?
 *              Up to 4MB: a Vercel function refuses a larger request body.
 *   3. A big file, in two calls.
 *              JSON { project_id, file_name, byte_size, track? } answers with
 *              an upload_url. PUT the file there, then call again with
 *              { project_id, brief_id, file_name, track? } to attach it.
 *
 * track is 'creative' (default) or 'lp'. Find project_id with
 * GET /api/creative/projects?brand=<name>, same token.
 */
export const runtime = 'nodejs'
export const maxDuration = 300 // the AI read runs in after(), like the page's own read route

// A Vercel function refuses a request body over 4.5MB; multipart framing takes a little of that.
const DIRECT_MAX_BYTES = 4 * MB
const TYPES_LINE = 'A brief can be a PDF, PowerPoint (.pptx), Word (.docx), .txt, or a PNG/JPG/WebP image.'

type Track = 'creative' | 'lp'
type Db = SupabaseClient

const fail = (status: number, error: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ ok: false, error, ...extra }, { status })

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/project-briefs/upload',
    auth: 'Authorization: Bearer <editor token>',
    find_project: 'GET /api/creative/projects?brand=<brand name>  (same token) returns project_id for each project',
    track: "'creative' (default) or 'lp'",
    accepted_files: Object.values(BRIEF_TYPES).map(t => `.${t.ext}`),
    ways: {
      text: 'JSON { project_id, text, file_name?, track? }. Stored as a .txt brief.',
      file_up_to_4mb: 'multipart/form-data with fields project_id, file, track?',
      larger_file: [
        'JSON { project_id, file_name, byte_size, track? } returns brief_id and upload_url',
        'PUT the file bytes to upload_url with its Content-Type header',
        'JSON { project_id, brief_id, file_name, track? } attaches it',
      ],
    },
  })
}

export async function POST(request: Request) {
  const supabase = createServiceClient()
  const auth = await validateEditorToken(supabase, bearerToken(request))
  if (!auth) return fail(401, 'Invalid or missing editor token.')

  // ── Read the request, whichever shape it came in ──────────────────────────
  const contentType = request.headers.get('content-type') ?? ''
  let body: Record<string, unknown> = {}
  let file: File | null = null
  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData()
      for (const [k, v] of form.entries()) {
        if (typeof v === 'string') body[k] = v
        else if (k === 'file') file = v
      }
    } else {
      const parsed: unknown = await request.json()
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fail(400, 'Send a JSON object.')
      body = parsed as Record<string, unknown>
    }
  } catch {
    return fail(400, 'Could not read the request. Send JSON, or multipart/form-data with a "file" field.')
  }

  const projectId = str(body.project_id)
  if (!isUuid(projectId)) return fail(400, 'project_id is missing or is not a project id. List projects with GET /api/creative/projects?brand=<name>.')

  const trackRaw = str(body.track).toLowerCase()
  if (trackRaw && trackRaw !== 'creative' && trackRaw !== 'lp') return fail(400, "track must be 'creative' or 'lp'.")
  const track: Track = trackRaw === 'lp' ? 'lp' : 'creative'

  const { data: projectRow } = await supabase
    .from('projects').select('id, name, brand_id').eq('id', projectId).maybeSingle()
  const project = projectRow as { id: string; name: string; brand_id: string } | null
  // One answer for "not there" and "not yours": a token must not be able to
  // tell which project ids exist outside its brands.
  const scope = auth.allowed_brand_ids?.length ? auth.allowed_brand_ids : null
  if (!project || (scope && !scope.includes(project.brand_id))) return fail(404, 'No project with that id for this token.')

  const uploadedByName = (auth.label ?? '').replace(/^Editor\s*[–—-]\s*/i, '').trim() || 'API'
  const done = (briefId: string, fileName: string, byteSize: number) => {
    revalidatePath(`/preview/project/${project.id}`)
    revalidatePath(`/brands/${project.brand_id}/projects/${project.id}`)
    return NextResponse.json({
      ok: true,
      brief_id: briefId,
      project: project.name,
      track,
      file_name: fileName,
      byte_size: byteSize,
      project_url: `${new URL(request.url).origin}/brands/${project.brand_id}/projects/${project.id}`,
    })
  }

  // ── 1 and 2: the bytes are in this request ────────────────────────────────
  const text = typeof body.text === 'string' ? body.text : ''
  if (file || text.trim()) {
    let bytes: Buffer
    let mime: string
    let rawName: string
    if (file) {
      const resolved = resolveBriefType({ name: str(body.file_name) || file.name, type: file.type })
      if (!resolved) return fail(415, TYPES_LINE)
      mime = resolved
      rawName = str(body.file_name) || file.name
      bytes = Buffer.from(await file.arrayBuffer())
    } else {
      mime = 'text/plain'
      const named = str(body.file_name) || 'Brief'
      rawName = /\.txt$/i.test(named) ? named : `${named.replace(/\.[a-z0-9]{1,5}$/i, '')}.txt`
      bytes = Buffer.from(text, 'utf8')
    }
    if (bytes.length === 0) return fail(400, 'That file is empty.')
    if (bytes.length > DIRECT_MAX_BYTES) {
      return fail(413, `That is ${(bytes.length / MB).toFixed(1)}MB. Over ${DIRECT_MAX_BYTES / MB}MB, send { project_id, file_name, byte_size } as JSON first to get an upload_url.`)
    }

    const briefId = crypto.randomUUID()
    const path = briefSourcePath(project.id, briefId, BRIEF_TYPES[mime].ext)
    const { error: upErr } = await supabase.storage.from(BRIEF_BUCKET).upload(path, bytes, { contentType: mime, upsert: false })
    if (upErr) return fail(500, `Could not store that file: ${upErr.message}`)

    const fileName = safeBriefName(rawName, mime)
    const saved = await attach(supabase, { briefId, projectId: project.id, path, fileName, mime, byteSize: bytes.length, uploadedByName, track })
    if (!saved.ok) {
      await supabase.storage.from(BRIEF_BUCKET).remove([path])
      return fail(500, saved.error)
    }
    return done(briefId, fileName, bytes.length)
  }

  // ── 3b: attach a file that was PUT to an upload_url ───────────────────────
  const briefIdIn = str(body.brief_id)
  if (briefIdIn) {
    if (!isUuid(briefIdIn)) return fail(400, 'brief_id is not a brief id.')
    const rawName = str(body.file_name)
    const mime = resolveBriefType({ name: rawName, type: str(body.content_type) })
    if (!rawName || !mime) return fail(400, `Send the same file_name you started the upload with. ${TYPES_LINE}`)

    const { data: existing } = await supabase.from('project_briefs').select('id, file_name, byte_size').eq('id', briefIdIn).eq('project_id', project.id).maybeSingle()
    if (existing) {
      const e = existing as { id: string; file_name: string; byte_size: number }
      return done(e.id, e.file_name, e.byte_size) // a repeated call is not an error
    }

    // The path is rebuilt here and the object must really be there: the caller's word is not proof.
    const path = briefSourcePath(project.id, briefIdIn, BRIEF_TYPES[mime].ext)
    const { data: objects } = await supabase.storage.from(BRIEF_BUCKET).list(`${project.id}/${briefIdIn}`)
    const object = (objects ?? []).find(o => o.name === `source.${BRIEF_TYPES[mime].ext}`)
    const size = Number((object?.metadata as { size?: number } | null | undefined)?.size ?? 0)
    if (!object || !(size > 0)) return fail(409, 'No file has arrived at that upload_url yet. PUT the file there first, then call this again.')
    if (size > MAX_BRIEF_BYTES) {
      await supabase.storage.from(BRIEF_BUCKET).remove([path])
      return fail(413, 'That file is over the size limit.')
    }

    const fileName = safeBriefName(rawName, mime)
    const saved = await attach(supabase, { briefId: briefIdIn, projectId: project.id, path, fileName, mime, byteSize: size, uploadedByName, track })
    if (!saved.ok) return fail(500, saved.error)
    return done(briefIdIn, fileName, size)
  }

  // ── 3a: start a large upload ──────────────────────────────────────────────
  const rawName = str(body.file_name)
  const byteSize = Number(body.byte_size)
  if (!rawName || !Number.isFinite(byteSize)) {
    return fail(400, 'Nothing to upload. Send "text", or a "file" (multipart), or "file_name" and "byte_size" to start a large upload. GET this address for the full instructions.')
  }
  const mime = resolveBriefType({ name: rawName, type: str(body.content_type) })
  if (!mime) return fail(415, TYPES_LINE)
  if (byteSize <= 0) return fail(400, 'That file is empty.')
  if (byteSize > MAX_BRIEF_BYTES) return fail(413, `That file is ${(byteSize / MB).toFixed(1)}MB. The limit is ${MAX_BRIEF_BYTES / MB}MB.`)

  const briefId = crypto.randomUUID()
  const path = briefSourcePath(project.id, briefId, BRIEF_TYPES[mime].ext)
  const { data: signed, error: signErr } = await supabase.storage.from(BRIEF_BUCKET).createSignedUploadUrl(path)
  if (signErr || !signed) return fail(500, signErr?.message ?? 'Could not start the upload.')

  return NextResponse.json({
    ok: true,
    step: 'upload',
    brief_id: briefId,
    upload_url: signed.signedUrl,
    upload: { method: 'PUT', headers: { 'Content-Type': mime }, body: 'the raw file bytes' },
    then: { method: 'POST', url: new URL(request.url).pathname, json: { project_id: project.id, brief_id: briefId, file_name: rawName, track } },
    note: 'The brief is not on the project until the second POST succeeds.',
  })
}

/** Writes the row, then starts the same AI read the project page starts after an upload. */
async function attach(
  supabase: Db,
  b: { briefId: string; projectId: string; path: string; fileName: string; mime: string; byteSize: number; uploadedByName: string; track: Track },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from('project_briefs').insert({
    id: b.briefId,
    project_id: b.projectId,
    storage_path: b.path,
    file_name: b.fileName,
    mime_type: b.mime,
    byte_size: Math.round(b.byteSize),
    uploaded_by_name: b.uploadedByName,
    // Only written for an LP brief, as in attachProjectBrief.
    ...(b.track === 'lp' ? { track: 'lp' } : {}),
  })
  if (error) return { ok: false, error: `Could not save that brief: ${error.message}` }

  // Claim, then read after the response. A failed claim or read leaves the row
  // readable from the project page; the upload itself has already succeeded.
  const { data: claimed } = await supabase
    .from('project_briefs')
    .update({ extraction_status: 'reading', extraction_error: null, extraction_started_at: new Date().toISOString() })
    .eq('id', b.briefId)
    .select('id, project_id, storage_path, mime_type, file_name')
    .maybeSingle()
  if (claimed) {
    after(async () => {
      try {
        await runBriefRead(supabase as unknown as Parameters<typeof runBriefRead>[0], claimed as ClaimedBrief)
      } catch (e) {
        console.error('[brief upload api] read failed', b.briefId, e)
      }
    })
  }
  return { ok: true }
}
