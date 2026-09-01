'use server'

import { revalidatePath } from 'next/cache'

// Revalidation rule of thumb: only invalidate '/' (the dashboard) when the
// mutation changes something the dashboard actually renders — the pipeline
// table reads name/due_date/is_complete/lp_stage/creatives_stage/lp_approved/
// creatives_approved, and the KPI strip reads brand count / MRR. For anything
// else, revalidate only the specific brand/project/pipeline paths.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { canEdit } from '@/lib/permissions'
import type { EditorTrack, Stage } from '@/lib/types'
import { EDITOR_TRACK_META } from '@/lib/types'
import {
  actorFromUser,
  eventsEnabled,
  logEvents,
  STAGE_COLUMN_TO_TRACK,
  type PipelineEventInput,
} from '@/lib/events'
import { createNotifications } from '@/lib/notifications'
import { createServiceClient } from '@/lib/supabase/service'
import {
  ensureDeleteSubfolder,
  extractDriveFolderId,
  hasDriveServiceAccount,
  listDriveFolder,
  moveDriveFile,
} from '@/lib/drive'

export async function createBrand(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  const name = formData.get('name') as string
  const raw = (formData.get('website') as string).trim()
  const website = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  const retainerRaw = (formData.get('monthly_retainer') as string)?.trim()
  const monthly_retainer = retainerRaw ? parseFloat(retainerRaw) : null
  const start_date = (formData.get('start_date') as string) || null
  const profit_engineer = (formData.get('profit_engineer') as string)?.trim() || null

  // Auto-assign next client number
  const { data: maxRow } = await supabase
    .from('brands')
    .select('client_number')
    .order('client_number', { ascending: false })
    .limit(1)
    .single()
  const client_number = ((maxRow?.client_number as number | null) ?? 0) + 1

  const { data, error } = await supabase
    .from('brands')
    .insert({
      name,
      website,
      created_by: user?.id ?? null,
      growth_strategist: user?.email ?? null,
      monthly_retainer,
      start_date,
      profit_engineer,
      pipeline_status: 'intro_contact',
      is_active: false,
      client_number,
    })
    .select()
    .single()

  if (error) throw new Error(error.message)

  redirect(`/brands/${data.id}`)
}

// Returns the redirect path so the client component can navigate itself.
// Never calls redirect() here — that breaks inside client-component try/catch.
export async function createProject(formData: FormData): Promise<{ redirect: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  const brandId = formData.get('brand_id') as string
  const imageUrls = JSON.parse(formData.get('image_urls') as string) as Array<{ path: string; url: string }>

  const str = (key: string) => (formData.get(key) as string)?.trim() || null

  // Handle journey: use existing or create new
  let journey_id = str('journey_id')
  const newJourneyName = str('new_journey_name')

  if (!journey_id && newJourneyName) {
    const { data: newJourney, error: jErr } = await supabase
      .from('journeys')
      .insert({ brand_id: brandId, name: newJourneyName })
      .select()
      .single()
    if (jErr) throw new Error(jErr.message)
    journey_id = newJourney.id
  }

  const momentRaw = formData.get('marketing_moment') as string
  const marketing_moment = momentRaw === '1' ? 1 : momentRaw === '2' ? 2 : null

  // JSON-encoded arrays for headline/subcopy/eyebrow banks. Empty entries dropped
  // server-side so a bank with only 2 filled slots doesn't persist 3 empty strings.
  const jsonArr = (key: string): string[] | null => {
    const raw = formData.get(key) as string | null
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return null
      const cleaned = parsed.map(s => (typeof s === 'string' ? s.trim() : '')).filter(Boolean)
      return cleaned.length > 0 ? cleaned : null
    } catch { return null }
  }

  const { data, error } = await supabase
    .from('projects')
    .insert({
      brand_id: brandId,
      name: formData.get('name') as string,
      due_date: formData.get('due_date') as string,
      stage_brief_due_date:           str('stage_brief_due_date'),
      stage_in_progress_due_date:     str('stage_in_progress_due_date'),
      stage_internal_review_due_date: str('stage_internal_review_due_date'),
      stage_client_review_due_date:   str('stage_client_review_due_date'),
      offer_description: str('offer_description'),
      offer: str('offer'),
      headline: str('headline'),
      body_copy: str('body_copy'),
      supporting_message: str('supporting_message'),
      cta: str('cta'),
      journey_id,
      marketing_moment,
      page_type: str('page_type'),
      product_featured: str('product_featured'),
      product_description: str('product_description'),
      retail_price: str('retail_price'),
      offer_dynamics_type: str('offer_dynamics_type'),
      competitor_reference: str('competitor_reference'),
      client_ad_inspiration: str('client_ad_inspiration'),
      ad_copy_primary_text: str('ad_copy_primary_text'),
      ad_copy_description: str('ad_copy_description'),
      ad_copy_url: str('ad_copy_url'),
      ad_headlines: jsonArr('ad_headlines'),
      ad_subcopies: jsonArr('ad_subcopies'),
      ad_eyebrows: jsonArr('ad_eyebrows'),
      product_images_link: str('product_images_link'),
      lp_editor_id: str('lp_editor_id'),
      creative_editor_id: str('creative_editor_id'),
      created_by: user?.id ?? null,
    })
    .select()
    .single()

  if (error) throw new Error(error.message)

  if (imageUrls.length > 0) {
    const { error: imgErr } = await supabase.from('project_images').insert(
      imageUrls.map(({ path, url }) => ({
        project_id: data.id,
        storage_path: path,
        storage_url: url,
      }))
    )
    if (imgErr) throw new Error(`Failed to attach project images: ${imgErr.message}`)
  }

  revalidatePath(`/brands/${brandId}`)
  return { redirect: `/brands/${brandId}/projects/${data.id}` }
}

export async function updateProjectStage(
  projectId: string,
  brandId: string,
  track: 'lp_stage' | 'creatives_stage',
  stage: Stage
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  // Event log needs the from-stage, so read before writing. Skipped entirely
  // when instrumentation is killed via PROMETHEUS_EVENTS_DISABLED.
  const prev = eventsEnabled()
    ? (await supabase.from('projects').select('lp_stage, creatives_stage, marketing_moment').eq('id', projectId).single()).data
    : null

  const { error } = await supabase
    .from('projects')
    .update({ [track]: stage })
    .eq('id', projectId)

  if (!error && prev && prev[track] !== stage) {
    const actor = actorFromUser(user)
    const eventTrack = STAGE_COLUMN_TO_TRACK[track]
    const events: PipelineEventInput[] = [{
      event_type: 'stage_changed',
      card_id: projectId,
      brand_id: brandId,
      track: eventTrack,
      from_stage: prev[track],
      to_stage: stage,
      ...actor,
      payload: { marketing_moment: prev.marketing_moment },
    }]
    // Entering Client Review IS the "sent to client" signal for a track
    // (per the signed-off Phase 0 semantics).
    if (stage === 'client_review') {
      events.push({
        event_type: 'sent_to_client',
        card_id: projectId,
        brand_id: brandId,
        track: eventTrack,
        ...actor,
        payload: { via: 'stage_change' },
      })
    }
    await logEvents(events)
  }

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
  revalidatePath('/')
}

// One kanban drag / complete-click moves BOTH tracks — that's up to two
// track-scoped stage_changed events, and only for tracks that actually moved.
function bothTrackStageEvents(
  projectId: string,
  brandId: string,
  prev: { lp_stage: Stage; creatives_stage: Stage; marketing_moment: number | null },
  stage: Stage,
  actor: { actor_id: string; actor_label: string },
): PipelineEventInput[] {
  const events: PipelineEventInput[] = []
  for (const column of ['lp_stage', 'creatives_stage'] as const) {
    if (prev[column] === stage) continue
    const track = STAGE_COLUMN_TO_TRACK[column]
    events.push({
      event_type: 'stage_changed',
      card_id: projectId,
      brand_id: brandId,
      track,
      from_stage: prev[column],
      to_stage: stage,
      ...actor,
      payload: { marketing_moment: prev.marketing_moment },
    })
    if (stage === 'client_review') {
      events.push({
        event_type: 'sent_to_client',
        card_id: projectId,
        brand_id: brandId,
        track,
        ...actor,
        payload: { via: 'stage_change' },
      })
    }
  }
  return events
}

// Combined stage update — used by the pipeline kanban drag-drop, which always
// moves both LP and Creatives to the same column. One UPDATE + one server call
// instead of two, so the optimistic UI settles faster.
export async function updateProjectStagesBoth(
  projectId: string,
  brandId: string,
  stage: Stage
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  const prev = eventsEnabled()
    ? (await supabase.from('projects').select('lp_stage, creatives_stage, marketing_moment').eq('id', projectId).single()).data
    : null

  const { error } = await supabase
    .from('projects')
    .update({ lp_stage: stage, creatives_stage: stage })
    .eq('id', projectId)

  if (!error && prev) {
    await logEvents(bothTrackStageEvents(projectId, brandId, prev, stage, actorFromUser(user)))
  }

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
  revalidatePath('/')
  revalidatePath('/pipeline')
}

// Inline edit of a single stage's target date from the pipeline board, so a PM
// can set/clear a phase deadline without opening the project. Manual by design
// — the board is where these dates get managed. Pass `date` as YYYY-MM-DD, or
// null to clear. Only the four in-flight stages carry a date column;
// revisions/live are rejected.
const STAGE_DUE_COLUMN: Partial<Record<Stage, string>> = {
  brief:           'stage_brief_due_date',
  in_progress:     'stage_in_progress_due_date',
  internal_review: 'stage_internal_review_due_date',
  client_review:   'stage_client_review_due_date',
}

export async function updateProjectStageDueDate(
  projectId: string,
  brandId: string,
  stage: Stage,
  date: string | null
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  const column = STAGE_DUE_COLUMN[stage]
  if (!column) throw new Error(`Stage "${stage}" has no target date.`)

  const { error } = await supabase
    .from('projects')
    .update({ [column]: date })
    .eq('id', projectId)
  if (error) throw new Error(error.message)

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
  revalidatePath('/pipeline')
  revalidatePath('/calendar')
}

export async function updateProjectDeliverable(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  const projectId = formData.get('project_id') as string
  const brandId = formData.get('brand_id') as string

  await supabase
    .from('projects')
    .update({
      lp_url: formData.get('lp_url') as string || null,
      creatives_notes: formData.get('creatives_notes') as string || null,
      shopify_coupon_code: (formData.get('shopify_coupon_code') as string)?.trim() || null,
      motion_link: (formData.get('motion_link') as string)?.trim() || null,
    })
    .eq('id', projectId)

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
}

export async function toggleProjectRevisions(projectId: string, brandId: string, value: boolean) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  const { error } = await supabase
    .from('projects')
    .update({ needs_revisions: value })
    .eq('id', projectId)

  // Flipping revisions ON = the PM logging a client revision request (card
  // level — the flag isn't track-scoped). Flipping it off is bookkeeping.
  if (!error && value) {
    await logEvents([{
      event_type: 'client_responded',
      card_id: projectId,
      brand_id: brandId,
      ...actorFromUser(user),
      payload: { response_type: 'revision_requested', via: 'needs_revisions_toggle' },
    }])
  }

  // needs_revisions is not shown on the dashboard — skip '/'.
  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
}

export async function markProjectComplete(projectId: string, brandId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  const prev = eventsEnabled()
    ? (await supabase.from('projects').select('lp_stage, creatives_stage, marketing_moment').eq('id', projectId).single()).data
    : null

  // Completing archives the project; it does NOT invent a terminal stage. Both
  // tracks are already at 'live' (the button only appears then), and pinning
  // them to 'live' keeps a completed project readable — it stays a normal
  // project row with its real stages, deliverables and history intact, just
  // filtered out of the in-flight boards by is_complete.
  const { error } = await supabase
    .from('projects')
    .update({ is_complete: true, lp_stage: 'live', creatives_stage: 'live' })
    .eq('id', projectId)

  if (error) throw new Error(error.message)

  if (prev) {
    await logEvents(bothTrackStageEvents(projectId, brandId, prev, 'live', actorFromUser(user)))
  }

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
  revalidatePath('/')
}

