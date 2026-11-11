'use server'

// Evergreen Ads — staff actions. Every mutation is gated by canEdit(), like the
// rest of the app. The anonymous review link has its own, token-gated actions
// in evergreen-review-actions.ts.
//
// Files never pass through our server on upload: the browser sends them
// straight to Supabase Storage on a short-lived signed URL (same as creative
// revisions, see upload-revision.ts) and this only records the result. Drive
// copies do pass through, one file per request.

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { canEdit } from '@/lib/permissions'
import { getCachedProfiles } from '@/lib/profiles'
import { createNotifications } from '@/lib/notifications'
import { loadPeople } from '@/lib/bfcm/production-server'
import { downloadDriveFile, extractDriveFolderId } from '@/lib/drive'
import { driveCreativeName, fetchDriveVideoStill, isDriveFileId, listDriveCreatives } from '@/lib/evergreen-drive'
import {
  MEDIA_LABELS, MIGRATION_FILE, MISSING_COLUMN, MISSING_TABLE, TEAM_MIGRATION_FILE,
  cleanBriefUrl, extensionOf, isEvergreenStage, isIsoDate, isReviewStatus, isUuid, maxBytesOf, mediaTypeOf, mediaTypeOfPath, toCreative,
  type EvergreenMediaType, type EvergreenReviewStatus, type EvergreenStage,
} from '@/lib/evergreen'

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }
type DbError = { code?: string; message: string } | null
type Staff = { supabase: SupabaseClient; user: User; me: { id: string | null; name: string } }

const BUCKET = 'project-images'
const NAME_LIMIT = 200
const NOTE_LIMIT = 4000
const TEAM_MIGRATION_ERROR = `This needs one more database change. Run ${TEAM_MIGRATION_FILE} in the Supabase SQL editor first.`
const NOT_AUTHORIZED = { ok: false as const, error: 'Not authorized.' }

/**
 * The signed-in editor, with their profile for names and notifications.
 * Matched by email, like the rest of the app: profiles.id is not the auth uid.
 */
async function staff(): Promise<Staff | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !(await canEdit(user.email))) return null
  const email = (user.email ?? '').toLowerCase()
  const profile = (await getCachedProfiles()).find(p => p.email.toLowerCase() === email)
  return { supabase, user, me: { id: profile?.id ?? null, name: profile?.full_name || email.split('@')[0] || 'Team' } }
}

function dbError(error: DbError, fallback: string): string {
  if (!error) return fallback
  // A column or table from the 20261110 migration (statics, pins, due dates, people, Drive).
  if (MISSING_COLUMN.has(error.code ?? '') || /evergreen_ad_assignees/.test(error.message)) return TEAM_MIGRATION_ERROR
  if (MISSING_TABLE.has(error.code ?? '')) return `Evergreen tables not found. Run ${MIGRATION_FILE} in the Supabase SQL editor first.`
  return `${fallback}: ${error.message}`
}

async function revalidateAd(adId: string) {
  revalidatePath('/evergreen-ads')
  revalidatePath(`/evergreen-ads/${adId}`)
  // The review link reads the same rows.
  const { data } = await createServiceClient().from('evergreen_ads').select('share_token').eq('id', adId).maybeSingle()
  if (data?.share_token) revalidatePath(`/review/evergreen/${data.share_token}`)
}

/** Something new to review: a whole-ad approval no longer covers everything. */
async function clearApproval(db: SupabaseClient, adId: string) {
  await db.from('evergreen_ads').update({ client_approved: false, client_approved_at: null, updated_at: new Date().toISOString() }).eq('id', adId)
}

/** Best-effort: a file left behind costs storage, never a broken page. */
async function removeFiles(paths: (string | null | undefined)[]) {
  const clean = paths.filter((p): p is string => !!p && p.startsWith('evergreen/'))
  if (!clean.length) return
  const { error } = await createServiceClient().storage.from(BUCKET).remove(clean)
  if (error) console.error('[evergreen] could not remove files:', error.message)
}

