'use server'

// Evergreen Ads — staff actions. Every mutation is gated by canEdit(), like the
// rest of the app. The anonymous review link has its own, token-gated actions
// in evergreen-review-actions.ts.
//
// Video files never pass through our server: the browser uploads straight to
// Supabase Storage with a short-lived signed URL (same as creative revisions,
// see upload-revision.ts) and this only records the result.

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { canEdit } from '@/lib/permissions'
import { VIDEO_TYPES } from '@/lib/creative-media'
import {
  CLIENT_VIDEO_STATUSES,
  MIGRATION_FILE,
  MISSING_TABLE,
  cleanBriefUrl,
  isEvergreenStage,
  type EvergreenStage,
  type EvergreenVideoStatus,
} from '@/lib/evergreen'

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

const BUCKET = 'project-images'
const NAME_LIMIT = 200
const NOTE_LIMIT = 4000

async function staff() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !(await canEdit(user.email))) return null
  return { supabase, user }
}

function dbError(error: { code?: string; message: string } | null, fallback: string): string {
  if (error && MISSING_TABLE.has(error.code ?? '')) return `Evergreen tables not found. Run ${MIGRATION_FILE} in the Supabase SQL editor first.`
  return error ? `${fallback}: ${error.message}` : fallback
}

async function revalidateAd(adId: string) {
  revalidatePath('/evergreen-ads')
  revalidatePath(`/evergreen-ads/${adId}`)
  // The review link reads the same rows.
  const service = createServiceClient()
  const { data } = await service.from('evergreen_ads').select('share_token').eq('id', adId).maybeSingle()
  if (data?.share_token) revalidatePath(`/review/evergreen/${data.share_token}`)
}

// ── Ads ─────────────────────────────────────────────────────────────────────

export async function createEvergreenAd(input: { brandId: string; name: string; briefUrl?: string | null }): Promise<Result<{ id: string }>> {
  const s = await staff()
  if (!s) return { ok: false, error: 'Not authorized.' }
  const name = (input.name ?? '').trim().slice(0, NAME_LIMIT)
  if (!input.brandId) return { ok: false, error: 'Pick a brand.' }
  if (!name) return { ok: false, error: 'Give the ad a name.' }
  const brief = cleanBriefUrl(input.briefUrl)
  if (!brief.ok) return brief

  const { data, error } = await s.supabase.from('evergreen_ads').insert({
    brand_id: input.brandId,
    name,
    brief_url: brief.url,
    stage: 'brief',
    created_by: s.user.email ?? null,
  }).select('id').single()
  if (error || !data) return { ok: false, error: dbError(error, 'Could not create the ad') }

  revalidatePath('/evergreen-ads')
  return { ok: true, id: data.id as string }
}

export async function updateEvergreenAd(
  adId: string,
  patch: { name?: string; briefUrl?: string | null; notes?: string | null },
): Promise<Result> {
  const s = await staff()
  if (!s) return { ok: false, error: 'Not authorized.' }
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.name !== undefined) {
    const name = patch.name.trim().slice(0, NAME_LIMIT)
    if (!name) return { ok: false, error: 'The name cannot be empty.' }
    row.name = name
  }
  if (patch.briefUrl !== undefined) {
    const brief = cleanBriefUrl(patch.briefUrl)
    if (!brief.ok) return brief
    row.brief_url = brief.url
  }
  if (patch.notes !== undefined) row.notes = (patch.notes ?? '').trim().slice(0, NOTE_LIMIT) || null

  const { error } = await s.supabase.from('evergreen_ads').update(row).eq('id', adId)
  if (error) return { ok: false, error: dbError(error, 'Could not save') }
  await revalidateAd(adId)
  return { ok: true }
}

export async function moveEvergreenAd(adId: string, stage: EvergreenStage): Promise<Result> {
  const s = await staff()
  if (!s) return { ok: false, error: 'Not authorized.' }
  if (!isEvergreenStage(stage)) return { ok: false, error: 'Unknown stage.' }

  // Client Review needs something to review: a link with nothing on it would
  // only tell the client "coming soon".
  if (stage === 'client_review') {
    const { count } = await s.supabase.from('evergreen_ad_videos')
      .select('id', { count: 'exact', head: true }).eq('ad_id', adId).eq('client_visible', true)
    if (!count) return { ok: false, error: 'Upload a video (visible to the client) before sending this ad to Client Review.' }
  }

  const { error } = await s.supabase.from('evergreen_ads')
    .update({ stage, updated_at: new Date().toISOString() }).eq('id', adId)
  if (error) return { ok: false, error: dbError(error, 'Could not move the ad') }
  await revalidateAd(adId)
  return { ok: true }
}