export async function updateBrandDetails(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  const brandId = formData.get('brand_id') as string
  const retainerRaw = (formData.get('monthly_retainer') as string)?.trim()
  const monthly_retainer = retainerRaw ? parseFloat(retainerRaw) : null
  const start_date = (formData.get('start_date') as string) || null
  const growth_strategist = (formData.get('growth_strategist') as string)?.trim() || null
  const clientStatus = formData.get('client_status') as string
  const is_trial = clientStatus === 'trial'
  const is_active = clientStatus === 'active' || clientStatus === 'trial'
  const profit_engineer = (formData.get('profit_engineer') as string)?.trim() || null
  const pipeline_status = (formData.get('pipeline_status') as string) || 'active'
  const brand_notes = (formData.get('brand_notes') as string)?.trim() || null
  const onboarding_transcript = (formData.get('onboarding_transcript') as string)?.trim() || null

  const core = { monthly_retainer, start_date, growth_strategist, is_active, is_trial, profit_engineer, pipeline_status, brand_notes }

  // Try with onboarding_transcript. If the column doesn't exist yet (migration
  // 20260701_add_onboarding_transcript.sql not applied), fall back to a save
  // without it so the rest of the account details still persist.
  const { error } = await supabase
    .from('brands')
    .update({ ...core, onboarding_transcript })
    .eq('id', brandId)

  if (error) {
    const missingColumn = error.code === '42703' || /onboarding_transcript/.test(error.message ?? '')
    if (!missingColumn) throw new Error(error.message)
    await supabase.from('brands').update(core).eq('id', brandId)
  }

  revalidatePath(`/brands/${brandId}`)
}

export async function updateBrandPipelineStatus(
  brandId: string,
  newStatus: 'intro_contact' | 'discovery_call' | 'offer_prep' | 'active',
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  await supabase
    .from('brands')
    .update({ pipeline_status: newStatus })
    .eq('id', brandId)

  // Dashboard doesn't render pipeline_status; the financials page does.
  revalidatePath('/pipeline')
  revalidatePath('/financials')
  revalidatePath(`/brands/${brandId}`)
}

export async function generateShareToken(projectId: string): Promise<string> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated.')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  const { randomBytes } = await import('crypto')
  const token = randomBytes(20).toString('hex')

  await supabase
    .from('projects')
    .update({ share_token: token })
    .eq('id', projectId)

  return token
}

// Fields we need off `projects` to route client-feedback signals to the right
// teammate and know whether to advance the stage.
type FeedbackProject = {
  id: string
  brand_id: string | null
  lp_editor_id: string | null
  creative_editor_id: string | null
  created_by: string | null
  lp_stage: Stage
  creatives_stage: Stage
}
const FEEDBACK_PROJECT_COLS = 'id, brand_id, lp_editor_id, creative_editor_id, created_by, lp_stage, creatives_stage'

// Emitted when a client acts on the public review link (comment / revision /
// approval). Nudges the assigned editor for the affected track and — for
// feedback & revision requests only (never a clean approval) — advances a track
// that is still "Client Review" into "Revisions". Fully best-effort: a missing
// notifications/events table never blocks the client's action.
async function emitClientFeedback(
  supabase: ReturnType<typeof createServiceClient>,
  opts: {
    project: FeedbackProject
    track: 'lp' | 'creative'
    kind: 'comment' | 'revision' | 'approval'
    authorName: string
    title: string
    body: string
    commentId?: string | null
    advance: boolean
  },
) {
  const { project, track, authorName, title, body, commentId, advance, kind } = opts
  const stageCol = track === 'lp' ? 'lp_stage' : 'creatives_stage'
  const editorId = track === 'lp' ? project.lp_editor_id : project.creative_editor_id
  // Fall back to the project creator so feedback is never dropped silently when
  // no editor is assigned to that track yet.
  const recipient = editorId ?? project.created_by ?? null

  if (recipient) {
    await createNotifications([{
      recipient_id: recipient,
      actor_id: null, // the client is not a profile
      actor_label: authorName,
      type: 'client_feedback',
      project_id: project.id,
      brand_id: project.brand_id,
      comment_id: commentId ?? null,
      title,
      body,
      link: project.brand_id
        ? `/brands/${project.brand_id}/projects/${project.id}#client-feedback`
        : null,
    }])
  }

  if (advance && project[stageCol] === 'client_review') {
    // Atomic guard: the .eq(stageCol,'client_review') means a track that has
    // already shipped (live/done) is never dragged backwards by a late comment.
    const { error } = await supabase
      .from('projects')
      .update({ [stageCol]: 'revisions' })
      .eq('id', project.id)
      .eq(stageCol, 'client_review')
    if (!error) {
      if (eventsEnabled()) {
        try {
          await logEvents([{
            event_type: 'stage_changed',
            card_id: project.id,
            brand_id: project.brand_id,
            track,
            from_stage: 'client_review',
            to_stage: 'revisions',
            actor_label: 'client',
            payload: { via: 'review_link', kind },
          }])
        } catch (err) {
          console.error('[emitClientFeedback] event log failed:', err)
        }
      }
      if (project.brand_id) {
        revalidatePath(`/brands/${project.brand_id}/projects/${project.id}`)
        revalidatePath('/') // pipeline/kanban render stage
      }
    }
  }
}

export async function addProjectComment(
  token: string,
  authorName: string,
  content: string,
  extras?: {
    track?: 'lp' | 'image' | 'general' | 'note'
    asset_id?: string
    pin_x?: number
    pin_y?: number
    section_tag?: string
    attachment_urls?: string[]
  }
) {
  // Anonymous client review action — service role (share_token authorizes).
  // The anon client is blocked by RLS, so a client's comment/note would
  // silently fail to save.
  const supabase = createServiceClient()

  const { data: project } = await supabase
    .from('projects')
    .select(FEEDBACK_PROJECT_COLS)
    .eq('share_token', token)
    .single()

  if (!project) throw new Error('Invalid review link.')

  const cleanedAttachments = (extras?.attachment_urls ?? []).filter(u => typeof u === 'string' && u.length > 0)

  const commentTrack = extras?.track ?? 'general'
  const { data: inserted } = await supabase
    .from('project_comments')
    .insert({
      project_id: project.id,
      author_name: authorName.trim(),
      content: content.trim(),
      track: commentTrack,
      asset_id: extras?.asset_id ?? null,
      pin_x: extras?.pin_x ?? null,
      pin_y: extras?.pin_y ?? null,
      section_tag: extras?.section_tag ?? null,
      attachment_urls: cleanedAttachments.length > 0 ? cleanedAttachments : null,
      // Comments from the public review link are always client-facing.
      audience: 'client',
    })
    .select('id')
    .single()

  // Notify the assigned editor and (for review feedback, not a general message)
  // move the track into Revisions. Image comments belong to the creative editor;
  // LP/general to the LP editor. A 'note' is chatter in the Notes thread — it
  // pings the LP editor but never advances the stage.
  const name = authorName.trim() || 'Anonymous'
  const fbTrack: 'lp' | 'creative' = commentTrack === 'image' ? 'creative' : 'lp'
  const title =
    commentTrack === 'image' ? `${name} commented on a creative`
    : commentTrack === 'note' ? `${name} sent a message`
    : `${name} left landing page feedback`
  await emitClientFeedback(supabase, {
    project: project as FeedbackProject,
    track: fbTrack,
    kind: 'comment',
    authorName: name,
    title,
    body: content.trim().slice(0, 140),
    commentId: (inserted as { id?: string } | null)?.id ?? null,
    advance: commentTrack !== 'note',
  })

  revalidatePath(`/review/${token}`)
}

// Authed-only: delete a comment from the client review page. Gated by the same
// canEdit() check used everywhere else — anonymous client viewers can't
// trigger this even if they discover the action.
export async function deleteProjectComment(commentId: string, token: string) {
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) throw new Error('Not authorized.')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  // project_comments RLS has no UPDATE/DELETE policy for the authenticated role,
  // so a delete through the user-session client is silently dropped (0 rows, no
  // error) and the comment reappears on refresh. Route the write through the
  // service-role client — same pattern as addProjectComment. Authorization is
  // unchanged: canEdit above + the share_token ownership check below.
  const supabase = createServiceClient()

  const { data: comment } = await supabase
    .from('project_comments')
    .select('project_id')
    .eq('id', commentId)
    .single()
  if (!comment) throw new Error('Comment not found.')

  const { data: project } = await supabase
    .from('projects')
    .select('id, brand_id')
    .eq('share_token', token)
    .single()
  if (!project || project.id !== comment.project_id) {
    throw new Error('Comment does not belong to this review link.')
  }

  const { error } = await supabase
    .from('project_comments')
    .delete()
    .eq('id', commentId)
  if (error) throw new Error(error.message)

  revalidatePath(`/review/${token}`)
  revalidatePath(`/brands/${project.brand_id}/projects/${project.id}`)
  revalidatePath(`/brands/${project.brand_id}/projects/${project.id}/internal-review`)
}

// Delete a note from the internal project view — same underlying row as
// deleteProjectComment, but scoped by projectId instead of a share token so
// it works even when no client review link has been generated yet. Deleting
// here removes the note from the client portal too (same DB row).
export async function deleteInternalNote(commentId: string, projectId: string, brandId: string) {
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) throw new Error('Not authorized.')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  // Same project_comments RLS gap as deleteProjectComment — the DELETE is
  // silently dropped through the user-session client, so the note returns on
  // refresh. Service-role write; canEdit + ownership check below still gate it.
  const supabase = createServiceClient()

  const { data: comment } = await supabase
    .from('project_comments')
    .select('project_id')
    .eq('id', commentId)
    .single()
  if (!comment || comment.project_id !== projectId) {
    throw new Error('Note does not belong to this project.')
  }

  const { error } = await supabase
    .from('project_comments')
    .delete()
    .eq('id', commentId)
  if (error) throw new Error(error.message)

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
  revalidatePath('/review', 'layout')
}

// Mark a piece of client feedback handled (or reopen it) from the internal
// Client Feedback panel. Internal-only + canEdit-gated; the client review link
// never reads resolved_at, so this never changes what the client sees.
export async function toggleCommentResolved(
  commentId: string,
  projectId: string,
  brandId: string,
  resolved: boolean,
) {
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) throw new Error('Not authorized.')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  // See deleteProjectComment: project_comments has no UPDATE policy for the
  // authenticated role, so this resolve toggle is silently dropped through the
  // user-session client and reverts on refresh. Write via the service-role
  // client; canEdit above + the project-ownership check below still gate it.
  const supabase = createServiceClient()

  const { data: comment } = await supabase
    .from('project_comments')
    .select('project_id')
    .eq('id', commentId)
    .single()
  if (!comment || comment.project_id !== projectId) {
    throw new Error('Comment does not belong to this project.')
  }

  const { error } = await supabase
    .from('project_comments')
    .update({ resolved_at: resolved ? new Date().toISOString() : null })
    .eq('id', commentId)
  if (error) throw new Error(error.message)

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
}

export async function syncDriveImages(projectId: string, brandId: string, folderUrl: string): Promise<number> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  // Auth is now handled inside listDriveFolder (prefers SA, falls back to API key).
  const folderId = extractDriveFolderId(folderUrl)

  // First, save the folder URL on the project
  await supabase
    .from('projects')
    .update({ drive_folder_url: folderUrl })
    .eq('id', projectId)

  const imageFiles = await listDriveFolder(folderId)

  const driveFileIds = imageFiles.map(f => f.id)

  // Soft-hide assets no longer in the root Drive folder. We DON'T hard-delete:
  // (1) the file may have been moved into Delete/ via the Drive helper here,
  // (2) preserving the row keeps comments, revisions, and publish history intact.
  const { data: existing } = await supabase
    .from('creative_assets')
    .select('id, drive_file_id')
    .eq('project_id', projectId)

  const toHide = (existing ?? []).filter(a => !driveFileIds.includes(a.drive_file_id))
  if (toHide.length > 0) {
    await supabase
      .from('creative_assets')
      .update({ is_hidden: true })
      .in('id', toHide.map(a => a.id))
  }

  if (imageFiles.length === 0) {
    revalidatePath(`/brands/${brandId}/projects/${projectId}`)
    return 0
  }

  // Upsert assets — preserve is_hidden for existing entries
  const { error } = await supabase
    .from('creative_assets')
    .upsert(
      imageFiles.map((f, i) => ({
        project_id: projectId,
        drive_file_id: f.id,
        name: f.name,
        thumbnail_url: `https://drive.google.com/thumbnail?id=${f.id}&sz=w600`,
        sort_order: i,
      })),
      { onConflict: 'project_id,drive_file_id', ignoreDuplicates: false }
    )

  if (error) throw new Error(error.message)

  // New creatives start INTERNAL-ONLY — they only reach the client once
  // explicitly published. (Only touch genuinely new ones, so re-syncing never
  // un-publishes anything already live with the client.)
  const existingIds = new Set((existing ?? []).map(a => a.drive_file_id))
  const newIds = driveFileIds.filter(id => !existingIds.has(id))
  if (newIds.length > 0) {
    await supabase
      .from('creative_assets')
      .update({ client_visible: false })
      .eq('project_id', projectId)
      .in('drive_file_id', newIds)
  }

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
  return imageFiles.length
}

