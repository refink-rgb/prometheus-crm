import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { canEdit } from '@/lib/permissions'
import { replayStageState } from '@/lib/events'

export const runtime = 'nodejs'

// Phase 1 validation endpoint: proves the event log can reconstruct card state.
//
//   GET /api/events/replay?project=<uuid>   (logged-in team member, in browser)
//
// Returns the stage per track from (a) replaying stage_changed events and
// (b) the live projects row, plus a match verdict. Tracks with no events yet
// replay as null — expected for cards that predate Phase 1 (no backfill) or
// haven't moved since deploy; those don't fail the match.

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !canEdit(user.email)) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 401 })
  }

  const projectId = new URL(request.url).searchParams.get('project')?.trim()
  if (!projectId) {
    return NextResponse.json({ error: 'Pass ?project=<project uuid>.' }, { status: 400 })
  }

  const { data: project, error } = await createServiceClient()
    .from('projects')
    .select('id, name, lp_stage, creatives_stage')
    .eq('id', projectId)
    .single()
  if (error || !project) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
  }

  const replayed = await replayStageState(projectId)

  const lpMatches = replayed.lp === null || replayed.lp === project.lp_stage
  const creativeMatches = replayed.creative === null || replayed.creative === project.creatives_stage

  return NextResponse.json({
    project: { id: project.id, name: project.name },
    live_state: { lp: project.lp_stage, creative: project.creatives_stage },
    replayed_state: { lp: replayed.lp, creative: replayed.creative },
    stage_events_replayed: replayed.event_count,
    match: lpMatches && creativeMatches,
  })
}
