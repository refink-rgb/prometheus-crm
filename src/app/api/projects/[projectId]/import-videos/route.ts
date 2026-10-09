import { NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { canEdit } from '@/lib/permissions'
import { importPendingVideos } from '@/lib/video-import'

// Copies a project's queued Drive videos into storage. A Route Handler, not a
// Server Action: actions from one page run one at a time, and a few minutes of
// copying inside one would freeze every other button on the project page.
//
// Answers 202 straight away; the copying runs in after(), inside this route's
// 300s, and survives the editor closing the tab. The page refreshes itself
// while videos are still preparing.
export const runtime = 'nodejs'
export const maxDuration = 300

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  if (!UUID.test(projectId)) return NextResponse.json({ ok: false, error: 'Unknown project.' }, { status: 404 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 })
  if (!(await canEdit(user.email))) return NextResponse.json({ ok: false, error: 'Not authorized.' }, { status: 403 })

  // Service role for the work itself: it runs after the response, when the
  // editor's session may have expired, and it writes to storage.
  const service = createServiceClient()
  const started = Date.now()
  after(async () => {
    try {
      const s = await importPendingVideos(service, projectId, started + 270_000)
      console.log('[import-videos]', projectId, s)
    } catch (e) {
      console.error('[import-videos] failed', projectId, e)
    }
  })
  return NextResponse.json({ ok: true }, { status: 202 })
}