function describePosition(x: number, y: number): string {
  const h = x < 33 ? 'left' : x < 66 ? 'center' : 'right'
  const v = y < 25 ? 'top' : y < 75 ? 'middle' : 'bottom'
  return `${v}-${h}`
}

// A comment is actionable if it reads like a change request, not a pure
// question or note. (v1 heuristic — can be upgraded to an LLM classifier.)
function isActionableComment(content: string | null): boolean {
  const t = (content || '').trim()
  if (!t) return false
  const isQuestion = t.endsWith('?') &&
    /^(is|are|was|were|do|does|did|can|could|should|would|will|why|what|how|when|where|who|which)\b/i.test(t)
  return !isQuestion
}

function buildRevisionPrompt(comments: Array<{
  author_name: string; content: string; pin_x: number | null; pin_y: number | null
}>): string {
  const pinned = comments.filter(c => c.pin_x != null)
  const general = comments.filter(c => c.pin_x == null)
  const lines = [
    'Edit this marketing creative image. Apply the following reviewer-requested changes while maintaining the overall design style, brand colors, layout, and composition.',
    '',
    'REQUESTED CHANGES:',
  ]
  pinned.forEach((c, i) => {
    const pos = describePosition(c.pin_x!, c.pin_y!)
    lines.push(`${i + 1}. [${pos} area — from ${c.author_name}]: ${c.content}`)
  })
  general.forEach((c, i) => {
    lines.push(`${pinned.length + i + 1}. [General — from ${c.author_name}]: ${c.content}`)
  })
  lines.push('', 'Maintain brand identity and only make the specific changes listed above.')
  return lines.join('\n')
}

export async function applyAiEdits(
  assetId: string,
  projectId: string,
  brandId: string,
  quality: 'low' | 'medium' | 'high' = 'low'
): Promise<{ revisionUrl: string; prompt: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  const openaiKey = process.env.OPENAI_API_KEY
  if (!openaiKey) throw new Error('OPENAI_API_KEY is not set — add it in Vercel → Settings → Environment Variables.')

  // Fetch asset
  const { data: asset } = await supabase
    .from('creative_assets')
    .select('*')
    .eq('id', assetId)
    .single()
  if (!asset) throw new Error('Asset not found.')

  // Open feedback only. Resolved comments were being fed back into the prompt,
  // so ticking something off did not stop the next revision from redoing it —
  // and on an ad reviewed more than once, old handled notes kept re-applying
  // over the newer ones.
  const { data: comments } = await supabase
    .from('project_comments')
    .select('author_name, content, pin_x, pin_y')
    .eq('asset_id', assetId)
    .is('resolved_at', null)
    .order('created_at')

  if (!comments || comments.length === 0) {
    throw new Error('No open feedback on this image. Add reviewer feedback — or un-resolve a comment — before generating a revision.')
  }

  // Only feed actionable change requests to the model — skip pure questions /
  // notes (e.g. "Is this a real review?") so they don't corrupt the revision.
  const actionable = comments.filter(c => isActionableComment(c.content))
  if (actionable.length === 0) {
    throw new Error('No actionable edit requests found — the comments read like questions or notes, not change requests.')
  }

  const prompt = buildRevisionPrompt(actionable)

  // Edit the version that is actually current, not always the Drive original.
  //
  // This used to fetch the Drive file unconditionally. If an editor had fixed
  // the ad by hand and uploaded it, generating an AI revision silently threw
  // that fix away and edited the untouched original instead — no error, and
  // nothing on screen said the hand-edit had been discarded.
  const editingRevision = !!asset.revision_url
  const sourceUrl = asset.revision_url
    ?? `https://drive.google.com/uc?export=download&id=${asset.drive_file_id}`
  const imageRes = await fetch(sourceUrl, { redirect: 'follow' })
  if (!imageRes.ok) {
    throw new Error(
      editingRevision
        ? `Failed to download the current revision (HTTP ${imageRes.status}).`
        : `Failed to download image from Drive (HTTP ${imageRes.status}). Make sure the file is publicly shared.`,
    )
  }

  const imageBuffer = Buffer.from(await imageRes.arrayBuffer())

  // Build the edit request
  const { default: OpenAI, toFile } = await import('openai')
  const openai = new OpenAI({ apiKey: openaiKey })
  const imageFile = await toFile(imageBuffer, 'creative.jpg', { type: 'image/jpeg' })

  const response = await (openai.images as unknown as {
    edit: (params: unknown) => Promise<{ data: Array<{ b64_json?: string }> }>
  }).edit({
    model: 'gpt-image-2',
    image: imageFile,
    prompt,
    n: 1,
    size: 'auto',
    quality,
  })

  const b64 = response.data[0]?.b64_json
  if (!b64) throw new Error('OpenAI returned no image data. Try again.')

  // Upload revision to Supabase storage
  const revisionBuffer = Buffer.from(b64, 'base64')
  const revisionPath = `revisions/${assetId}-${Date.now()}.png`
  const { error: uploadError } = await supabase.storage
    .from('project-images')
    .upload(revisionPath, revisionBuffer, { contentType: 'image/png', upsert: true })
  if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`)

  const { data: { publicUrl } } = supabase.storage.from('project-images').getPublicUrl(revisionPath)

  // Persist revision on asset
  await supabase
    .from('creative_assets')
    .update({ revision_url: publicUrl, revision_prompt: prompt, revision_created_at: new Date().toISOString() })
    .eq('id', assetId)

  // …and append it to the asset's edit history so the panel can label this
  // "Edit N" and link back through the earlier versions.
  const { recordAssetRevision } = await import('@/lib/revisions')
  await recordAssetRevision(supabase, {
    assetId,
    imageUrl: publicUrl,
    prompt,
    createdBy: user.email ?? null,
  })

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
  revalidatePath(`/brands/${brandId}/projects/${projectId}/internal-review`)
  return { revisionUrl: publicUrl, prompt }
}

// Team action (authenticated): publish the CURRENT revision to the client.
// Freezes published_url to whatever revision exists now — so later edits (which
// update revision_url) don't reach the client until you publish again.
export async function approveAndPublishRevision(assetId: string, projectId: string, brandId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  const { data: asset } = await supabase
    .from('creative_assets')
    .select('revision_url')
    .eq('id', assetId)
    .single()

  // Publish to client = make it client-visible + freeze the published image to
  // the current revision (or the original, if there's no revision — publish as-is).
  // Do NOT touch status: "approved" is the CLIENT's action on the review link.
  const update: { client_visible: boolean; published_url?: string } = {
    client_visible: true,
  }
  if (asset?.revision_url) update.published_url = asset.revision_url

  const { error } = await supabase
    .from('creative_assets')
    .update(update)
    .eq('id', assetId)
  if (error) throw new Error(error.message)

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
  revalidatePath(`/review`, 'layout')
}

/**
 * Bulk "Publish to client" — same semantics as approveAndPublishRevision but for
 * many assets at once. For each: client_visible=true and published_url frozen to
 * its current revision (or left as-is/original if no revision). Never touches
 * `status` — client approval stays the client's action. Returns the count published.
 *
 * If `assetIds` is omitted, publishes every not-yet-visible asset on the project
 * (the "publish all internal" path).
 */
export async function publishAssets(
  projectId: string,
  brandId: string,
  assetIds?: string[]
): Promise<number> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  let query = supabase
    .from('creative_assets')
    .select('id, revision_url, client_visible, published_url')
    .eq('project_id', projectId)
    .eq('is_hidden', false)
  if (assetIds && assetIds.length > 0) {
    query = query.in('id', assetIds)
  } else {
    // "Publish all internal": only those not already live on the client.
    query = query.eq('client_visible', false)
  }

  const { data: rows, error: selErr } = await query
  if (selErr) throw new Error(selErr.message)

  // Two update shapes: rows without a revision_url just flip client_visible;
  // rows with a revision_url also copy it into published_url. Batch the first
  // group into one query; parallelize the second because published_url differs
  // per row.
  const rowsList = rows ?? []
  const plainIds = rowsList.filter(r => !r.revision_url).map(r => r.id)
  const withRevision = rowsList.filter(r => r.revision_url)

  let published = 0

  if (plainIds.length > 0) {
    const { error } = await supabase
      .from('creative_assets')
      .update({ client_visible: true })
      .in('id', plainIds)
    if (error) console.error('[publishAssets] batch update failed:', error.message)
    else published += plainIds.length
  }

  if (withRevision.length > 0) {
    const results = await Promise.all(withRevision.map(row =>
      supabase
        .from('creative_assets')
        .update({ client_visible: true, published_url: row.revision_url })
        .eq('id', row.id)
        .then(({ error }) => ({ id: row.id, error }))
    ))
    for (const r of results) {
      if (r.error) console.error(`[publishAssets] failed for ${r.id}:`, r.error.message)
      else published += 1
    }
  }

  // Publishing puts creatives in front of the client — a sent_to_client signal
  // for the creative track, additional to the client_review stage transition.
  if (published > 0) {
    await logEvents([{
      event_type: 'sent_to_client',
      card_id: projectId,
      brand_id: brandId,
      track: 'creative',
      ...actorFromUser(user),
      payload: { via: 'publish_assets', published_count: published },
    }])
  }

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
  revalidatePath(`/brands/${brandId}/projects/${projectId}/internal-review`)
  revalidatePath(`/review`, 'layout')
  return published
}

// The inverse of publishAssets: pull every creative back off the client review
// link. Nothing is destroyed — the assets, their revisions and their pinned
// comments all stay put, and publishing again restores them. Only the
// client_visible flag moves, so `published_url` is left alone as the record of
// what the client last saw.
// Per-asset client visibility. The bulk unpublish already existed; this is the
// missing single-asset OFF switch.
//
// Deliberately NOT is_hidden: that flag is owned by the Drive sync (it soft-hides
// anything that leaves the root folder), so a value set by hand there can be
// flipped back by a routine sync — and it also hides the asset from our own
// editors. client_visible is the client-facing flag and nothing else writes it.
// Upload a revised creative straight onto the asset it replaces.
//
// This is the answer to "where does the fixed file go". Today editors put
// revisions in a Drive subfolder, which breaks the sync twice over: it only
// reads the root folder, and it soft-hides anything that left it. Worse, a new
// Drive file gets a new drive_file_id and lands as a SEPARATE asset, orphaned
// from the comments and status on the one it was meant to replace.
//
// Uploading here writes the same fields an AI edit writes, so the revision
// attaches to the existing asset and shows up as the next Edit in its history.
// Drive stays the pristine v1 source and nothing has to move inside it.
// Make ONE specific version the thing the client sees.
//
// Replaces the old "Push to client" button, which always published whatever the
// latest internal edit happened to be and showed you neither what you were
// replacing nor what they had been looking at. Selecting a version directly is
// unambiguous, and it also buys rollback for free: if Edit 3 was worse, point
// the client back at Edit 1 without deleting anything.
//
// Pass null for imageUrl to publish the ORIGINAL Drive image.
// Push every client-approved creative into an "Approved" subfolder of the
// project's Drive folder, so media buyers have one link with only the finals.
//
// Manual, not automatic on approval: approvals get reversed and clients change
// their minds, and a folder that rewrites itself on every status flip is one
// nobody can trust. One deliberate action, and the folder means "considered
// handoff" rather than "live feed".
//
// Safe against the sync: listDriveFolder is non-recursive ('folderId' in
// parents), so files placed in this subfolder are never pulled back in as new
// assets. Uploads overwrite by filename, so pushing twice refreshes rather than
// accumulating "file (1).png".
// NOT WIRED TO ANY UI. Service accounts have no storage quota of their own, so
// uploading into a normal My Drive folder fails with "Service Accounts do not
// have storage quota" — folders work (they cost no quota), file bytes do not.
// Kept because it becomes a one-line re-enable if domain-wide delegation is ever
// configured (add `subject: <a real user>` to the JWT in lib/drive.ts). Until
// then the Download-approved zip is the handoff to media buyers.
export async function pushApprovedToDrive(
  projectId: string,
  brandId: string,
): Promise<{ ok: true; pushed: number; replaced: number; folderId: string } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  const { hasDriveServiceAccount, extractDriveFolderId, ensureSubfolder, uploadFileToDriveFolder } =
    await import('@/lib/drive')

  // Creating a folder and uploading are writes — the API-key fallback can't do either.
  if (!hasDriveServiceAccount()) {
    return { ok: false, error: 'Pushing to Drive needs the service account (GOOGLE_DRIVE_SA_KEY). An API key can only read.' }
  }

  const { data: project } = await supabase
    .from('projects')
    .select('drive_folder_url')
    .eq('id', projectId)
    .single()
  if (!project?.drive_folder_url) {
    return { ok: false, error: 'This project has no Drive folder linked yet.' }
  }

  const { data: assets } = await supabase
    .from('creative_assets')
    .select('id, name, drive_file_id, published_url, status, is_hidden')
    .eq('project_id', projectId)
    .eq('is_hidden', false)
    .eq('status', 'approved')

  const approved = assets ?? []
  if (approved.length === 0) return { ok: false, error: 'Nothing is client-approved on this project yet.' }

  try {
    const parentId = extractDriveFolderId(project.drive_folder_url)
    const folderId = await ensureSubfolder(parentId, 'Approved')

    let pushed = 0, replaced = 0
    for (const a of approved) {
      // The approved file is the PUBLISHED version — what the client actually
      // signed off. Falls back to the Drive original when nothing was published.
      const src = a.published_url
        ?? `https://drive.google.com/uc?export=download&id=${a.drive_file_id}`
      const res = await fetch(src, { redirect: 'follow' })
      if (!res.ok) continue
      const bytes = Buffer.from(await res.arrayBuffer())
      const name = a.name ?? `${a.id}.png`
      const mime = res.headers.get('content-type')?.startsWith('image/')
        ? res.headers.get('content-type')!
        : 'image/png'
      const out = await uploadFileToDriveFolder(folderId, name, bytes, mime)
      pushed++
      if (out.replaced) replaced++
    }

    revalidatePath(`/brands/${brandId}/projects/${projectId}`)
    revalidatePath(`/preview/project/${projectId}`)
    return { ok: true, pushed, replaced, folderId }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Drive push failed.' }
  }
}