const cleanName = (name: unknown) => (typeof name === 'string' ? name.trim().slice(0, NAME_LIMIT) : '')
function cleanDueDate(raw: unknown): { ok: true; date: string | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined || raw === '') return { ok: true, date: null }
  return isIsoDate(raw) ? { ok: true, date: raw } : { ok: false, error: 'That due date is not a valid date.' }
}

// ── Ads ─────────────────────────────────────────────────────────────────────

export async function createEvergreenAd(input: {
  brandId: string
  name: string
  briefUrl?: string | null
  dueDate?: string | null
  assigneeIds?: string[]
}): Promise<Result<{ id: string; warning?: string }>> {
  const s = await staff()
  if (!s) return NOT_AUTHORIZED
  const name = cleanName(input.name)
  if (!isUuid(input.brandId)) return { ok: false, error: 'Pick a brand.' }
  if (!name) return { ok: false, error: 'Give the ad a name.' }
  const brief = cleanBriefUrl(input.briefUrl)
  if (!brief.ok) return brief
  const due = cleanDueDate(input.dueDate)
  if (!due.ok) return due

  const { data, error } = await s.supabase.from('evergreen_ads').insert({
    brand_id: input.brandId,
    name,
    brief_url: brief.url,
    stage: 'brief',
    created_by: s.user.email ?? null,
    // Only sent when set, so creating an ad works before the 20261110 migration.
    ...(due.date ? { due_date: due.date } : {}),
  }).select('id').single()
  if (error || !data) return { ok: false, error: dbError(error, 'Could not create the ad') }
  const id = data.id as string

  let warning: string | undefined
  if (input.assigneeIds?.length) {
    const assigned = await applyAssignees(s, id, input.assigneeIds)
    if (!assigned.ok) warning = `The ad was created, but its people were not saved: ${assigned.error}`
  }
  revalidatePath('/evergreen-ads')
  return { ok: true, id, warning }
}

export async function updateEvergreenAd(
  adId: string,
  patch: { name?: string; briefUrl?: string | null; notes?: string | null; dueDate?: string | null },
): Promise<Result> {
  const s = await staff()
  if (!s) return NOT_AUTHORIZED
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.name !== undefined) {
    const name = cleanName(patch.name)
    if (!name) return { ok: false, error: 'The name cannot be empty.' }
    row.name = name
  }
  if (patch.briefUrl !== undefined) {
    const brief = cleanBriefUrl(patch.briefUrl)
    if (!brief.ok) return brief
    row.brief_url = brief.url
  }
  if (patch.notes !== undefined) row.notes = (patch.notes ?? '').trim().slice(0, NOTE_LIMIT) || null
  if (patch.dueDate !== undefined) {
    const due = cleanDueDate(patch.dueDate)
    if (!due.ok) return due
    row.due_date = due.date
  }

  const { error } = await s.supabase.from('evergreen_ads').update(row).eq('id', adId)
  if (error) return { ok: false, error: dbError(error, 'Could not save') }
  await revalidateAd(adId)
  return { ok: true }
}

export async function moveEvergreenAd(adId: string, stage: EvergreenStage): Promise<Result> {
  const s = await staff()
  if (!s) return NOT_AUTHORIZED
  if (!isEvergreenStage(stage)) return { ok: false, error: 'Unknown stage.' }

  // Client Review needs something to review: a link with nothing on it would
  // only tell the client "coming soon".
  if (stage === 'client_review') {
    const { count } = await s.supabase.from('evergreen_ad_videos')
      .select('id', { count: 'exact', head: true }).eq('ad_id', adId).eq('client_visible', true)
    if (!count) return { ok: false, error: 'Upload a static or a video (visible to the client) before sending this ad to Client Review.' }
  }

  const { error } = await s.supabase.from('evergreen_ads')
    .update({ stage, updated_at: new Date().toISOString() }).eq('id', adId)
  if (error) return { ok: false, error: dbError(error, 'Could not move the ad') }
  await revalidateAd(adId)
  return { ok: true }
}

