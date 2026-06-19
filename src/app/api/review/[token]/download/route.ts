import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { zipAssets } from '@/lib/zip-assets'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * GET /api/review/[token]/download   (client-facing, token-authed — no login)
 * Zips every creative shown on this review link (client_visible, not hidden).
 * The share token IS the authorization, matching the client review page.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params

  const supabase = await createClient()
  const { data: project } = await supabase
    .from('projects')
    .select('id, name')
    .eq('share_token', token)
    .single()
  if (!project) return NextResponse.json({ error: 'Invalid review link.' }, { status: 404 })

  // Exactly what the client sees on the review page: client-visible, not hidden.
  const { data: assets } = await supabase
    .from('creative_assets')
    .select('id, name, drive_file_id, published_url, sort_order')
    .eq('project_id', project.id)
    .eq('is_hidden', false)
    .eq('client_visible', true)
    .order('sort_order')

  if (!assets || assets.length === 0) {
    return NextResponse.json({ error: 'No images to download yet.' }, { status: 404 })
  }

  const { body, added } = await zipAssets(assets)
  if (added === 0) {
    return NextResponse.json({ error: 'Images could not be fetched.' }, { status: 502 })
  }

  const safeProject = (project.name || 'creatives').replace(/[^\w.-]+/g, '_')
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${safeProject}-${added}.zip"`,
    },
  })
}