export async function setClientVersion(
  assetId: string,
  imageUrl: string | null,
  projectId: string,
  brandId: string,
): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  // Choosing a version implies the client should be able to see it. The
  // separate visibility switch stays the way to take it back off the link.
  const { error } = await supabase
    .from('creative_assets')
    .update({ published_url: imageUrl, client_visible: true })
    .eq('id', assetId)
  if (error) throw new Error(`Failed to publish that version: ${error.message}`)

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
  revalidatePath(`/preview/project/${projectId}`)
}

export async function uploadAssetRevision(
  formData: FormData,
): Promise<{ ok: true; revisionNumber: number | null } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  const file = formData.get('file') as File | null
  const assetId = formData.get('asset_id') as string
  const projectId = formData.get('project_id') as string
  const brandId = formData.get('brand_id') as string
  if (!file || !assetId) return { ok: false, error: 'Missing file or asset.' }
  if (!file.type.startsWith('image/')) return { ok: false, error: 'That is not an image file.' }

  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    // Same path shape the AI editor uses, so both kinds of revision live together.
    const path = `revisions/${assetId}-${Date.now()}.png`
    const { error: upErr } = await supabase.storage
      .from('project-images')
      .upload(path, buffer, { contentType: file.type || 'image/png', upsert: false, cacheControl: '31536000' })
    if (upErr) return { ok: false, error: `Upload failed: ${upErr.message}` }

    const { data: { publicUrl } } = supabase.storage.from('project-images').getPublicUrl(path)

    // revision_url only — NOT published_url. The client keeps seeing the last
    // published version until someone explicitly sends the latest.
    const { error } = await supabase
      .from('creative_assets')
      .update({ revision_url: publicUrl, revision_created_at: new Date().toISOString() })
      .eq('id', assetId)
    if (error) return { ok: false, error: `Failed to attach revision: ${error.message}` }

    const { recordAssetRevision } = await import('@/lib/revisions')
    const revisionNumber = await recordAssetRevision(supabase, {
      assetId,
      imageUrl: publicUrl,
      prompt: null,
      createdBy: user.email ?? null,
    })

    revalidatePath(`/brands/${brandId}/projects/${projectId}`)
    revalidatePath(`/preview/project/${projectId}`)
    return { ok: true, revisionNumber }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Upload failed.' }
  }
}

export async function setAssetClientVisible(
  assetId: string,
  visible: boolean,
  projectId: string,
  brandId: string,
): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  // Turning it ON freezes what the client sees to the current internal revision,
  // matching approveAndPublishRevision. Turning it OFF leaves published_url alone
  // so switching back on doesn't silently show a different image than before.
  const update: { client_visible: boolean; published_url?: string } = { client_visible: visible }
  if (visible) {
    const { data: asset } = await supabase
      .from('creative_assets')
      .select('revision_url, published_url')
      .eq('id', assetId)
      .single()
    if (asset?.revision_url && !asset.published_url) update.published_url = asset.revision_url
  }

  const { error } = await supabase.from('creative_assets').update(update).eq('id', assetId)
  if (error) throw new Error(`Failed to update visibility: ${error.message}`)

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
  revalidatePath(`/preview/project/${projectId}`)
}

export async function unpublishAllAssets(
  projectId: string,
  brandId: string
): Promise<number> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  const { data: rows, error: selErr } = await supabase
    .from('creative_assets')
    .select('id')
    .eq('project_id', projectId)
    .eq('client_visible', true)
  if (selErr) throw new Error(selErr.message)

  const ids = (rows ?? []).map(r => r.id)
  if (ids.length === 0) return 0

  const { error } = await supabase
    .from('creative_assets')
    .update({ client_visible: false })
    .in('id', ids)
  if (error) throw new Error(error.message)

  // No pipeline event: `event_type` is CHECK-constrained to the five pipeline
  // milestones, and pulling creatives back is a correction rather than a
  // milestone. Adding a type here would mean a migration for no timeline value.

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
  revalidatePath(`/brands/${brandId}/projects/${projectId}/internal-review`)
  revalidatePath(`/review`, 'layout')
  return ids.length
}

// Internal helper: move a single asset's Drive file into the project's Delete
// subfolder and set is_hidden=true. Does NOT do auth — callers gate access.
// Throws on Drive failure; callers decide whether to swallow that error.
// Callers batching over many assets should pass `driveFolderUrl` to avoid
// re-fetching the project row per asset.
async function _archiveAssetCore(
  supabase: Awaited<ReturnType<typeof createClient>>,
  assetId: string,
  projectId: string,
  driveFolderUrl?: string
): Promise<void> {
  const { data: asset } = await supabase
    .from('creative_assets')
    .select('drive_file_id')
    .eq('id', assetId)
    .eq('project_id', projectId)
    .single()
  if (!asset) throw new Error('Asset not found.')

  let folderUrl = driveFolderUrl
  if (!folderUrl) {
    const { data: project } = await supabase
      .from('projects')
      .select('drive_folder_url')
      .eq('id', projectId)
      .single()
    folderUrl = project?.drive_folder_url
  }
  if (!folderUrl) {
    throw new Error('Project has no Drive folder configured — cannot move file to Delete.')
  }

  const parentFolderId = extractDriveFolderId(folderUrl)
  const deleteFolderId = await ensureDeleteSubfolder(parentFolderId)
  await moveDriveFile(asset.drive_file_id, parentFolderId, deleteFolderId)

  await supabase
    .from('creative_assets')
    .update({ is_hidden: true })
    .eq('id', assetId)
}

// Internal helper: restore an asset from Delete back to the project's root
// Drive folder, and set is_hidden=false.
async function _restoreAssetCore(
  supabase: Awaited<ReturnType<typeof createClient>>,
  assetId: string,
  projectId: string
): Promise<void> {
  const { data: asset } = await supabase
    .from('creative_assets')
    .select('drive_file_id')
    .eq('id', assetId)
    .eq('project_id', projectId)
    .single()
  if (!asset) throw new Error('Asset not found.')

  const { data: project } = await supabase
    .from('projects')
    .select('drive_folder_url')
    .eq('id', projectId)
    .single()
  if (!project?.drive_folder_url) {
    throw new Error('Project has no Drive folder configured — cannot restore file.')
  }

  const parentFolderId = extractDriveFolderId(project.drive_folder_url)
  const deleteFolderId = await ensureDeleteSubfolder(parentFolderId)
  // Reverse the move: from Delete → back to root.
  await moveDriveFile(asset.drive_file_id, deleteFolderId, parentFolderId)

  await supabase
    .from('creative_assets')
    .update({ is_hidden: false })
    .eq('id', assetId)
}

/**
 * Move a creative's Drive file into the project's "Delete" subfolder and
 * soft-hide it in the CRM. Authed; gated by canEdit.
 */
export async function archiveAssetToDeleteFolder(
  assetId: string,
  projectId: string,
  brandId: string
): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  await _archiveAssetCore(supabase, assetId, projectId)

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
  revalidatePath(`/brands/${brandId}/projects/${projectId}/internal-review`)
  revalidatePath('/review', 'layout')
}

/**
 * Batch-purge stale assets (is_hidden=true OR status='rejected') by moving
 * each to the project's Delete subfolder. Idempotent: already-moved files
 * are skipped. Authed.
 *
 * If `assetIds` is provided, only those IDs are touched. Otherwise every
 * stale asset on the project is purged.
 *
 * Returns the count of assets the action processed (i.e. for which the
 * Drive move + hide succeeded). Failed assets are logged but do not abort
 * the batch.
 */
export async function purgeStaleAssets(
  projectId: string,
  brandId: string,
  assetIds?: string[]
): Promise<number> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  let query = supabase
    .from('creative_assets')
    .select('id, is_hidden, status, internal_status')
    .eq('project_id', projectId)

  if (assetIds && assetIds.length > 0) {
    query = query.in('id', assetIds)
  }

  const { data: rows, error } = await query
  if (error) throw new Error(error.message)

  const targets = (rows ?? []).filter(a =>
    assetIds && assetIds.length > 0 ? true : a.is_hidden || a.status === 'rejected' || a.internal_status === 'rejected'
  )

  // Fetch the project's drive folder once and pass it into each archive call,
  // instead of re-fetching per asset (was 2N+1 queries).
  let driveFolderUrl: string | undefined
  if (targets.length > 0) {
    const { data: project } = await supabase
      .from('projects')
      .select('drive_folder_url')
      .eq('id', projectId)
      .single()
    driveFolderUrl = project?.drive_folder_url ?? undefined
    if (!driveFolderUrl) {
      throw new Error('Project has no Drive folder configured — cannot move files to Delete.')
    }
  }

  let purged = 0
  for (const row of targets) {
    try {
      await _archiveAssetCore(supabase, row.id, projectId, driveFolderUrl)
      purged += 1
    } catch (err) {
      console.error(`[purgeStaleAssets] failed for asset ${row.id}:`, err)
    }
  }

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
  revalidatePath(`/brands/${brandId}/projects/${projectId}/internal-review`)
  revalidatePath('/review', 'layout')
  return purged
}

// Called from public review page via share token
export async function updateAssetStatus(token: string, assetId: string, status: 'pending' | 'approved' | 'needs_revision' | 'rejected') {
  // Anonymous client review action — write via the service role (the
  // share_token is the authorization). The anon client is blocked by RLS, so
  // the status change would silently not persist and revert on refresh.
  const supabase = createServiceClient()

  // Verify the asset belongs to this token's project
  const { data: project } = await supabase
    .from('projects')
    .select(FEEDBACK_PROJECT_COLS)
    .eq('share_token', token)
    .single()
  if (!project) throw new Error('Invalid review link.')

  const { data: asset, error } = await supabase
    .from('creative_assets')
    .update({ status })
    .eq('id', assetId)
    .eq('project_id', project.id)
    .select('name')
    .single()

  if (error) throw new Error(error.message)

  // A revision request / rejection is client feedback the creative editor must
  // act on → notify them and move the creatives track into Revisions. Approving
  // or clearing a single asset does not (whole-track approval is a separate
  // action via approveProject).
  if (status === 'needs_revision' || status === 'rejected') {
    const label = (asset as { name?: string | null } | null)?.name?.trim() || 'a creative'
    await emitClientFeedback(supabase, {
      project: project as FeedbackProject,
      track: 'creative',
      kind: 'revision',
      authorName: 'The client',
      title: status === 'rejected' ? `Client rejected ${label}` : `Client requested a revision on ${label}`,
      body: status === 'rejected' ? 'Concept rejected on the review link.' : 'Revision requested on the review link.',
      advance: true,
    })
  }

  // Side-effect: keep the Drive layout in sync with the client's decision.
  //   - reject → move file to Delete/ + soft-hide (best-effort).
  //   - un-reject (back to pending) → move it back + un-hide (best-effort).
  // Drive failures (no SA configured yet, no drive_folder_url on project, etc.)
  // are swallowed so the status update itself always succeeds — the team can
  // run the manual "Purge stale" button later.
  if (hasDriveServiceAccount()) {
    try {
      if (status === 'rejected') {
        await _archiveAssetCore(supabase, assetId, project.id)
      } else if (status === 'pending') {
        // Only attempt restore if it was previously archived.
        const { data: a } = await supabase
          .from('creative_assets')
          .select('is_hidden')
          .eq('id', assetId)
          .single()
        if (a?.is_hidden) {
          await _restoreAssetCore(supabase, assetId, project.id)
        }
      }
    } catch (err) {
      console.error('[updateAssetStatus] Drive sync failed (status update kept):', err)
    }
  }

  revalidatePath(`/review/${token}`)
}