export async function setEvergreenAdArchived(adId: string, archived: boolean): Promise<Result> {
  const s = await staff()
  if (!s) return NOT_AUTHORIZED
  const { error } = await s.supabase.from('evergreen_ads')
    .update({ is_archived: archived, updated_at: new Date().toISOString() }).eq('id', adId)
  if (error) return { ok: false, error: dbError(error, 'Could not archive the ad') }
  await revalidateAd(adId)
  return { ok: true }
}

export async function deleteEvergreenAd(adId: string): Promise<Result> {
  const s = await staff()
  if (!s) return NOT_AUTHORIZED
  const { data: files } = await s.supabase.from('evergreen_ad_videos').select('storage_path, poster_path').eq('ad_id', adId)
  const { error } = await s.supabase.from('evergreen_ads').delete().eq('id', adId)
  if (error) return { ok: false, error: dbError(error, 'Could not delete the ad') }
  await removeFiles((files ?? []).flatMap(f => [f.storage_path, f.poster_path]))
  revalidatePath('/evergreen-ads')
  return { ok: true }
}

// ── People ──────────────────────────────────────────────────────────────────

/** Sets the full list of people building an ad. Newly added people get a notification. */
export async function setEvergreenAdAssignees(adId: string, profileIds: string[]): Promise<Result> {
  const s = await staff()
  if (!s) return NOT_AUTHORIZED
  const result = await applyAssignees(s, adId, profileIds)
  if (result.ok) await revalidateAd(adId)
  return result
}

/** Same rules as BFCM task assignees (bfcm/production-actions.ts). */
async function applyAssignees(s: Staff, adId: string, profileIds: string[]): Promise<Result> {
  if (!Array.isArray(profileIds) || profileIds.length > 20 || !profileIds.every(isUuid)) return { ok: false, error: 'Invalid people.' }
  const wanted = [...new Set(profileIds)]
  const people = await loadPeople()
  if (wanted.some(id => !people.some(p => p.id === id))) return { ok: false, error: 'Unknown person.' }

  const { data: ad, error: adErr } = await s.supabase.from('evergreen_ads').select('id, name, brand_id, brands(name)').eq('id', adId).maybeSingle()
  if (adErr || !ad) return { ok: false, error: dbError(adErr, 'That ad no longer exists') }
  const { data: current, error } = await s.supabase.from('evergreen_ad_assignees').select('profile_id').eq('ad_id', adId)
  if (error) return { ok: false, error: dbError(error, 'Could not save the people') }

  const had = new Set((current ?? []).map(r => r.profile_id as string))
  const added = wanted.filter(id => !had.has(id))
  const removed = [...had].filter(id => !wanted.includes(id))
  if (added.length) {
    const { error: e } = await s.supabase.from('evergreen_ad_assignees').insert(added.map(profile_id => ({ ad_id: adId, profile_id })))
    if (e) return { ok: false, error: dbError(e, 'Could not save the people') }
  }
  if (removed.length) {
    const { error: e } = await s.supabase.from('evergreen_ad_assignees').delete().eq('ad_id', adId).in('profile_id', removed)
    if (e) return { ok: false, error: dbError(e, 'Could not save the people') }
  }

  const recipients = added.filter(id => id !== s.me.id)
  if (recipients.length) {
    const brandName = (ad.brands as unknown as { name?: string } | null)?.name ?? 'Evergreen'
    await createNotifications(recipients.map(recipient_id => ({
      recipient_id, actor_id: s.me.id, actor_label: s.me.name, type: 'assigned' as const, brand_id: ad.brand_id as string,
      title: `${s.me.name} assigned you to an evergreen ad`, body: `${brandName}: ${ad.name as string}`, link: `/evergreen-ads/${adId}`,
    })))
  }
  return { ok: true }
}

// ── Statics and videos ──────────────────────────────────────────────────────

/**
 * First half of an upload: a signed URL for the file, plus (for a video) one
 * for its still frame, which the browser grabs from the file (video-poster.ts).
 */
