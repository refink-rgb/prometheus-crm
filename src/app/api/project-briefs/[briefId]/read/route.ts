import { NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { canEdit } from '@/lib/permissions'
import { isUuid } from '@/lib/doc-files'
import { STALE_READING_MS } from '@/lib/project-briefs'
import { runBriefRead, type ClaimedBrief } from '@/lib/briefs/run-brief-read'

// The AI read of a creative brief. A Route Handler, NOT a Server Action: Next
// dispatches a page's Server Actions one at a time
// (node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md),
// so a read inside one would freeze every other action on the project page.
//
// Answers 202 once the row is claimed. The read runs in after(), inside this
// route's 300s, and survives the person closing the tab. The page polls.
export const runtime = 'nodejs'
export const maxDuration = 300

const reply = (status: number, body: { ok: boolean; error?: string }) => NextResponse.json(body, { status })

export async function POST(_request: Request, { params }: { params: Promise<{ briefId: string }> }) {
  const { briefId } = await params
  if (!isUuid(briefId)) return reply(404, { ok: false, error: 'Unknown brief.' })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return reply(401, { ok: false, error: 'Not signed in.' })
  if (!(await canEdit(user.email))) return reply(403, { ok: false, error: 'Not authorized.' })

  // The read writes its result up to ~5 minutes from now with THIS session.
  // Refresh while the response can still carry the new cookie, rather than let
  // the token expire mid-read and strand the row in 'reading'.
  const { data: { session } } = await supabase.auth.getSession()
  if (session?.expires_at && session.expires_at * 1000 - Date.now() < 6 * 60_000) {
    await supabase.auth.refreshSession()
  }

  // Atomic claim: only a row not already being read (or whose read is past the
  // ceiling, so dead) flips to 'reading'. Double clicks and two editors = one read.
  const staleBefore = new Date(Date.now() - STALE_READING_MS).toISOString()
  const { data: claimed, error } = await supabase
    .from('project_briefs')
    .update({ extraction_status: 'reading', extraction_error: null, extraction_started_at: new Date().toISOString() })
    .eq('id', briefId)
    .or(`extraction_status.neq.reading,extraction_started_at.lt."${staleBefore}"`)
    .select('id, project_id, storage_path, mime_type, file_name')
    .maybeSingle()

  if (error) return reply(500, { ok: false, error: `Could not start the read: ${error.message}` })
  if (!claimed) {
    const { data: row } = await supabase.from('project_briefs').select('id').eq('id', briefId).maybeSingle()
    return row
      ? reply(409, { ok: false, error: 'Already being read.' })
      : reply(404, { ok: false, error: 'That brief is no longer here.' })
  }

  after(async () => {
    try {
      await runBriefRead(supabase, claimed as ClaimedBrief)
    } catch (e) {
      console.error('[brief read] unhandled', briefId, e)
    }
  })
  return reply(202, { ok: true })
}