// Authed internal version — accepts the wider status union (incl. 'rejected')
// and revalidates BOTH the internal project page and the client review surface
// (the client should see status changes the team makes from the internal page).
export async function updateAssetStatusInternal(
  assetId: string,
  projectId: string,
  brandId: string,
  status: 'pending' | 'approved' | 'needs_revision' | 'rejected'
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  // INTERNAL QC writes its OWN column — never the client-facing `status`. This
  // keeps an internal approve/reject from showing up on the client review link.
  const { error } = await supabase
    .from('creative_assets')
    .update({ internal_status: status })
    .eq('id', assetId)
    .eq('project_id', projectId)

  if (error) throw new Error(error.message)

  // Mirror the client-side reject behaviour from updateAssetStatus: keep Drive
  // in sync best-effort. Internal users get the same auto-archive on reject.
  if (hasDriveServiceAccount()) {
    try {
      if (status === 'rejected') {
        await _archiveAssetCore(supabase, assetId, projectId)
      } else if (status === 'pending') {
        const { data: a } = await supabase
          .from('creative_assets')
          .select('is_hidden')
          .eq('id', assetId)
          .single()
        if (a?.is_hidden) {
          await _restoreAssetCore(supabase, assetId, projectId)
        }
      }
    } catch (err) {
      console.error('[updateAssetStatusInternal] Drive sync failed (status update kept):', err)
    }
  }

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
  revalidatePath(`/brands/${brandId}/projects/${projectId}/internal-review`)
  // Client review link revalidate (token unknown here — invalidate the segment).
  revalidatePath('/review', 'layout')
}