export async function createEvergreenUploadUrl(
  adId: string,
  contentType: string,
): Promise<Result<{ path: string; token: string; posterPath: string | null; posterToken: string | null }>> {
  const s = await staff()
  if (!s) return NOT_AUTHORIZED
  const type = mediaTypeOf(contentType)
  const ext = extensionOf(contentType)
  if (!type || !ext) return { ok: false, error: 'Upload an image (JPG, PNG, WebP, GIF) or a video (MP4, MOV, WebM).' }

  const { data: ad, error: adErr } = await s.supabase.from('evergreen_ads').select('id').eq('id', adId).maybeSingle()
  if (adErr || !ad) return { ok: false, error: dbError(adErr, 'That ad no longer exists') }
  // Statics need the media_type column: say so now, before a 50MB upload.
  if (type === 'image') {
    const { error } = await s.supabase.from('evergreen_ad_videos').select('media_type').limit(1)
    if (error) return { ok: false, error: dbError(error, 'Could not start the upload') }
  }

  // Minted with the service role: the signed token is the upload's whole
  // authorization, so storage policies on the path do not matter.
  const storage = createServiceClient().storage.from(BUCKET)
  const path = `evergreen/${adId}/${randomUUID()}.${ext}`
  const { data, error } = await storage.createSignedUploadUrl(path)
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not start the upload.' }

  let posterPath: string | null = null
  let posterToken: string | null = null
  if (type === 'video') {
    const poster = await storage.createSignedUploadUrl(`${path}.poster.jpg`)
    if (poster.data) { posterPath = poster.data.path; posterToken = poster.data.token }
    else console.error('[createEvergreenUploadUrl] no poster slot', adId, poster.error?.message)
  }
  return { ok: true, path: data.path, token: data.token, posterPath, posterToken }
}

/**
 * Second half: the file is in storage, so record it, as a new static or video
 * or as a new version of an existing one (replaceId).
 */
export async function attachEvergreenUpload(input: {
  adId: string
  path: string
  posterPath?: string | null
  name: string
  replaceId?: string | null
}): Promise<Result<{ creativeId: string }>> {
  const s = await staff()
  if (!s) return NOT_AUTHORIZED
  const { adId, path } = input
  // Both paths arrive from the browser: check they are the shape minted above.
  const minted = new RegExp(`^evergreen/${adId}/[0-9a-f-]{36}\\.[a-z0-9]{2,5}$`)
  const mediaType = mediaTypeOfPath(path)
  if (!isUuid(adId) || !minted.test(path) || !mediaType) return { ok: false, error: 'That upload does not belong to this ad.' }
  const posterPath = mediaType === 'video' ? input.posterPath ?? null : null
  if (posterPath && posterPath !== `${path}.poster.jpg`) return { ok: false, error: 'That still does not belong to this upload.' }

  const saved = await saveCreative(s, { adId, mediaType, path, posterPath, name: input.name, replaceId: input.replaceId ?? null })
  return saved.ok ? { ok: true, creativeId: saved.creativeId } : saved
}

/**
 * Records a file that is already in storage. Shared by uploads and Drive copies.
 * A new version replaces the file in place: version up, status back to pending
 * (an approval of the old file says nothing about this one), old file removed.
 * On failure the new file is removed, so nothing is left behind.
 */