export async function setEvergreenAdArchived(adId: string, archived: boolean): Promise<Result> {
  const s = await staff()
  if (!s) return { ok: false, error: 'Not authorized.' }
  const { error } = await s.supabase.from('evergreen_ads')
    .update({ is_archived: archived, updated_at: new Date().toISOString() }).eq('id', adId)
  if (error) return { ok: false, error: dbError(error, 'Could not archive the ad') }
  await revalidateAd(adId)
  return { ok: true }
}

export async function deleteEvergreenAd(adId: string): Promise<Result> {
  const s = await staff()
  if (!s) return { ok: false, error: 'Not authorized.' }
  const { data: videos } = await s.supabase.from('evergreen_ad_videos').select('storage_path, poster_path').eq('ad_id', adId)
  const { error } = await s.supabase.from('evergreen_ads').delete().eq('id', adId)
  if (error) return { ok: false, error: dbError(error, 'Could not delete the ad') }
  await removeFiles((videos ?? []).flatMap(v => [v.storage_path, v.poster_path]))
  revalidatePath('/evergreen-ads')
  return { ok: true }
}

/** Best-effort: a file left behind costs storage, never a broken page. */
async function removeFiles(paths: (string | null | undefined)[]) {
  const clean = paths.filter((p): p is string => !!p && p.startsWith('evergreen/'))
  if (!clean.length) return
  const { error } = await createServiceClient().storage.from(BUCKET).remove(clean)
  if (error) console.error('[evergreen] could not remove files:', error.message)
}

// ── Videos ──────────────────────────────────────────────────────────────────

/**
 * First half of an upload: a signed URL for the video, plus one for its still
 * frame (the browser grabs it from the file — see video-poster.ts).
 */
export async function createEvergreenVideoUploadUrl(
  adId: string,
  contentType: string,
): Promise<Result<{ path: string; token: string; posterPath: string | null; posterToken: string | null }>> {
  const s = await staff()
  if (!s) return { ok: false, error: 'Not authorized.' }
  const ext = VIDEO_TYPES[contentType]
  if (!ext) return { ok: false, error: 'That is not a video we can play (MP4, MOV, WebM).' }

  const { data: ad, error: adErr } = await s.supabase.from('evergreen_ads').select('id').eq('id', adId).maybeSingle()
  if (adErr || !ad) return { ok: false, error: dbError(adErr, 'That ad no longer exists') }

  // Minted with the service role: the signed token is the upload's whole
  // authorization, so storage policies on the path do not matter.
  const storage = createServiceClient().storage.from(BUCKET)
  const path = `evergreen/${adId}/${randomUUID()}.${ext}`
  const { data, error } = await storage.createSignedUploadUrl(path)
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not start the upload.' }

  let posterPath: string | null = null
  let posterToken: string | null = null
  const poster = await storage.createSignedUploadUrl(`${path}.poster.jpg`)
  if (poster.data) { posterPath = poster.data.path; posterToken = poster.data.token }
  else console.error('[createEvergreenVideoUploadUrl] no poster slot', adId, poster.error?.message)

  return { ok: true, path: data.path, token: data.token, posterPath, posterToken }
}

/**
 * Second half: the file is in storage, so record it — as a new video, or as a
 * revised cut of an existing one (replaceVideoId).
 */
export async function attachEvergreenVideo(input: {
  adId: string
  path: string
  posterPath?: string | null
  name: string
  replaceVideoId?: string | null
}): Promise<Result<{ videoId: string }>> {
  const s = await staff()
  if (!s) return { ok: false, error: 'Not authorized.' }
  const { adId, path } = input
  // Both paths arrive from the browser: check they are the ones minted above.
  if (!path.startsWith(`evergreen/${adId}/`) || path.includes('..')) return { ok: false, error: 'That upload does not belong to this ad.' }
  const posterPath = input.posterPath ?? null
  if (posterPath && posterPath !== `${path}.poster.jpg`) return { ok: false, error: 'That still does not belong to this upload.' }

  const storage = s.supabase.storage.from(BUCKET)
  const videoUrl = storage.getPublicUrl(path).data.publicUrl
  const posterUrl = posterPath ? storage.getPublicUrl(posterPath).data.publicUrl : null
  const now = new Date().toISOString()

  let videoId: string
  if (input.replaceVideoId) {
    const { data: prior, error: priorErr } = await s.supabase.from('evergreen_ad_videos')
      .select('id, version, storage_path, poster_path').eq('id', input.replaceVideoId).eq('ad_id', adId).maybeSingle()
    if (priorErr || !prior) return { ok: false, error: dbError(priorErr, 'That video no longer exists') }
    // A new cut goes back to the client for a fresh decision: an approval
    // recorded against the old file says nothing about this one.
    const { error } = await s.supabase.from('evergreen_ad_videos').update({
      video_url: videoUrl, storage_path: path, poster_url: posterUrl, poster_path: posterPath,
      version: (prior.version ?? 1) + 1, status: 'pending', uploaded_by: s.user.email ?? null, updated_at: now,
    }).eq('id', prior.id)
    if (error) return { ok: false, error: dbError(error, 'Could not save the new cut') }
    await removeFiles([prior.storage_path, prior.poster_path])
    videoId = prior.id
  } else {
    const { count } = await s.supabase.from('evergreen_ad_videos').select('id', { count: 'exact', head: true }).eq('ad_id', adId)
    const name = (input.name ?? '').trim().slice(0, NAME_LIMIT) || `Video ${(count ?? 0) + 1}`
    const { data, error } = await s.supabase.from('evergreen_ad_videos').insert({
      ad_id: adId, name, video_url: videoUrl, storage_path: path, poster_url: posterUrl, poster_path: posterPath,
      sort_order: count ?? 0, uploaded_by: s.user.email ?? null,
    }).select('id').single()
    if (error || !data) return { ok: false, error: dbError(error, 'Could not save the video') }
    videoId = data.id as string
  }

  // Something new to review: a whole-ad approval no longer covers everything.
  await s.supabase.from('evergreen_ads')
    .update({ client_approved: false, client_approved_at: null, updated_at: now }).eq('id', adId)
  await revalidateAd(adId)
  return { ok: true, videoId }
}