// Authed: post a comment from the internal review page. Always tagged
// audience='internal' so the client never sees it on their review link, and
// (importantly) so `applyAiEdits` can be scoped to internal-only feedback later.
export async function addInternalAssetComment(input: {
  projectId: string
  brandId: string
  assetId: string
  content: string
  displayName: string
  pin_x?: number
  pin_y?: number
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  const name = input.displayName.trim() || user.email?.split('@')[0] || 'Team'

  const { error } = await supabase.from('project_comments').insert({
    project_id: input.projectId,
    author_name: name,
    content: input.content.trim(),
    track: 'image',
    asset_id: input.assetId,
    pin_x: input.pin_x ?? null,
    pin_y: input.pin_y ?? null,
    section_tag: null,
    audience: 'internal',
  })
  if (error) throw new Error(error.message)

  revalidatePath(`/brands/${input.brandId}/projects/${input.projectId}`)
  revalidatePath(`/brands/${input.brandId}/projects/${input.projectId}/internal-review`)
}

// Upload a reference image (used by "Ask Claude to edit") into Supabase storage.
// Returns the storage path (used as a handle by applyDirectPrompt) and a public URL.
export async function uploadInternalReference(formData: FormData): Promise<{ storagePath: string; publicUrl: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  const file = formData.get('file') as File | null
  const assetId = (formData.get('asset_id') as string) || 'unknown'
  if (!file) throw new Error('No file provided.')

  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
  const slug = file.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'ref'
  const path = `internal-references/${assetId}-${Date.now()}-${slug}.${ext}`

  const buffer = Buffer.from(await file.arrayBuffer())
  const { error: uploadError } = await supabase.storage
    .from('project-images')
    .upload(path, buffer, { contentType: file.type || 'image/png', upsert: false })
  if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`)

  const { data: { publicUrl } } = supabase.storage.from('project-images').getPublicUrl(path)
  return { storagePath: path, publicUrl }
}

// Apply a freeform, literal prompt to the asset's current image. Parallel to
// applyAiEdits but doesn't compile comments — the operator types the prompt.
//
// Reference-image trade-off (v1): `openai.images.edit` accepts a SINGLE image.
// If exactly one reference image is uploaded, we treat IT as the source (so the
// model sees "edit this reference"). Otherwise we keep the asset's current
// image as the source and append a brief note to the prompt naming how many
// references were uploaded for context. A future upgrade would use gpt-image-2's
// multimodal input directly to pass multiple images.
export async function applyDirectPrompt(input: {
  assetId: string
  projectId: string
  brandId: string
  prompt: string
  quality: 'low' | 'medium' | 'high'
  referenceImagePaths?: string[]
}): Promise<{ revisionUrl: string; prompt: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  const openaiKey = process.env.OPENAI_API_KEY
  if (!openaiKey) throw new Error('OPENAI_API_KEY is not set — add it in Vercel → Settings → Environment Variables.')

  const trimmedPrompt = (input.prompt || '').trim()
  if (!trimmedPrompt) throw new Error('Prompt is empty.')

  const { data: asset } = await supabase
    .from('creative_assets')
    .select('*')
    .eq('id', input.assetId)
    .single()
  if (!asset) throw new Error('Asset not found.')

  const refs = input.referenceImagePaths ?? []

  // Decide the source image: current asset's display image (revision_url ??
  // drive original) is the default; if exactly one reference was uploaded, USE
  // that as the source so the model edits it directly. (See trade-off note above.)
  let sourceBuffer: Buffer
  let sourceName = 'creative.jpg'
  let sourceType = 'image/jpeg'

  if (refs.length === 1) {
    const { data: blob, error: dlError } = await supabase.storage.from('project-images').download(refs[0])
    if (dlError || !blob) throw new Error(`Failed to download reference image: ${dlError?.message ?? 'unknown'}`)
    sourceBuffer = Buffer.from(await blob.arrayBuffer())
    sourceName = refs[0].split('/').pop() ?? 'reference.png'
    sourceType = blob.type || 'image/png'
  } else if (asset.revision_url) {
    const res = await fetch(asset.revision_url, { redirect: 'follow' })
    if (!res.ok) throw new Error(`Failed to fetch current revision (HTTP ${res.status}).`)
    sourceBuffer = Buffer.from(await res.arrayBuffer())
    sourceType = res.headers.get('content-type') || 'image/png'
    sourceName = 'revision.png'
  } else {
    const driveUrl = `https://drive.google.com/uc?export=download&id=${asset.drive_file_id}`
    const res = await fetch(driveUrl, { redirect: 'follow' })
    if (!res.ok) throw new Error(`Failed to download image from Drive (HTTP ${res.status}). Make sure the file is publicly shared.`)
    sourceBuffer = Buffer.from(await res.arrayBuffer())
  }

  let finalPrompt = trimmedPrompt
  if (refs.length > 1) {
    finalPrompt = `${trimmedPrompt}\n\n(Reference images uploaded by the team for context: ${refs.length} images. v1 limitation: only the source image is passed to the edit call — describe how to use the references in the prompt above.)`
  }

  const { default: OpenAI, toFile } = await import('openai')
  const openai = new OpenAI({ apiKey: openaiKey })
  const imageFile = await toFile(sourceBuffer, sourceName, { type: sourceType })

  const response = await (openai.images as unknown as {
    edit: (params: unknown) => Promise<{ data: Array<{ b64_json?: string }> }>
  }).edit({
    model: 'gpt-image-2',
    image: imageFile,
    prompt: finalPrompt,
    n: 1,
    size: 'auto',
    quality: input.quality,
  })

  const b64 = response.data[0]?.b64_json
  if (!b64) throw new Error('OpenAI returned no image data. Try again.')

  const revisionBuffer = Buffer.from(b64, 'base64')
  const revisionPath = `revisions/${input.assetId}-${Date.now()}.png`
  const { error: uploadError } = await supabase.storage
    .from('project-images')
    .upload(revisionPath, revisionBuffer, { contentType: 'image/png', upsert: true })
  if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`)

  const { data: { publicUrl } } = supabase.storage.from('project-images').getPublicUrl(revisionPath)

  await supabase
    .from('creative_assets')
    .update({
      revision_url: publicUrl,
      revision_prompt: finalPrompt,
      revision_created_at: new Date().toISOString(),
    })
    .eq('id', input.assetId)

  const { recordAssetRevision } = await import('@/lib/revisions')
  await recordAssetRevision(supabase, {
    assetId: input.assetId,
    imageUrl: publicUrl,
    prompt: finalPrompt,
    createdBy: user.email ?? null,
  })

  revalidatePath(`/brands/${input.brandId}/projects/${input.projectId}`)
  revalidatePath(`/brands/${input.brandId}/projects/${input.projectId}/internal-review`)
  return { revisionUrl: publicUrl, prompt: finalPrompt }
}

export async function toggleAssetVisibility(assetId: string, isHidden: boolean, projectId: string, brandId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  await supabase
    .from('creative_assets')
    .update({ is_hidden: isHidden })
    .eq('id', assetId)

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
}

export async function approveProject(token: string, track: 'lp' | 'creatives') {
  // Anonymous client on the token-gated review page: the share_token IS the
  // authorization, so this write goes through the service-role client. The
  // anon client would be silently blocked by RLS (0 rows, no error) and the
  // approval would vanish on the next refresh.
  const supabase = createServiceClient()

  const field = track === 'lp' ? 'lp_approved' : 'creatives_approved'

  const { error } = await supabase
    .from('projects')
    .update({ [field]: true })
    .eq('share_token', token)

  if (error) throw new Error(error.message)

  // One lookup feeds both the notification (always) and the event (if enabled).
  // A failed lookup only costs those side-effects — the approval stands.
  try {
    const { data: project } = await supabase
      .from('projects')
      .select(FEEDBACK_PROJECT_COLS)
      .eq('share_token', token)
      .single()
    if (project) {
      const eventTrack: 'lp' | 'creative' = track === 'lp' ? 'lp' : 'creative'
      // Approval is good news, not a to-do: notify the editor but do NOT move
      // the track into Revisions.
      await emitClientFeedback(supabase, {
        project: project as FeedbackProject,
        track: eventTrack,
        kind: 'approval',
        authorName: 'The client',
        title: track === 'lp' ? 'Client approved the landing page' : 'Client approved the creatives',
        body: 'Approved on the review link — ready to ship.',
        advance: false,
      })
      if (eventsEnabled()) {
        await logEvents([{
          event_type: 'client_responded',
          card_id: (project as FeedbackProject).id,
          brand_id: (project as FeedbackProject).brand_id,
          track: eventTrack,
          actor_label: 'client',
          payload: { response_type: 'approved', via: 'review_link' },
        }])
      }
    }
  } catch (err) {
    console.error('[approveProject] notify/event failed:', err)
  }

  revalidatePath(`/review/${token}`)
}

export async function deleteProject(projectId: string, brandId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  const { error: imgErr } = await supabase.from('project_images').delete().eq('project_id', projectId)
  if (imgErr) throw new Error(`Failed to delete project images: ${imgErr.message}`)
  const { error: projErr } = await supabase.from('projects').delete().eq('id', projectId)
  if (projErr) throw new Error(`Failed to delete project: ${projErr.message}`)

  revalidatePath(`/brands/${brandId}`)
  redirect(`/brands/${brandId}`)
}

export async function deleteBrand(brandId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  const { data: projects } = await supabase
    .from('projects')
    .select('id')
    .eq('brand_id', brandId)

  if (projects && projects.length > 0) {
    const ids = projects.map(p => p.id)
    const { error: imgErr } = await supabase.from('project_images').delete().in('project_id', ids)
    if (imgErr) throw new Error(`Failed to delete project images: ${imgErr.message}`)
    const { error: projErr } = await supabase.from('projects').delete().eq('brand_id', brandId)
    if (projErr) throw new Error(`Failed to delete projects: ${projErr.message}`)
  }

  const { error: brandErr } = await supabase.from('brands').delete().eq('id', brandId)
  if (brandErr) throw new Error(`Failed to delete brand: ${brandErr.message}`)

  revalidatePath('/')
  redirect('/')
}

export async function addProfitEngineer(name: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  const { error } = await supabase.from('profit_engineers').insert({ name: name.trim() })
  if (error) throw new Error(`Failed to add profit engineer: ${error.message}`)
  // The dropdown that consumes this list only appears on brand pages.
  revalidatePath('/brands', 'layout')
}

export async function addInternalNote(
  projectId: string,
  brandId: string,
  content: string,
  displayName: string,
  attachmentUrls?: string[] | null,
  mentionedProfileIds?: string[] | null,
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  const name = displayName.trim() || user.email?.split('@')[0] || 'Team'
  const cleanedAttachments = (attachmentUrls ?? []).filter(u => typeof u === 'string' && u.length > 0)

  const { data: inserted, error } = await supabase.from('project_comments').insert({
    project_id: projectId,
    author_name: name,
    content: content.trim(),
    track: 'note',
    asset_id: null,
    pin_x: null,
    pin_y: null,
    section_tag: null,
    attachment_urls: cleanedAttachments.length > 0 ? cleanedAttachments : null,
    audience: 'internal',
  }).select('id').single()
  if (error) throw new Error(`Failed to add note: ${error.message}`)

  // Notify @mentioned teammates (never the author themselves). Best-effort —
  // createNotifications swallows failures so a missing table never blocks the
  // note from posting.
  const mentions = (mentionedProfileIds ?? []).filter(id => id && id !== user.id)
  if (mentions.length > 0) {
    const snippet = content.trim().slice(0, 140)
    await createNotifications(mentions.map(recipient_id => ({
      recipient_id,
      actor_id: user.id,
      actor_label: name,
      type: 'mentioned' as const,
      project_id: projectId,
      brand_id: brandId,
      comment_id: (inserted as { id?: string } | null)?.id ?? null,
      title: `${name} mentioned you`,
      body: snippet || 'in a note',
      link: `/brands/${brandId}/projects/${projectId}`,
    })))
  }

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
}

export async function lockProjectOffer(projectId: string, brandId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  const { error } = await supabase.from('projects').update({
    offer_locked: true,
    offer_locked_at: new Date().toISOString(),
    offer_locked_by: user.email,
  }).eq('id', projectId)
  if (error) throw new Error(`Failed to lock offer: ${error.message}`)

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
}

export async function unlockProjectOffer(projectId: string, brandId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  const { error } = await supabase.from('projects').update({
    offer_locked: false,
    offer_locked_at: null,
    offer_locked_by: null,
  }).eq('id', projectId)
  if (error) throw new Error(`Failed to unlock offer: ${error.message}`)

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
}

export async function confirmOfferByClient(token: string) {
  // Anonymous client review action — service role (share_token authorizes).
  // The anon client is blocked by RLS, so the confirmation would silently not
  // persist and revert on refresh.
  const supabase = createServiceClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('share_token', token)
    .single()
  if (!project) throw new Error('Invalid review link.')

  const { error } = await supabase.from('projects').update({
    offer_locked: true,
    offer_locked_at: new Date().toISOString(),
    offer_locked_by: 'client',
  }).eq('id', project.id)
  if (error) throw new Error(`Failed to confirm offer: ${error.message}`)

  revalidatePath(`/review/${token}`)
}

export async function generateClientToken(brandId: string): Promise<string> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated.')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  const { randomBytes } = await import('crypto')
  const token = randomBytes(20).toString('hex')

  const { error } = await supabase.from('brands').update({ client_token: token }).eq('id', brandId)
  if (error) throw new Error(`Failed to save client token: ${error.message}`)
  revalidatePath(`/brands/${brandId}`)
  return token
}

export async function renameJourney(journeyId: string, brandId: string, newName: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  const { error } = await supabase
    .from('journeys')
    .update({ name: newName.trim() })
    .eq('id', journeyId)
  if (error) throw new Error(`Failed to rename journey: ${error.message}`)

  revalidatePath(`/brands/${brandId}`)
}

export async function deleteJourney(journeyId: string, brandId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  const { count } = await supabase
    .from('projects')
    .select('id', { count: 'exact', head: true })
    .eq('journey_id', journeyId)

  if ((count ?? 0) > 0) throw new Error('Cannot delete a journey that still has projects assigned to it.')

  const { error } = await supabase.from('journeys').delete().eq('id', journeyId)
  if (error) throw new Error(`Failed to delete journey: ${error.message}`)

  revalidatePath(`/brands/${brandId}`)
}

// Columns the project form is allowed to write. This is a RUNTIME whitelist, not
// just a TypeScript type: this is a server action, so the argument arrives from
// the browser and the compile-time type guarantees nothing about what actually
// shows up. Without it, a partial payload would let any column through —
// is_complete, share_token, the approval flags.
const EDITABLE_PROJECT_FIELDS = [
  'name', 'due_date',
  'stage_brief_due_date', 'stage_in_progress_due_date',
  'stage_internal_review_due_date', 'stage_client_review_due_date',
  'offer_description', 'offer', 'cta', 'headline', 'body_copy', 'supporting_message',
  'journey_id', 'marketing_moment', 'page_type',
  'product_featured', 'product_description', 'retail_price',
  'offer_dynamics_type', 'competitor_reference', 'client_ad_inspiration',
  'ad_copy_primary_text', 'ad_copy_description', 'ad_copy_url',
  'ad_headlines', 'ad_subcopies', 'ad_eyebrows',
  'product_images_link', 'lp_url', 'creatives_notes', 'shopify_coupon_code',
  'motion_link',
  // FKs to profiles.id. Replaces the old assigned_designer name string, which
  // this action no longer writes.
  'lp_editor_id', 'creative_editor_id',
] as const

export type EditableProjectValues = {
  name: string
  due_date: string | null
  stage_brief_due_date: string | null
  stage_in_progress_due_date: string | null
  stage_internal_review_due_date: string | null
  stage_client_review_due_date: string | null
  offer_description: string | null
  offer: string | null
  cta: string | null
  headline: string | null
  body_copy: string | null
  supporting_message: string | null
  journey_id: string | null
  marketing_moment: 1 | 2 | null
  page_type: string | null
  product_featured: string | null
  product_description: string | null
  retail_price: string | null
  offer_dynamics_type: string | null
  competitor_reference: string | null
  client_ad_inspiration: string | null
  ad_copy_primary_text: string | null
  ad_copy_description: string | null
  ad_copy_url: string | null
  ad_headlines: string[] | null
  ad_subcopies: string[] | null
  ad_eyebrows: string[] | null
  product_images_link: string | null
  lp_url: string | null
  creatives_notes: string | null
  shopify_coupon_code: string | null
  motion_link: string | null
  lp_editor_id: string | null
  creative_editor_id: string | null
}

// PARTIAL by design. It previously took all ~34 fields and wrote all ~34 on every
// save, which is only safe while every field is on screen at once. Under a tabbed
// layout the fields on the other tab are not rendered, so the form reads them as
// empty and the save writes empty over real data — an LP editor saving a URL
// would null product_featured, retail_price and product_images_link, and the
// creative bundle API would then serve an empty product to the next run.
//
// Only keys actually present are written. Anything absent is left alone, which
// also ends the copy-deck race: the form no longer claims ownership of fields it
// is not editing, so it cannot write back a stale copy bank it loaded on mount.
export async function updateProjectDetails(
  projectId: string,
  brandId: string,
  values: Partial<EditableProjectValues>
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  const patch: Record<string, unknown> = {}
  for (const key of EDITABLE_PROJECT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(values, key) && values[key] !== undefined) {
      patch[key] = values[key]
    }
  }
  // Nothing to do beats writing {} and bumping the row for no reason.
  if (Object.keys(patch).length === 0) return

  const { error } = await supabase
    .from('projects')
    .update(patch)
    .eq('id', projectId)
  if (error) throw new Error(`Failed to update project: ${error.message}`)

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
  revalidatePath('/')
}

// Assign (or clear, with profileId = null) a project's editor for one track.
// Track-parameterized in the same shape as updateProjectStage, since LP and
// Creative are parallel tracks everywhere else in the app.
//
// Replaces assignProjectDesigner, which wrote the bare name string
// `assigned_designer` and — unlike every sibling action — checked only that
// someone was logged in, not that they were an editor. That gate is added here.
export async function assignProjectEditor(
  projectId: string,
  brandId: string,
  track: EditorTrack,
  profileId: string | null,
): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  const { column, capability } = EDITOR_TRACK_META[track]

  // Guard the FK before writing: a profile id that doesn't exist, or one whose
  // capability flag is off, would otherwise be accepted by the column and only
  // surface later as an editor who can't be picked again.
  if (profileId) {
    const { data: profile } = await supabase
      .from('profiles')
      .select(`id, ${capability}`)
      .eq('id', profileId)
      .single()
    if (!profile) throw new Error('Unknown editor.')
    if (!(profile as unknown as Record<string, boolean>)[capability]) {
      throw new Error(`That person isn't a ${EDITOR_TRACK_META[track].label}.`)
    }
  }

  const prev = eventsEnabled()
    ? (await supabase.from('projects').select(column).eq('id', projectId).single()).data
    : null

  const { error } = await supabase
    .from('projects')
    .update({ [column]: profileId })
    .eq('id', projectId)
  if (error) throw new Error(`Failed to assign editor: ${error.message}`)

  const prevAssignee = prev ? (prev as unknown as Record<string, string | null>)[column] : null
  if (prev && prevAssignee !== profileId) {
    await logEvents([{
      event_type: 'assigned',
      card_id: projectId,
      brand_id: brandId,
      track: track === 'creative' ? 'creative' : 'lp',
      ...actorFromUser(user),
      payload: { assignee_id: profileId, previous_assignee_id: prevAssignee },
    }])
  }

  // Notify the newly-assigned editor (never self-assign, and never on a no-op
  // re-assign to the same person). Best-effort — createNotifications swallows
  // its own failures so a missing table never blocks the assignment.
  if (profileId && profileId !== user.id && prevAssignee !== profileId) {
    const { data: proj } = await supabase.from('projects').select('name').eq('id', projectId).single()
    const label = EDITOR_TRACK_META[track].label
    await createNotifications([{
      recipient_id: profileId,
      actor_id: user.id,
      actor_label: user.email ?? user.id,
      type: 'assigned',
      project_id: projectId,
      brand_id: brandId,
      title: `You're now the ${label}`,
      body: (proj as { name?: string } | null)?.name ?? 'A project',
      link: `/brands/${brandId}/projects/${projectId}`,
    }])
  }

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
  revalidatePath('/pipeline')
  revalidatePath('/')
}

export async function saveProjectCopy(
  projectId: string,
  brandId: string,
  copy: { ad_headlines: string[]; ad_eyebrows: string[]; ad_subcopies: string[] }
): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { error } = await supabase
    .from('projects')
    .update(copy)
    .eq('id', projectId)
  if (error) throw new Error(`Failed to save copy: ${error.message}`)

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
}

export async function generateProjectCopy(
  projectId: string,
): Promise<{ ok: true; headlines: string[]; eyebrows: string[]; subheads: string[] } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  try {
    const { data: project } = await supabase
      .from('projects')
      .select('offer, offer_description, brand_id')
      .eq('id', projectId)
      .single()

    if (!project) return { ok: false, error: 'Project not found.' }

    const [{ data: brand }, { data: dna }] = await Promise.all([
      supabase.from('brands').select('name').eq('id', project.brand_id).single(),
      supabase.from('brand_dna').select('prompt_modifier').eq('brand_id', project.brand_id).eq('is_active', true).maybeSingle(),
    ])

    // Hypercare brands never generate. Checked here (not just in the UI) so the
    // model is never called and no copy can reach the client to be rendered,
    // regardless of how the action is invoked.
    const { hypercareFor, hypercareCopyMessage } = await import('@/lib/hypercare')
    const rule = hypercareFor(brand?.name)
    if (rule) return { ok: false, error: hypercareCopyMessage(rule) }

    const offerText = [project.offer, project.offer_description].filter(Boolean).join('\n')
    if (!offerText.trim()) return { ok: false, error: 'Please fill in the offer fields before generating copy.' }

    const { generateAdCopy } = await import('@/lib/ai/gemini')
    const deck = await generateAdCopy(
      offerText,
      brand?.name ?? 'Brand',
      dna?.prompt_modifier ?? '',
    )

    return { ok: true, headlines: deck.headlines, eyebrows: deck.eyebrows, subheads: deck.subheads }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error.' }
  }
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