async function saveCreative(s: Staff, input: {
  adId: string
  mediaType: EvergreenMediaType
  path: string
  posterPath: string | null
  name: string
  replaceId: string | null
  drive?: { drive_file_id: string; drive_modified_at: string | null }
}): Promise<Result<{ creativeId: string; outcome: 'added' | 'new_version' | 'unchanged' }>> {
  const { adId, mediaType, path, posterPath, replaceId, drive } = input
  const storage = createServiceClient().storage.from(BUCKET)
  const file = {
    video_url: storage.getPublicUrl(path).data.publicUrl,
    storage_path: path,
    poster_url: posterPath ? storage.getPublicUrl(posterPath).data.publicUrl : null,
    poster_path: posterPath,
    uploaded_by: s.user.email ?? null,
    updated_at: new Date().toISOString(),
    ...drive,
  }
  const fail = async (error: string) => { await removeFiles([path, posterPath]); return { ok: false as const, error } }
  const label = MEDIA_LABELS[mediaType].one

  let creativeId: string
  let outcome: 'added' | 'new_version'
  if (replaceId) {
    const { data: prior, error: priorErr } = await s.supabase.from('evergreen_ad_videos').select('*').eq('id', replaceId).eq('ad_id', adId).maybeSingle()
    if (priorErr || !prior) return fail(dbError(priorErr, `That ${label} no longer exists`))
    const old = toCreative(prior)
    if (old.media_type !== mediaType) return fail(`That one is a ${MEDIA_LABELS[old.media_type].one}: upload a ${MEDIA_LABELS[old.media_type].one} as its new version.`)
    const { error } = await s.supabase.from('evergreen_ad_videos')
      .update({ ...file, version: (old.version ?? 1) + 1, status: 'pending' }).eq('id', old.id)
    if (error) return fail(dbError(error, `Could not save the new version`))
    await removeFiles([old.storage_path, old.poster_path])
    creativeId = old.id
    outcome = 'new_version'
  } else {
    const { count } = await s.supabase.from('evergreen_ad_videos').select('id', { count: 'exact', head: true }).eq('ad_id', adId)
    const { data, error } = await s.supabase.from('evergreen_ad_videos').insert({
      ...file,
      // Only written for statics, so a video still saves before the 20261110 migration.
      ...(mediaType === 'image' ? { media_type: 'image' } : {}),
      ad_id: adId,
      name: cleanName(input.name) || `${mediaType === 'image' ? 'Static' : 'Video'} ${(count ?? 0) + 1}`,
      sort_order: count ?? 0,
    }).select('id').single()
    if (error || !data) {
      // Unique (ad_id, drive_file_id): a second sync running at the same time already added it.
      if (drive && /duplicate|unique/i.test(error?.message ?? '')) { await removeFiles([path, posterPath]); return { ok: true, creativeId: '', outcome: 'unchanged' } }
      return fail(dbError(error, `Could not save the ${label}`))
    }
    creativeId = data.id as string
    outcome = 'added'
  }

  await clearApproval(s.supabase, adId)
  await revalidateAd(adId)
  return { ok: true, creativeId, outcome }
}

export async function updateEvergreenCreative(
  creativeId: string,
  patch: { name?: string; clientVisible?: boolean; status?: EvergreenReviewStatus },
): Promise<Result> {
  const s = await staff()
  if (!s) return NOT_AUTHORIZED
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.name !== undefined) {
    const name = cleanName(patch.name)
    if (!name) return { ok: false, error: 'The name cannot be empty.' }
    row.name = name
  }
  if (patch.clientVisible !== undefined) row.client_visible = !!patch.clientVisible
  if (patch.status !== undefined) {
    if (!isReviewStatus(patch.status)) return { ok: false, error: 'Unknown status.' }
    row.status = patch.status
  }
  const { data, error } = await s.supabase.from('evergreen_ad_videos').update(row).eq('id', creativeId).select('ad_id').single()
  if (error || !data) return { ok: false, error: dbError(error, 'Could not save') }
  await revalidateAd(data.ad_id as string)
  return { ok: true }
}

export async function deleteEvergreenCreative(creativeId: string): Promise<Result> {
  const s = await staff()
  if (!s) return NOT_AUTHORIZED
  const { data, error } = await s.supabase.from('evergreen_ad_videos')
    .delete().eq('id', creativeId).select('ad_id, storage_path, poster_path').single()
  if (error || !data) return { ok: false, error: dbError(error, 'Could not delete') }
  await removeFiles([data.storage_path, data.poster_path])
  await revalidateAd(data.ad_id as string)
  return { ok: true }
}

// ── From a Drive folder ─────────────────────────────────────────────────────
//
// Same flow as BFCM calibration (bfcm/calibration-actions.ts): the team pastes
// a folder, syncEvergreenDriveFolder works out what is new or edited, and the
// browser then copies ONE file per request with copyEvergreenDriveFile, so a
// folder of large videos never hits a single request's time limit.

