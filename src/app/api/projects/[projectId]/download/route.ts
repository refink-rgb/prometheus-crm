import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { canEdit } from '@/lib/permissions'
import { zipAssets } from '@/lib/zip-assets'

// Zipping fetched images is Node-only and can take a while for a large set.
export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * GET /api/projects/[projectId]/download?set=approved|live   (internal, authed)
 *   approved → creatives the client approved (status='approved')
 *   live     → everything currently client-facing (client_visible=true)
 * Always excludes hidden assets. Images come from the published revision when
 * present, else the original Drive file.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params
  const set = new URL(request.url).searchParams.get('set') === 'live' ? 'live' : 'approved'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
  if (!(await canEdit(user.email))) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  const [{ data: project }, { data: assets }] = await Promise.all([
    supabase.from('projects').select('name').eq('id', projectId).single(),
    (set === 'live'
      ? supabase.from('creative_assets')
          .select('id, name, drive_file_id, published_url, sort_order')
          .eq('project_id', projectId).eq('is_hidden', false).eq('client_visible', true)
          .order('sort_order')
      : supabase.from('creative_assets')
          .select('id, name, drive_file_id, published_url, sort_order')
          .eq('project_id', projectId).eq('is_hidden', false).eq('status', 'approved')
          .order('sort_order')),
  ])

  const label = set === 'live' ? 'client-facing' : 'client-approved'
  if (!assets || assets.length === 0) {
    return NextResponse.json({ error: `No ${label} images to download yet.` }, { status: 404 })
  }

  const { body, added } = await zipAssets(assets)
  if (added === 0) {
    return NextResponse.json(
      { error: 'Images could not be fetched. Ensure the Drive folder is shared "Anyone with the link".' },
      { status: 502 },
    )
  }

  const safeProject = (project?.name || 'project').replace(/[^\w.-]+/g, '_')
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${safeProject}-${set}-${added}.zip"`,
    },
  })
}