// Brand DNA — Gemini-driven research + synthesis pass. Writes a new active row
// on `brand_dna` and flips any prior active row to is_active=false, so there's
// exactly one active version per brand. Expected runtime 30-90s; the brand
// page carries `maxDuration = 120` to accommodate.
//
// Returns { ok, error } instead of throwing: thrown errors from server actions
// are redacted to a generic "Server Components render" message in production,
// so the panel could never surface the real cause. Same pattern used by
// createProject above.
export async function buildBrandDna(
  brandId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) return { ok: false, error: 'Not authorized.' }

  try {
    const { data: brand } = await supabase
      .from('brands')
      .select('name, website')
      .eq('id', brandId)
      .single()
    if (!brand) return { ok: false, error: 'Brand not found.' }
    if (!brand.website) return { ok: false, error: 'Brand website is required to research DNA.' }

    const { researchBrandDna, synthesizeBrandDna } = await import('@/lib/ai/gemini')
    const { extractSitePalette } = await import('@/lib/ai/palette')
    const { TEXT_FIELDS } = await import('@/lib/ai/brand-dna-schema')

    // Palette comes straight from the site's CSS (exact hex codes) and runs in
    // parallel with the Gemini research pass. Extraction failure degrades to
    // the old behavior instead of failing the run.
    const [{ dossier, urls }, palette] = await Promise.all([
      researchBrandDna(brand.name, brand.website),
      extractSitePalette(brand.website).catch(() => null),
    ])
    const dna = await synthesizeBrandDna(dossier, urls, palette)

    const normalized: Record<string, unknown> = { ...dna }
    for (const field of TEXT_FIELDS) {
      if (normalized[field] === '') normalized[field] = null
    }

    const { data: prevActive } = await supabase
      .from('brand_dna')
      .select('id, version, logo_url')
      .eq('brand_id', brandId)
      .eq('is_active', true)
      .maybeSingle()

    if (prevActive) {
      const { error: flipErr } = await supabase.from('brand_dna').update({ is_active: false }).eq('id', prevActive.id)
      if (flipErr) return { ok: false, error: `Failed to deactivate prior Brand DNA: ${flipErr.message}` }
    }

    const insertRow = {
      ...normalized,
      brand_id: brandId,
      version: (prevActive?.version ?? 0) + 1,
      is_active: true,
      logo_url: prevActive?.logo_url ?? null,
    }

    const { error } = await supabase.from('brand_dna').insert(insertRow)
    if (error) return { ok: false, error: `Failed to save Brand DNA: ${error.message}` }

    revalidatePath(`/brands/${brandId}`)
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[buildBrandDna]', brandId, msg, e)
    return { ok: false, error: msg }
  }
}

// Brand DNA, second route in: build it from the brand's own guideline document
// (PDF/DOCX/PPTX) instead of researching the public web. A first-party brand
// book states what the research pass can only infer, so this path skips the
// search + site-palette work entirely and reads the document.
//
// The file arrives as a Storage path, not as bytes: server actions cap request
// bodies at 1MB by default and real brand books run 5-50MB, so the browser
// uploads to Storage first (same pattern as ImageUploader) and we download it
// here. Keeping the file also gives the sources list something to point at.
export async function buildBrandDnaFromGuideline(
  brandId: string,
  storagePath: string,
  filename: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) return { ok: false, error: 'Not authorized.' }

  try {
    const { data: brand } = await supabase
      .from('brands')
      .select('name')
      .eq('id', brandId)
      .single()
    if (!brand) return { ok: false, error: 'Brand not found.' }

    // Path is scoped to this brand's guideline folder so a crafted value can't
    // pull an unrelated object out of the bucket.
    if (!storagePath.startsWith(`brand-guidelines/${brandId}-`)) {
      return { ok: false, error: 'Unexpected upload path.' }
    }

    const { data: blob, error: dlErr } = await supabase.storage
      .from('project-images')
      .download(storagePath)
    if (dlErr || !blob) {
      return { ok: false, error: `Could not read the uploaded guideline: ${dlErr?.message ?? 'not found'}` }
    }

    const { parseGuideline } = await import('@/lib/ai/brand-guideline')
    const { readBrandGuideline, synthesizeBrandDna } = await import('@/lib/ai/gemini')
    const { TEXT_FIELDS } = await import('@/lib/ai/brand-dna-schema')

    const doc = await parseGuideline(filename, await blob.arrayBuffer())
    const { dossier } = await readBrandGuideline(brand.name, doc)

    const { data: { publicUrl } } = supabase.storage.from('project-images').getPublicUrl(storagePath)

    // No site palette here: the guideline's own swatches are the ground truth,
    // and a scraped CSS palette would only add competing hex codes.
    const dna = await synthesizeBrandDna(dossier, [publicUrl], null,
      `This dossier came from the brand's own guideline document ("${filename}"), not from public research. Treat every stated value as specification rather than inference. For the sources array, use the document URL supplied below as the url for each field you confirmed, and put the page or slide number in the note (e.g. "p.14, colour palette"). Do not invent a hex code, typeface or figure the dossier does not state — the guideline being silent on something is itself a finding.`)

    const normalized: Record<string, unknown> = { ...dna }
    for (const field of TEXT_FIELDS) {
      if (normalized[field] === '') normalized[field] = null
    }

    const { data: prevActive } = await supabase
      .from('brand_dna')
      .select('id, version, logo_url')
      .eq('brand_id', brandId)
      .eq('is_active', true)
      .maybeSingle()

    if (prevActive) {
      const { error: flipErr } = await supabase.from('brand_dna').update({ is_active: false }).eq('id', prevActive.id)
      if (flipErr) return { ok: false, error: `Failed to deactivate prior Brand DNA: ${flipErr.message}` }
    }

    const { error } = await supabase.from('brand_dna').insert({
      ...normalized,
      brand_id: brandId,
      version: (prevActive?.version ?? 0) + 1,
      is_active: true,
      logo_url: prevActive?.logo_url ?? null,
    })
    if (error) return { ok: false, error: `Failed to save Brand DNA: ${error.message}` }

    revalidatePath(`/brands/${brandId}`)
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[buildBrandDnaFromGuideline]', brandId, msg, e)
    return { ok: false, error: msg }
  }
}

// Manual corrections to the active Brand DNA record — edits apply in place
// (no version bump; ✦ Rebuild still creates new versions). Only fields present
// in the form are touched, so partial edit UIs stay safe.
export async function updateBrandDna(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  const brandId = formData.get('brand_id') as string
  if (!brandId) return { ok: false, error: 'Missing brand id.' }

  const { TEXT_FIELDS } = await import('@/lib/ai/brand-dna-schema')
  // research_markdown is the raw dossier — regenerated, never hand-edited.
  const stringFields = TEXT_FIELDS.filter(f => f !== 'research_markdown')
  const arrayFields = [
    'voice_adjectives', 'background_colors', 'top_pain_points',
    'proof_points', 'common_offers', 'top_objections', 'winning_hooks',
  ] as const

  const updates: Record<string, unknown> = {}
  for (const f of stringFields) {
    if (formData.has(f)) updates[f] = (formData.get(f) as string).trim() || null
  }
  for (const f of arrayFields) {
    if (!formData.has(f)) continue
    // Array columns are NOT NULL in brand_dna — an emptied list saves as [],
    // matching what buildBrandDna inserts (null here violates the constraint).
    updates[f] = (formData.get(f) as string).split('\n').map(s => s.trim()).filter(Boolean)
  }
  if (Object.keys(updates).length === 0) return { ok: true }
  updates.updated_at = new Date().toISOString()

  const { error } = await supabase
    .from('brand_dna')
    .update(updates)
    .eq('brand_id', brandId)
    .eq('is_active', true)

  if (error) return { ok: false, error: `Failed to save Brand DNA edits: ${error.message}` }

  revalidatePath(`/brands/${brandId}`)
  return { ok: true }
}

export async function uploadBrandLogo(
  formData: FormData,
): Promise<{ ok: true; logoUrl: string } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) return { ok: false, error: 'Not authorized.' }

  try {
    const brandId = formData.get('brand_id') as string | null
    const file = formData.get('file') as File | null
    if (!brandId) return { ok: false, error: 'brand_id is required.' }
    if (!file) return { ok: false, error: 'No file provided.' }

    const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
    const path = `brand-logos/${brandId}-${Date.now()}.${ext}`

    const buffer = Buffer.from(await file.arrayBuffer())
    const { error: uploadError } = await supabase.storage
      .from('project-images')
      .upload(path, buffer, { contentType: file.type || 'image/png', upsert: false })
    if (uploadError) return { ok: false, error: `Storage upload failed: ${uploadError.message}` }

    const { data: { publicUrl } } = supabase.storage.from('project-images').getPublicUrl(path)

    const { data: active } = await supabase
      .from('brand_dna')
      .select('id')
      .eq('brand_id', brandId)
      .eq('is_active', true)
      .maybeSingle()

    if (active) {
      const { error } = await supabase.from('brand_dna').update({ logo_url: publicUrl }).eq('id', active.id)
      if (error) return { ok: false, error: `Failed to save logo URL: ${error.message}` }
    } else {
      // No DNA row yet — create a stub active row that just holds the logo, so
      // the panel has somewhere to persist the upload. A later Build pass will
      // supersede this with version=2.
      const { error } = await supabase.from('brand_dna').insert({
        brand_id: brandId,
        version: 1,
        is_active: true,
        logo_url: publicUrl,
      })
      if (error) return { ok: false, error: `Failed to save logo URL: ${error.message}` }
    }

    revalidatePath(`/brands/${brandId}`)
    return { ok: true, logoUrl: publicUrl }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[uploadBrandLogo]', msg, e)
    return { ok: false, error: msg }
  }
}


// ── The Creatives tab's repeating lists ─────────────────────────────────────
//
// Kept OUT of updateProjectDetails on purpose. That action copies values
// verbatim into its patch and has nowhere to put validation, and these two
// columns need real shape work on the way in: the payload arrives from the
// browser, so a stored "javascript:..." would otherwise be handed straight to an
// href. Keeping them out of EDITABLE_PROJECT_FIELDS also means the live page's
// edit form structurally cannot touch them — one writer per column.
const MAX_LIST_ROWS = 40

export async function updateProjectLists(
  projectId: string,
  brandId: string,
  values: {
    products?: { id?: string; name: string; url?: string | null; assets_url?: string | null; group?: string | null; image_url?: string | null }[]
    competitors?: { id?: string; name: string; site_url?: string | null; motion_url?: string | null }[]
    top_performers?: { id?: string; name: string; motion_url?: string | null; link?: string | null }[]
  },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const link = (v: unknown) => (typeof v === 'string' && /^https?:\/\//i.test(v.trim()) ? v.trim() : null)
  const newId = () => globalThis.crypto?.randomUUID?.() ?? `p-${Math.random().toString(36).slice(2)}`

  const patch: Record<string, unknown> = {}

  if (Array.isArray(values.products)) {
    const rows = values.products.slice(0, MAX_LIST_ROWS)
      .map(r => ({ id: text(r.id) || newId(), name: text(r.name), url: link(r.url), assets_url: link(r.assets_url), group: text(r.group) || null, image_url: link(r.image_url) }))
      .filter(r => r.name.length > 0)  // an unnamed row is worse than no row
    patch.products = rows
    // The mirror. Several surfaces still read product_featured, including the
    // no-login client review page and the token-authed creative bundle API, so
    // it has to stay true or those go blank.
    const { productNamesLine } = await import('@/lib/products')
    patch.product_featured = productNamesLine(rows)
  }

  if (Array.isArray(values.competitors)) {
    patch.competitors = values.competitors.slice(0, MAX_LIST_ROWS)
      .map(r => ({ id: text(r.id) || newId(), name: text(r.name), site_url: link(r.site_url), motion_url: link(r.motion_url) }))
      .filter(r => r.name.length > 0)
    // competitor_reference is NOT mirrored — it is prose, and overwriting it
    // with a name list destroys the reasoning it exists to hold. motion_link is
    // never touched here either: it is our own Motion board, not a competitor's.
  }

  if (Array.isArray(values.top_performers)) {
    // Ours, not a competitor's — a separate column so our own client can never
    // end up rendered under a heading that says "Competitors".
    patch.top_performers = values.top_performers.slice(0, MAX_LIST_ROWS)
      .map(r => ({ id: text(r.id) || newId(), name: text(r.name), motion_url: link(r.motion_url), link: link(r.link) }))
      .filter(r => r.name.length > 0)
  }

  if (Object.keys(patch).length === 0) return

  const { error } = await supabase.from('projects').update(patch).eq('id', projectId)
  if (error) throw new Error(`Failed to save: ${error.message}`)

  revalidatePath(`/preview/project/${projectId}`)
  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
}

// Bullet summary of the offer, cached on the row. A reading aid, never ad copy —
// see src/lib/ai/offer-summary.ts. Cached because the model costs money and two
// editors opening the same project should read the same summary; the source text
// is stored alongside so an edited offer marks the bullets stale instead of
// silently describing the previous offer.
export async function summariseProjectOffer(
  projectId: string,
  brandId: string,
): Promise<{ ok: true; bullets: string[] } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  const { data: project } = await supabase
    .from('projects')
    .select('offer, offer_description')
    .eq('id', projectId)
    .single()
  if (!project) return { ok: false, error: 'Project not found.' }

  const source = [project.offer, project.offer_description].filter(Boolean).join('\n').trim()
  if (!source) return { ok: false, error: 'There is no offer to summarise yet.' }

  try {
    const { summariseOffer } = await import('@/lib/ai/offer-summary')
    const bullets = await summariseOffer(source)
    const { error } = await supabase
      .from('projects')
      .update({ offer_summary: bullets, offer_summary_source: source })
      .eq('id', projectId)
    if (error) return { ok: false, error: `Summary generated but could not be saved: ${error.message}` }

    revalidatePath(`/preview/project/${projectId}`)
    revalidatePath(`/brands/${brandId}/projects/${projectId}`)
    return { ok: true, bullets }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not summarise the offer.' }
  }
}