export async function syncEvergreenDriveFolder(
  adId: string,
  folderUrl: string,
): Promise<Result<{ files: { id: string; name: string }[]; unchanged: number; skipped: string[]; skippedFolders: string[] }>> {
  const s = await staff()
  if (!s) return NOT_AUTHORIZED
  const url = typeof folderUrl === 'string' ? folderUrl.trim() : ''
  if (url.length > 500) return { ok: false, error: 'That link is too long.' }
  let folderId: string
  try { folderId = extractDriveFolderId(url) } catch { return { ok: false, error: 'Paste a Drive folder link (drive.google.com/drive/folders/…).' } }

  const { data: ad, error: adErr } = await s.supabase.from('evergreen_ads').select('id').eq('id', adId).maybeSingle()
  if (adErr || !ad) return { ok: false, error: dbError(adErr, 'That ad no longer exists') }

  let listed: Awaited<ReturnType<typeof listDriveCreatives>>
  try { listed = await listDriveCreatives(folderId) } catch (e) {
    console.error('[evergreen drive] list', adId, e)
    return { ok: false, error: 'Couldn’t open that folder. Check the link, and that the folder is shared with the CRM’s Drive account like Moments and BFCM folders are.' }
  }

  const { error: saveErr } = await s.supabase.from('evergreen_ads')
    .update({ drive_folder_url: url, updated_at: new Date().toISOString() }).eq('id', adId)
  if (saveErr) return { ok: false, error: dbError(saveErr, 'Could not save the folder') }

  if (!listed.files.length) {
    await revalidateAd(adId)
    const other = listed.skipped.length ? ` (${listed.skipped.length} other file${listed.skipped.length === 1 ? '' : 's'} skipped)` : ''
    const folders = listed.skippedFolders.length ? ` Folders not opened: ${listed.skippedFolders.join(', ')}.` : ''
    return { ok: false, error: `No statics or videos found in that folder${other}. Put them directly in it, or in subfolders named Statics and Motion.${folders}` }
  }

  const { data: existing, error: exErr } = await s.supabase.from('evergreen_ad_videos')
    .select('drive_file_id, drive_modified_at').eq('ad_id', adId).not('drive_file_id', 'is', null)
  if (exErr) return { ok: false, error: dbError(exErr, 'Could not read what was copied before') }
  const known = new Map((existing ?? []).map(e => [e.drive_file_id as string, (e.drive_modified_at as string | null) ?? '']))

  const files: { id: string; name: string }[] = []
  let unchanged = 0
  for (const f of listed.files) {
    if (known.get(f.id) === (f.modifiedTime ?? '')) unchanged++
    else files.push({ id: f.id, name: f.name })
  }
  await revalidateAd(adId)
  return { ok: true, files, unchanged, skipped: listed.skipped, skippedFolders: listed.skippedFolders }
}

/**
 * Copies one file from the ad's saved folder. Re-listed here, so only files
 * really in that folder can be copied. A file already copied but edited in
 * Drive since becomes a new version of the same static or video.
 */
