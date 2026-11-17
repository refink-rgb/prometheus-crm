import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getDriveAccessToken, hasDriveServiceAccount } from '@/lib/drive'
import { resolveStatusToken } from '@/lib/status/server'
import { safeName } from '@/lib/status/board'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * GET /api/status/[token]/file?asset=<id>[&dl=1]   (token-authed, no login)
 *
 * One client-approved creative, streamed. The status page's .zip is built in
 * the browser from these, one request per file: most approved files are still
 * only in Drive, which a browser cannot fetch across origins, and a zip built
 * in a function is capped by the platform's response size.
 *
 * The body is passed straight through rather than buffered, so a video costs
 * no memory here and has no size ceiling.
 *
 * Serves a file only when all of this holds: the token is a profit engineer's
 * status link, the creative's brand is theirs and active, and the creative is
 * client-approved, on the review link and not hidden.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const url = new URL(request.url)
  const assetId = url.searchParams.get('asset') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(assetId)) return NextResponse.json({ error: 'Unknown file.' }, { status: 404 })

  const service = createServiceClient()
  const engineer = await resolveStatusToken(service, token)
  if (!engineer) return NextResponse.json({ error: 'Invalid link.' }, { status: 404 })

  const { data: asset } = await service
    .from('creative_assets')
    .select('id, project_id, name, drive_file_id, published_url, media_type, video_url, status, is_hidden, client_visible')
    .eq('id', assetId)
    .maybeSingle()
  if (!asset || asset.status !== 'approved' || asset.is_hidden || !asset.client_visible) {
    return NextResponse.json({ error: 'Unknown file.' }, { status: 404 })
  }

  const { data: project } = await service.from('projects').select('brand_id').eq('id', asset.project_id).maybeSingle()
  const { data: brand } = project
    ? await service.from('brands').select('profit_engineer, is_active').eq('id', project.brand_id).maybeSingle()
    : { data: null }
  if (!brand || brand.profit_engineer !== engineer || !brand.is_active) {
    return NextResponse.json({ error: 'Unknown file.' }, { status: 404 })
  }

  const upstream = await openFile(asset)
  if (!upstream) {
    return NextResponse.json({ error: 'This file could not be fetched from storage.' }, { status: 502 })
  }

  const type = upstream.headers.get('content-type')?.split(';')[0].trim() || 'application/octet-stream'
  const base = safeName(asset.name, `creative-${asset.id.slice(0, 8)}`).replace(/\.(png|jpe?g|webp|gif|mp4|mov|webm|m4v)$/i, '')
  const headers = new Headers({
    'Content-Type': type,
    'Content-Disposition': `${url.searchParams.get('dl') ? 'attachment' : 'inline'}; filename="${base}.${extFor(type)}"`,
    // The link is a secret: let the browser reuse it briefly, never a shared cache.
    'Cache-Control': 'private, max-age=300',
    'X-Robots-Tag': 'noindex',
  })
  const length = upstream.headers.get('content-length')
  if (length) headers.set('Content-Length', length)
  return new Response(upstream.body, { headers })
}

function extFor(type: string): string {
  if (type.includes('mp4')) return 'mp4'
  if (type.includes('quicktime')) return 'mov'
  if (type.includes('webm')) return 'webm'
  if (type.includes('m4v')) return 'm4v'
  if (type.includes('png')) return 'png'
  if (type.includes('webp')) return 'webp'
  if (type.includes('gif')) return 'gif'
  return 'jpg'
}

type FileSource = {
  drive_file_id: string
  published_url: string | null
  media_type: string | null
  video_url: string | null
}

/**
 * The bytes the client signed off: the published version, else the original.
 * Same order as zip-assets.ts. A video's original is our storage copy, because
 * Drive answers a large download with a virus-scan page instead of the file.
 * Returns null when nothing usable came back.
 */
async function openFile(a: FileSource): Promise<Response | null> {
  const stored = a.published_url || (a.media_type === 'video' ? a.video_url : null)
  if (stored && !stored.includes('drive.google.com')) {
    const res = await tryFetch(stored)
    if (res) return res
  }

  // A Drive file. The service account reads it whether or not the folder is
  // shared publicly; the public link is the fallback when there is no account.
  const driveId = driveIdOf(stored) ?? a.drive_file_id
  if (hasDriveServiceAccount()) {
    try {
      const accessToken = await getDriveAccessToken()
      const res = await tryFetch(
        `https://www.googleapis.com/drive/v3/files/${driveId}?alt=media&supportsAllDrives=true`,
        { Authorization: `Bearer ${accessToken}` },
      )
      if (res) return res
    } catch {
      // Fall through to the public link.
    }
  }
  return tryFetch(`https://drive.google.com/uc?export=download&id=${driveId}`)
}

async function tryFetch(src: string, headers?: Record<string, string>): Promise<Response | null> {
  try {
    const res = await fetch(src, { redirect: 'follow', headers })
    if (!res.ok || !res.body) return null
    // Drive answers a file it will not hand over with an HTML page and a 200.
    if ((res.headers.get('content-type') ?? '').includes('text/html')) return null
    return res
  } catch {
    return null
  }
}

/** The file id inside a drive.google.com URL, if that is what this is. */
function driveIdOf(src: string | null): string | null {
  if (!src || !src.includes('drive.google.com')) return null
  return src.match(/[?&]id=([\w-]+)/)?.[1] ?? src.match(/\/d\/([\w-]+)/)?.[1] ?? null
}