// Propose the product list from the brief. Deliberately DOES NOT SAVE: the
// caller opens the editor pre-filled with this and a person presses Save. There
// are already 179 products on file, some curated by hand, and a model must not
// be able to replace them because someone clicked a button once.
export async function proposeProjectProducts(
  projectId: string,
): Promise<{ ok: true; products: { name: string; group: string | null; url: string | null }[] } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  const { data: project } = await supabase
    .from('projects')
    .select('offer, offer_description, product_featured, product_description')
    .eq('id', projectId)
    .single()
  if (!project) return { ok: false, error: 'Project not found.' }

  // Everything that describes what is being sold. product_featured goes in as
  // well as the prose: it is often the only place the exact SKU names appear.
  const brief = [
    project.product_featured && `PRODUCTS: ${project.product_featured}`,
    project.product_description && `PRODUCT NOTES: ${project.product_description}`,
    project.offer && `OFFER: ${project.offer}`,
    project.offer_description && `OFFER DETAIL: ${project.offer_description}`,
  ].filter(Boolean).join('\n\n').trim()

  if (!brief) return { ok: false, error: 'There is no brief to read yet — fill in the offer or the products first.' }

  try {
    const { extractProductsFromBrief } = await import('@/lib/ai/brief-products')
    const products = await extractProductsFromBrief(brief)
    if (!products.length) return { ok: false, error: 'Could not find any products in the brief.' }
    return { ok: true, products }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not read the brief.' }
  }
}


// Pull a thumbnail for every product that has a link, and cache it on the row.
//
// Fetched on demand and stored, never fetched on render: a project page must not
// depend on someone else's storefront being up, and 179 products would otherwise
// mean 179 outbound requests per page view.
//
// Products WITHOUT a link are left alone — there is nothing to look at. Products
// whose link is a collection or campaign page are also left alone rather than
// given the store logo, which is what og:image returns for those.
export async function fetchProductThumbnails(
  projectId: string,
  brandId: string,
): Promise<{ ok: true; found: number; checked: number; skipped: number } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  const { data: project } = await supabase
    .from('projects')
    .select('products')
    .eq('id', projectId)
    .single()
  if (!project) return { ok: false, error: 'Project not found.' }

  const { readProducts } = await import('@/lib/products')
  const products = readProducts(project as { products?: unknown })
  const withLinks = products.filter(p => p.url)
  if (!withLinks.length) {
    return { ok: false, error: 'No product links to read yet — add a link to a product first.' }
  }

  const { fetchProductThumbnail } = await import('@/lib/product-thumbs')

  // Sequential on purpose. This hits a client's live storefront; a burst of 20
  // parallel requests from one IP is how you get rate-limited by their CDN.
  let found = 0, skipped = 0
  const next = [...products]
  for (let i = 0; i < next.length; i++) {
    const p = next[i]
    if (!p.url) continue
    const r = await fetchProductThumbnail(p.url)
    if (r.image) { next[i] = { ...p, image_url: r.image }; found++ }
    else if (r.reason === 'not-a-product-page') skipped++
  }

  const { error } = await supabase.from('projects').update({ products: next }).eq('id', projectId)
  if (error) return { ok: false, error: `Found ${found} but could not save: ${error.message}` }

  revalidatePath(`/preview/project/${projectId}`)
  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
  return { ok: true, found, checked: withLinks.length, skipped }
}


// A pasted screenshot as a product reference.
//
// Getting the right product into the CRM is the hard part: a link only helps
// when the store has a clean PDP, and plenty of these are collection pages,
// bundles or SKUs that never got their own page. Pasting a screenshot is the
// one route that always works.
//
// Stored in the same bucket as everything else, under products/, and returned as
// a URL the caller writes onto the product row — this action does not touch the
// project, so a failed upload can never half-write a product list.
export async function uploadProductImage(
  formData: FormData,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  const file = formData.get('file') as File | null
  const projectId = (formData.get('project_id') as string | null) ?? ''
  if (!file) return { ok: false, error: 'No image found.' }
  if (!file.type.startsWith('image/')) return { ok: false, error: 'That is not an image.' }
  // A pasted screenshot is a few hundred KB. Anything past 10MB is a mistake.
  if (file.size > 10 * 1024 * 1024) return { ok: false, error: 'That image is over 10MB.' }

  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
    const path = `products/${projectId || 'unfiled'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

    const { error: upErr } = await supabase.storage
      .from('project-images')
      .upload(path, buffer, { contentType: file.type, upsert: false, cacheControl: '31536000' })
    if (upErr) return { ok: false, error: `Upload failed: ${upErr.message}` }

    const { data: { publicUrl } } = supabase.storage.from('project-images').getPublicUrl(path)
    return { ok: true, url: publicUrl }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Upload failed.' }
  }
}


// Save the copy deck's sign-off.
//
// Whole-state write: the caller sends every verdict it is showing, and that
// becomes the new set. Anything absent is treated as unreviewed, which is what
// unticking a box means.
//
// Lines are keyed by TEXT, not index — see the migration. A line that gets
// edited therefore loses its approval, which is the correct outcome rather than
// a bug: changed copy has not been signed off.
export async function saveCopyApprovals(
  projectId: string,
  brandId: string,
  verdicts: { text: string; status: 'approved' | 'rejected' }[],
): Promise<{ ok: true; by: string; at: string } | { ok: false; error: string }> {
  // Sign-off does NOT delete copy. Lines that are not approved are hidden by the
  // deck, not removed from the project — a verdict is a view, and deleting on
  // save meant a routine click could bin lines nobody had reviewed yet.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  // Who signed it off, in the form a person reads. Falls back to the email so
  // there is never an anonymous approval.
  const { getCachedProfiles } = await import('@/lib/profiles')
  const profiles = await getCachedProfiles()
  const me = profiles.find(x => x.email.toLowerCase() === (user.email ?? '').toLowerCase())
  const by = me?.full_name || user.email || 'Unknown'
  const at = new Date().toISOString()

  const clean = verdicts
    .map(v => ({ text: (v.text ?? '').trim(), status: v.status, at, by }))
    .filter(v => v.text.length > 0 && (v.status === 'approved' || v.status === 'rejected'))
    .slice(0, 200)

  const { data: existing } = await supabase
    .from('projects')
    .select('copy_approvals')
    .eq('id', projectId)
    .single()

  const { readCopyApprovals } = await import('@/lib/products')
  const prev = readCopyApprovals((existing ?? {}) as { copy_approvals?: unknown })

  // Preserve who FIRST gave a verdict that has not changed — re-saving the panel
  // should not rewrite every line's attribution to whoever pressed the button.
  const lines = clean.map(v => {
    const before = prev.lines.find(l => l.text.trim() === v.text && l.status === v.status)
    return before ?? v
  })

  const entry = {
    at, by,
    approved: lines.filter(l => l.status === 'approved').length,
    rejected: lines.filter(l => l.status === 'rejected').length,
  }
  // Newest first, capped. The log answers "who signed this off" months later;
  // an unbounded audit trail on a JSONB column is a slow page, not a feature.
  const log = [entry, ...prev.log].slice(0, 25)

  const { error } = await supabase
    .from('projects')
    .update({ copy_approvals: { lines, log, removed: prev.removed } })
    .eq('id', projectId)
  if (error) return { ok: false, error: `Could not save: ${error.message}` }

  revalidatePath(`/preview/project/${projectId}`)
  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
  return { ok: true, by, at }
}

// Recovery only. Nothing prunes any more, but a deck pruned before that changed
// still has its lines archived, and they should not be stranded there.
// Put back everything a prune removed. The archive exists so a mis-click is a
// click to undo rather than an afternoon of rewriting copy.
export async function restorePrunedCopy(
  projectId: string,
  brandId: string,
): Promise<{ ok: true; restored: number } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  const { data: project } = await supabase
    .from('projects')
    .select('copy_approvals, ad_headlines, ad_subcopies, ad_eyebrows')
    .eq('id', projectId)
    .single()
  if (!project) return { ok: false, error: 'Project not found.' }

  const { readCopyApprovals } = await import('@/lib/products')
  const state = readCopyApprovals(project as { copy_approvals?: unknown })
  if (!state.removed.length) return { ok: false, error: 'Nothing to restore.' }

  const patch: Record<string, unknown> = {}
  let restored = 0
  for (const col of ['ad_headlines', 'ad_subcopies', 'ad_eyebrows'] as const) {
    const current: string[] = Array.isArray(project[col]) ? project[col] as string[] : []
    const back = state.removed
      .filter(r => r.column === col)
      .map(r => r.text)
      .filter(t => !current.some(c => (c ?? '').trim() === t.trim()))
    if (back.length) { patch[col] = [...current, ...back]; restored += back.length }
  }
  patch.copy_approvals = { lines: state.lines, log: state.log, removed: [] }

  const { error } = await supabase.from('projects').update(patch).eq('id', projectId)
  if (error) return { ok: false, error: `Could not restore: ${error.message}` }

  revalidatePath(`/preview/project/${projectId}`)
  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
  return { ok: true, restored }
}


// The brand bible: what an editor needs to know about a client before they start.
//
// Asked for on the editors' call, 1 Sep — AI tolerance, standing complaints, the
// things you only learn by working on a brand for six weeks. Stored on the BRAND
// and shown on every one of its projects, so swapping who works on a brand does
// not mean relearning it.
export async function updateBrandBrief(
  brandId: string,
  values: { brand_notes?: string | null; ai_sensitivity?: number | null; brand_guidelines?: string | null },
  revalidateProjectId?: string,
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  const patch: Record<string, unknown> = {}
  if ('brand_notes' in values) {
    const t = typeof values.brand_notes === 'string' ? values.brand_notes.trim() : ''
    patch.brand_notes = t || null
  }
  if ('brand_guidelines' in values) {
    const t = typeof values.brand_guidelines === 'string' ? values.brand_guidelines.trim() : ''
    patch.brand_guidelines = t || null
  }
  if ('ai_sensitivity' in values) {
    const n = values.ai_sensitivity
    // Out of range becomes null rather than clamping: a value we cannot explain
    // is worse than no value, and the constraint would reject it anyway.
    patch.ai_sensitivity = typeof n === 'number' && n >= 0 && n <= 3 ? Math.round(n) : null
  }
  if (Object.keys(patch).length === 0) return

  const { error } = await supabase.from('brands').update(patch).eq('id', brandId)
  if (error) throw new Error(`Failed to save: ${error.message}`)

  revalidatePath(`/brands/${brandId}`)
  if (revalidateProjectId) {
    revalidatePath(`/preview/project/${revalidateProjectId}`)
    revalidatePath(`/brands/${brandId}/projects/${revalidateProjectId}`)
  }
}