export async function copyEvergreenDriveFile(adId: string, fileId: string): Promise<Result<{ outcome: 'added' | 'new_version' | 'unchanged' }>> {
  const s = await staff()
  if (!s) return NOT_AUTHORIZED
  if (!isDriveFileId(fileId)) return { ok: false, error: 'Invalid file.' }

  const { data: ad, error: adErr } = await s.supabase.from('evergreen_ads').select('id, drive_folder_url').eq('id', adId).maybeSingle()
  if (adErr || !ad) return { ok: false, error: dbError(adErr, 'That ad no longer exists') }
  if (!ad.drive_folder_url) return { ok: false, error: 'Sync the folder first.' }

  let file
  try { file = (await listDriveCreatives(extractDriveFolderId(ad.drive_folder_url as string))).files.find(f => f.id === fileId) } catch (e) {
    console.error('[evergreen drive] relist', adId, e)
    return { ok: false, error: 'Couldn’t open the Drive folder.' }
  }
  const mediaType = file ? mediaTypeOf(file.mimeType) : null
  if (!file || !mediaType) return { ok: false, error: 'That file is no longer in the folder.' }

  const { data: prior } = await s.supabase.from('evergreen_ad_videos')
    .select('id, drive_modified_at').eq('ad_id', adId).eq('drive_file_id', fileId).maybeSingle()
  if (prior && (prior.drive_modified_at ?? '') === (file.modifiedTime ?? '')) return { ok: true, outcome: 'unchanged' }

  const limit = maxBytesOf(mediaType)
  const got = await downloadDriveFile(fileId, limit)
  if (!got.ok) return { ok: false, error: got.reason === 'too_large' ? `${file.name}: over the ${limit / 1048576}MB limit. Export a lighter version.` : `${file.name}: ${got.message}` }
  // Trust the listing's type over the download's: Drive sometimes serves octet-stream.
  const mime = mediaTypeOf(got.mimeType) === mediaType ? got.mimeType : file.mimeType
  const storage = createServiceClient().storage.from(BUCKET)
  const path = `evergreen/${adId}/${randomUUID()}.${extensionOf(mime) ?? (mediaType === 'image' ? 'jpg' : 'mp4')}`
  const up = await storage.upload(path, got.bytes, { contentType: mime, upsert: false, cacheControl: '31536000' })
  if (up.error) {
    return { ok: false, error: /exceeded|maximum allowed size/i.test(up.error.message) ? `${file.name}: over the storage size limit.` : `${file.name}: storage: ${up.error.message}` }
  }

  // A video's poster comes from Drive's own still; a static is its own preview.
  let posterPath: string | null = null
  const still = mediaType === 'video' ? await fetchDriveVideoStill(fileId) : null
  if (still) {
    const put = await storage.upload(`${path}.poster.jpg`, still, { contentType: 'image/jpeg', upsert: true, cacheControl: '31536000' })
    if (put.error) console.error('[evergreen drive] poster upload', adId, put.error.message)
    else posterPath = `${path}.poster.jpg`
  }

  const saved = await saveCreative(s, {
    adId, mediaType, path, posterPath, name: driveCreativeName(file.name), replaceId: (prior?.id as string | undefined) ?? null,
    drive: { drive_file_id: fileId, drive_modified_at: file.modifiedTime ?? null },
  })
  return saved.ok ? { ok: true, outcome: saved.outcome } : { ok: false, error: `${file.name}: ${saved.error}` }
}

// ── Comments ────────────────────────────────────────────────────────────────

/** A team note. Internal: never shown on the client review link. */
export async function addEvergreenTeamNote(adId: string, creativeId: string | null, content: string): Promise<Result> {
  const s = await staff()
  if (!s) return NOT_AUTHORIZED
  const text = (content ?? '').trim().slice(0, NOTE_LIMIT)
  if (!text) return { ok: false, error: 'Write something first.' }
  const { error } = await s.supabase.from('evergreen_ad_comments').insert({
    ad_id: adId, video_id: creativeId, content: text, audience: 'internal', author_id: s.user.id, author_name: s.me.name,
  })
  if (error) return { ok: false, error: dbError(error, 'Could not save the note') }
  await revalidateAd(adId)
  return { ok: true }
}

/** Checking off a client comment also drops it from the review link. */
export async function setEvergreenCommentResolved(commentId: string, resolved: boolean): Promise<Result> {
  const s = await staff()
  if (!s) return NOT_AUTHORIZED
  const { data, error } = await s.supabase.from('evergreen_ad_comments')
    .update({ resolved_at: resolved ? new Date().toISOString() : null }).eq('id', commentId).select('ad_id').single()
  if (error || !data) return { ok: false, error: dbError(error, 'Could not update the comment') }
  await revalidateAd(data.ad_id as string)
  return { ok: true }
}

export async function deleteEvergreenComment(commentId: string): Promise<Result> {
  const s = await staff()
  if (!s) return NOT_AUTHORIZED
  const { data, error } = await s.supabase.from('evergreen_ad_comments').delete().eq('id', commentId).select('ad_id').single()
  if (error || !data) return { ok: false, error: dbError(error, 'Could not delete the comment') }
  await revalidateAd(data.ad_id as string)
  return { ok: true }
}