export async function updateEvergreenVideo(
  videoId: string,
  patch: { name?: string; clientVisible?: boolean; status?: EvergreenVideoStatus },
): Promise<Result> {
  const s = await staff()
  if (!s) return { ok: false, error: 'Not authorized.' }
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.name !== undefined) {
    const name = patch.name.trim().slice(0, NAME_LIMIT)
    if (!name) return { ok: false, error: 'The name cannot be empty.' }
    row.name = name
  }
  if (patch.clientVisible !== undefined) row.client_visible = !!patch.clientVisible
  if (patch.status !== undefined) {
    if (!CLIENT_VIDEO_STATUSES.includes(patch.status)) return { ok: false, error: 'Unknown status.' }
    row.status = patch.status
  }
  const { data, error } = await s.supabase.from('evergreen_ad_videos').update(row).eq('id', videoId).select('ad_id').single()
  if (error || !data) return { ok: false, error: dbError(error, 'Could not save the video') }
  await revalidateAd(data.ad_id as string)
  return { ok: true }
}

export async function deleteEvergreenVideo(videoId: string): Promise<Result> {
  const s = await staff()
  if (!s) return { ok: false, error: 'Not authorized.' }
  const { data, error } = await s.supabase.from('evergreen_ad_videos')
    .delete().eq('id', videoId).select('ad_id, storage_path, poster_path').single()
  if (error || !data) return { ok: false, error: dbError(error, 'Could not delete the video') }
  await removeFiles([data.storage_path, data.poster_path])
  await revalidateAd(data.ad_id as string)
  return { ok: true }
}

// ── Comments ────────────────────────────────────────────────────────────────

/** A team note. Internal: never shown on the client review link. */
export async function addEvergreenTeamNote(adId: string, videoId: string | null, content: string): Promise<Result> {
  const s = await staff()
  if (!s) return { ok: false, error: 'Not authorized.' }
  const text = (content ?? '').trim().slice(0, NOTE_LIMIT)
  if (!text) return { ok: false, error: 'Write something first.' }
  const { error } = await s.supabase.from('evergreen_ad_comments').insert({
    ad_id: adId, video_id: videoId, content: text, audience: 'internal',
    author_id: s.user.id, author_name: s.user.email?.split('@')[0] ?? 'Team',
  })
  if (error) return { ok: false, error: dbError(error, 'Could not save the note') }
  await revalidateAd(adId)
  return { ok: true }
}

/** Checking off a client comment also drops it from the review link. */
export async function setEvergreenCommentResolved(commentId: string, resolved: boolean): Promise<Result> {
  const s = await staff()
  if (!s) return { ok: false, error: 'Not authorized.' }
  const { data, error } = await s.supabase.from('evergreen_ad_comments')
    .update({ resolved_at: resolved ? new Date().toISOString() : null }).eq('id', commentId).select('ad_id').single()
  if (error || !data) return { ok: false, error: dbError(error, 'Could not update the comment') }
  await revalidateAd(data.ad_id as string)
  return { ok: true }
}

export async function deleteEvergreenComment(commentId: string): Promise<Result> {
  const s = await staff()
  if (!s) return { ok: false, error: 'Not authorized.' }
  const { data, error } = await s.supabase.from('evergreen_ad_comments').delete().eq('id', commentId).select('ad_id').single()
  if (error || !data) return { ok: false, error: dbError(error, 'Could not delete the comment') }
  await revalidateAd(data.ad_id as string)
  return { ok: true }
}
