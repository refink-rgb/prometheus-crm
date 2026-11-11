'use server'

import { randomBytes, randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service'
import { createNotifications } from '@/lib/notifications'
import { downloadDriveFile, extractDriveFolderId, listDriveFolderTree } from '@/lib/drive'
import { ensureCalibrationSubtasks, requireStaffProfile } from './production-server'
import { CALIBRATION_TRACKS } from './production'
import { CALIBRATION_BUCKET, MAX_SAMPLE_IMAGE_BYTES, MAX_SAMPLE_VIDEO_BYTES, copyDriveSample, isArchivedPath, isTrackFolder, planDriveSync, sampleExtension, sampleKind, sampleTrack, type CalibrationTrack } from './calibration-drive'

type Result = { ok: true } | { ok: false; error: string }
const validSlug = (slug: unknown): slug is string => typeof slug === 'string' && /^[a-z0-9][a-z0-9-]{0,99}$/.test(slug)
const validId = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id)
const validToken = (token: unknown): token is string => typeof token === 'string' && /^[a-f0-9]{64}$/.test(token)
const folder = (slug: string) => `bfcm-calibration/${slug}/`

function refresh(slug: string, token?: string) {
  revalidatePath(`/bfcm-creatives/${slug}`)
  revalidatePath('/bfcm-creatives')
  if (token) revalidatePath(`/review/bfcm/${token}`)
}
async function staff(slug: string, body: (me: { id: string | null; name: string }) => Promise<Result>): Promise<Result> {
  try {
    const me = await requireStaffProfile()
    if (!validSlug(slug)) return { ok: false, error: 'Invalid plan.' }
    return await body(me)
  } catch (error) {
    console.error('[bfcm calibration]', error)
    return { ok: false, error: error instanceof Error && error.message === 'Unauthorized access.' ? 'You need CRM access to do that.' : 'Something went wrong. Reload and try again.' }
  }
}
const isTrack = (track: unknown): track is CalibrationTrack => track === 'statics' || track === 'motion'
async function calibrationOf(slug: string) {
  const { data } = await createServiceClient().from('bfcm_calibrations').select('plan_slug,share_token,drive_folder_url').eq('plan_slug', slug).maybeSingle()
  return data as { plan_slug: string; share_token: string; drive_folder_url: string | null } | null
}
async function trackStatus(slug: string, track: CalibrationTrack) {
  const { data } = await createServiceClient().from('bfcm_calibration_tracks').select('status').eq('plan_slug', slug).eq('track', track).maybeSingle()
  return (data?.status as string | undefined) ?? null
}
/** The track's subtask, whose status follows its round. The samples task then follows its subtasks. */
async function setTrackTaskStatus(slug: string, track: CalibrationTrack, status: 'waiting_client' | 'done' | 'in_progress') {
  const db = createServiceClient()
  const kind = CALIBRATION_TRACKS.find(t => t.id === track)!.kind
  const { data } = await db.from('bfcm_production_steps').select('id,parent_id').eq('plan_slug', slug).eq('kind', kind).maybeSingle()
  if (!data) return null
  await db.from('bfcm_production_steps').update({ status, updated_at: new Date().toISOString() }).eq('id', data.id)
  return data as { id: string; parent_id: string | null }
}

/** Creates this brand's calibration (one client link, two tracks) if it doesn't exist yet. */
export async function startCalibration(slug: string): Promise<Result> {
  return staff(slug, async () => {
    const db = createServiceClient()
    const { data: plan } = await db.from('bfcm_plans').select('slug').eq('slug', slug).maybeSingle()
    if (!plan) return { ok: false, error: 'Plan not found.' }
    if (!await calibrationOf(slug)) {
      const { error } = await db.from('bfcm_calibrations').insert({ plan_slug: slug, share_token: randomBytes(32).toString('hex') })
      if (error && !await calibrationOf(slug)) return { ok: false, error: 'Unable to start calibration.' }
    }
    const { error } = await db.from('bfcm_calibration_tracks').upsert(CALIBRATION_TRACKS.map(t => ({ plan_slug: slug, track: t.id })), { onConflict: 'plan_slug,track', ignoreDuplicates: true })
    if (error) return { ok: false, error: 'Unable to start calibration.' }
    await ensureCalibrationSubtasks(slug)
    refresh(slug)
    return { ok: true }
  })
}

/**
 * First half of an upload: a signed URL the browser uploads straight to.
 * Same two-step flow as brand documents, since a Server Action body is capped at 1MB.
 */
export async function createCalibrationUploadUrl(slug: string, track: string, contentType: string, byteSize: number): Promise<{ ok: true; path: string; token: string } | { ok: false; error: string }> {
  let out: { ok: true; path: string; token: string } | { ok: false; error: string } = { ok: false, error: 'Unable to start the upload.' }
  const result = await staff(slug, async () => {
    if (!isTrack(track)) return { ok: false, error: 'Invalid track.' }
    const status = await trackStatus(slug, track)
    if (!status) return { ok: false, error: 'Start calibration first.' }
    if (status === 'submitted') return { ok: false, error: 'The client already submitted this track. Reopen it to change samples.' }
    const ext = sampleExtension(contentType)
    if (!ext) return { ok: false, error: 'Samples can be JPG, PNG, WebP, GIF, MP4, MOV or WebM.' }
    const limit = sampleKind(contentType) === 'image' ? MAX_SAMPLE_IMAGE_BYTES : MAX_SAMPLE_VIDEO_BYTES
    if (!Number.isFinite(byteSize) || byteSize <= 0 || byteSize > limit) return { ok: false, error: `Files can be up to ${limit / 1048576}MB.` }
    const { data, error } = await createServiceClient().storage.from(CALIBRATION_BUCKET).createSignedUploadUrl(`${folder(slug)}${randomUUID()}.${ext}`)
    if (error || !data) return { ok: false, error: 'Unable to start the upload.' }
    out = { ok: true, path: data.path, token: data.token }
    return { ok: true }
  })
  return result.ok ? out : result
}

/** Second half: the bytes are in Storage, so this records them as a sample. */
export async function attachCalibrationItem(slug: string, track: string, path: string, name: string, contentType: string): Promise<Result> {
  return staff(slug, async me => {
    if (!isTrack(track)) return { ok: false, error: 'Invalid track.' }
    const cal = await calibrationOf(slug)
    const status = await trackStatus(slug, track)
    if (!cal || !status || status === 'submitted') return { ok: false, error: 'This track can’t take new samples.' }
    const file = typeof path === 'string' && path.startsWith(folder(slug)) ? path.slice(folder(slug).length) : ''
    if (!/^[0-9a-f-]{36}\.[a-z0-9]{2,4}$/.test(file)) return { ok: false, error: 'That upload does not belong to this brand.' }
    const mediaType = sampleKind(contentType)
    if (!mediaType) return { ok: false, error: 'That file type is not accepted.' }
    const db = createServiceClient()
    const { data: listed } = await db.storage.from(CALIBRATION_BUCKET).list(folder(slug).slice(0, -1), { search: file })
    if (!listed?.some(o => o.name === file)) return { ok: false, error: 'The upload didn’t finish. Try again.' }
    const { data: last } = await db.from('bfcm_calibration_items').select('sort_order').eq('plan_slug', slug).order('sort_order', { ascending: false }).limit(1)
    const clean = (typeof name === 'string' ? name : '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 200) || file
    const { error } = await db.from('bfcm_calibration_items').insert({ plan_slug: slug, track, storage_path: path, name: clean, media_type: mediaType, sort_order: ((last?.[0]?.sort_order as number | undefined) ?? 0) + 1, uploaded_by: me.id })
    if (error) return { ok: false, error: 'Unable to add the sample.' }
    refresh(slug, cal.share_token)
    return { ok: true }
  })
}

export async function removeCalibrationItem(slug: string, id: string): Promise<Result> {
  return staff(slug, async () => {
    if (!validId(id)) return { ok: false, error: 'Invalid sample.' }
    const db = createServiceClient()
    const { data: item } = await db.from('bfcm_calibration_items').select('track').eq('id', id).eq('plan_slug', slug).maybeSingle()
    if (!item) { refresh(slug); return { ok: true } }
    if (await trackStatus(slug, item.track as CalibrationTrack) === 'submitted') return { ok: false, error: 'Reopen the track before removing samples.' }
    const { data } = await db.from('bfcm_calibration_items').delete().eq('id', id).eq('plan_slug', slug).select('storage_path')
    if (data?.[0]) await db.storage.from(CALIBRATION_BUCKET).remove([data[0].storage_path as string])
    refresh(slug, (await calibrationOf(slug))?.share_token)
    return { ok: true }
  })
}

/**
 * Shows or hides samples on the client link, one file or a whole track's worth.
 * Works on any track, submitted ones included: pulling an old creative off the
 * link is never blocked. Nothing is deleted; the client's notes stay.
 */
export async function setCalibrationItemsVisible(slug: string, ids: string[], visible: boolean): Promise<Result> {
  return staff(slug, async () => {
    if (!Array.isArray(ids) || !ids.length || ids.length > 500 || !ids.every(validId)) return { ok: false, error: 'Invalid sample.' }
    if (typeof visible !== 'boolean') return { ok: false, error: 'Invalid request.' }
    const { error } = await createServiceClient().from('bfcm_calibration_items').update({ client_visible: visible }).eq('plan_slug', slug).in('id', ids)
    if (error) return { ok: false, error: 'Unable to update the client link.' }
    refresh(slug, (await calibrationOf(slug))?.share_token)
    return { ok: true }
  })
}

// Only the creatives sitting directly in Static / Motion count. Any folder inside them
// ("V1", "_old-versions", "Pre-BF") is never opened, so the parent "01 Calibration"
// link works however editors file their old cuts.
const TRACK_DEPTH = 1

type SyncPlan = { ok: true; files: { id: string; name: string }[]; unchanged: number; unsupported: string[]; skippedFolders: string[]; closed: number; found: string; ignored: string[] }
/**
 * Saves the team's Drive folder and works out what to copy. Point it at "01 Calibration":
 * it reads the Motion and Statics folders inside, and a folder of loose files works too.
 * The browser then copies files one at a time with copyCalibrationDriveFile, so a folder
 * of large videos never hits one request's time limit.
 */
export async function syncCalibrationFolder(slug: string, folderUrl: string): Promise<SyncPlan | { ok: false; error: string }> {
  let out: SyncPlan | null = null
  const result = await staff(slug, async () => {
    if (!await calibrationOf(slug)) return { ok: false, error: 'Start calibration first.' }
    const url = typeof folderUrl === 'string' ? folderUrl.trim() : ''
    let folderId: string
    try { folderId = extractDriveFolderId(url) } catch { return { ok: false, error: 'Paste a Drive folder link (drive.google.com/drive/folders/…).' } }
    if (url.length > 500) return { ok: false, error: 'That link is too long.' }
    let tree
    try { tree = await listDriveFolderTree(folderId, isTrackFolder, TRACK_DEPTH) } catch (e) {
      console.error('[bfcm calibration drive]', e)
      return { ok: false, error: 'Couldn’t open that folder. Check the link, and that the folder is shared with the CRM’s Drive account like Moments folders are.' }
    }
    // Superseded cuts parked in "_old-versions" and the like never become samples.
    const archived = new Set(tree.files.filter(f => isArchivedPath(f.folderPath)).map(f => (f.folderPath ?? []).join(' / ')))
    tree = { ...tree, files: tree.files.filter(f => !isArchivedPath(f.folderPath)), skippedFolders: [...tree.skippedFolders, ...archived] }
    const db = createServiceClient()
    await db.from('bfcm_calibrations').update({ drive_folder_url: url }).eq('plan_slug', slug)
    if (!tree.files.length) {
      refresh(slug)
      return { ok: false, error: `No images or videos found (read ${tree.opened.map(o => `${o.path}: ${o.creatives}`).join(' · ')}${tree.ignored.length ? `; not images or videos: ${tree.ignored.slice(0, 10).join(', ')}` : ''})${tree.skippedFolders.length ? ` (skipped ${tree.skippedFolders.join(', ')})` : ''}. Paste the Calibration folder with Motion and Statics folders inside, and check it’s shared with the CRM.` }
    }
    const { data: tracks } = await db.from('bfcm_calibration_tracks').select('track,status').eq('plan_slug', slug)
    const submitted = new Set((tracks ?? []).filter(t => t.status === 'submitted').map(t => t.track as string))
    const open = tree.files.filter(f => !submitted.has(sampleTrack(f)))
    const { data: existing } = await db.from('bfcm_calibration_items').select('id,drive_file_id,drive_modified_at').eq('plan_slug', slug)
    const plan = planDriveSync(open, existing ?? [])
    out = { ok: true, files: [...plan.add, ...plan.refresh.map(r => r.file)].map(f => ({ id: f.id, name: f.name })), unchanged: plan.unchanged, unsupported: plan.unsupported, skippedFolders: tree.skippedFolders, closed: tree.files.length - open.length, found: tree.opened.map(o => `${o.path}: ${o.creatives}`).join(' · '), ignored: tree.ignored.slice(0, 20) }
    refresh(slug)
    return { ok: true }
  })
  return result.ok && out ? out : result as { ok: false; error: string }
}

/** Copies one file from the saved folder (re-listed here, so only files really in that folder can be copied). */
export async function copyCalibrationDriveFile(slug: string, fileId: string): Promise<Result> {
  return staff(slug, async me => {
    if (typeof fileId !== 'string' || !/^[A-Za-z0-9_-]{10,200}$/.test(fileId)) return { ok: false, error: 'Invalid file.' }
    const db = createServiceClient()
    const cal = await calibrationOf(slug)
    if (!cal?.drive_folder_url) return { ok: false, error: 'Sync the folder first.' }
    const file = (await listDriveFolderTree(extractDriveFolderId(cal.drive_folder_url), isTrackFolder, TRACK_DEPTH)).files.find(f => f.id === fileId && !isArchivedPath(f.folderPath))
    if (!file) return { ok: false, error: 'That file is no longer in the folder.' }
    if (await trackStatus(slug, sampleTrack(file)) === 'submitted') return { ok: false, error: `${file.name}: the client already submitted this track.` }
    const { data: existing } = await db.from('bfcm_calibration_items').select('id,drive_file_id,drive_modified_at').eq('plan_slug', slug).eq('drive_file_id', fileId).maybeSingle()
    if (existing && existing.drive_modified_at === (file.modifiedTime ?? null)) return { ok: true }
    const copied = await copyDriveSample(db, slug, file, existing?.id ?? null, downloadDriveFile, me.id)
    if (!copied.ok) return { ok: false, error: copied.message }
    refresh(slug, cal.share_token)
    return { ok: true }
  })
}

/** Makes a track visible on the client link. Nothing is sent: the team shares the link themselves. */
export async function publishCalibrationTrack(slug: string, track: string): Promise<Result> {
  return staff(slug, async () => {
    if (!isTrack(track)) return { ok: false, error: 'Invalid track.' }
    const cal = await calibrationOf(slug)
    if (!cal) return { ok: false, error: 'Start calibration first.' }
    const db = createServiceClient()
    const { count } = await db.from('bfcm_calibration_items').select('id', { count: 'exact', head: true }).eq('plan_slug', slug).eq('track', track).eq('client_visible', true)
    if (!count) return { ok: false, error: 'Tick at least one sample to show the client before publishing.' }
    const { error } = await db.from('bfcm_calibration_tracks').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('plan_slug', slug).eq('track', track).eq('status', 'draft')
    if (error) return { ok: false, error: 'Unable to publish.' }
    await setTrackTaskStatus(slug, track, 'waiting_client')
    refresh(slug, cal.share_token)
    return { ok: true }
  })
}

/** "draft" takes a live track off the client link; "sent" lets the client change submitted feedback. */
export async function reopenCalibrationTrack(slug: string, track: string, to: 'draft' | 'sent'): Promise<Result> {
  return staff(slug, async () => {
    if (!isTrack(track)) return { ok: false, error: 'Invalid track.' }
    const from = to === 'draft' ? 'sent' : 'submitted'
    if (await trackStatus(slug, track) !== from) return { ok: false, error: 'Reload: this track has changed.' }
    const patch = to === 'draft' ? { status: 'draft' } : { status: 'sent', submitted_at: null }
    const { error } = await createServiceClient().from('bfcm_calibration_tracks').update(patch).eq('plan_slug', slug).eq('track', track).eq('status', from)
    if (error) return { ok: false, error: 'Unable to update the track.' }
    await setTrackTaskStatus(slug, track, to === 'draft' ? 'in_progress' : 'waiting_client')
    refresh(slug, (await calibrationOf(slug))?.share_token)
    return { ok: true }
  })
}

// ── Client side: the token is the only key, and it only reaches one brand's published tracks ──

const closed: Result = { ok: false, error: 'This review is closed. Contact the team if you need to change anything.' }
async function planOfToken(token: string) {
  if (!validToken(token)) return null
  const { data } = await createServiceClient().from('bfcm_calibrations').select('plan_slug').eq('share_token', token).maybeSingle()
  return (data?.plan_slug as string | undefined) ?? null
}
/** The sample, only if its track is live for this token. */
async function openItem(token: string, itemId: unknown) {
  const slug = await planOfToken(token)
  if (!slug || !validId(itemId)) return null
  const { data: item } = await createServiceClient().from('bfcm_calibration_items').select('id,track,client_visible').eq('id', itemId).eq('plan_slug', slug).maybeSingle()
  if (!item || !item.client_visible || await trackStatus(slug, item.track as CalibrationTrack) !== 'sent') return null
  return { slug, id: item.id as string }
}

export async function clientSetSampleStatus(token: string, itemId: string, status: 'pending' | 'approved' | 'needs_changes'): Promise<Result> {
  try {
    if (!['pending', 'approved', 'needs_changes'].includes(status)) return { ok: false, error: 'Invalid sample.' }
    const item = await openItem(token, itemId)
    if (!item) return closed
    const { error } = await createServiceClient().from('bfcm_calibration_items').update({ client_status: status }).eq('id', item.id)
    if (error) return { ok: false, error: 'Couldn’t save. Please try again.' }
    refresh(item.slug, token)
    return { ok: true }
  } catch { return { ok: false, error: 'Couldn’t save. Please try again.' } }
}

export async function clientAddSampleFeedback(token: string, itemId: string, name: string, body: string, pin: { x: number; y: number } | null): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const item = await openItem(token, itemId)
    if (!item) return closed as { ok: false; error: string }
    const text = typeof body === 'string' ? body.trim() : ''
    const author = (typeof name === 'string' ? name.trim() : '').slice(0, 120) || 'Client'
    if (!text || text.length > 5000) return { ok: false, error: 'Write your feedback (up to 5,000 characters).' }
    const inRange = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100
    if (pin && (!inRange(pin.x) || !inRange(pin.y))) return { ok: false, error: 'Invalid pin.' }
    const { data, error } = await createServiceClient().from('bfcm_calibration_feedback')
      .insert({ item_id: item.id, author_name: author, body: text, pin_x: pin?.x ?? null, pin_y: pin?.y ?? null }).select('id').single()
    if (error || !data) return { ok: false, error: 'Couldn’t post your comment. Please try again.' }
    refresh(item.slug, token)
    return { ok: true, id: data.id }
  } catch { return { ok: false, error: 'Couldn’t post your comment. Please try again.' } }
}

/** The client finishes one track. It closes, its task is done, and that track's people are notified. */
export async function clientSubmitCalibrationTrack(token: string, track: string, name: string, note: string): Promise<Result> {
  try {
    const slug = await planOfToken(token)
    if (!slug || !isTrack(track)) return closed
    const author = (typeof name === 'string' ? name.trim() : '').slice(0, 120) || 'Client'
    const clientNote = (typeof note === 'string' ? note.trim() : '').slice(0, 5000) || null
    const db = createServiceClient()
    const { data, error } = await db.from('bfcm_calibration_tracks')
      .update({ status: 'submitted', submitted_at: new Date().toISOString(), submitted_by_name: author, client_note: clientNote })
      .eq('plan_slug', slug).eq('track', track).eq('status', 'sent').select('track')
    if (error || !data?.length) return closed
    const step = await setTrackTaskStatus(slug, track, 'done')
    const [{ data: plan }, { data: assignees }] = await Promise.all([
      db.from('bfcm_plans').select('brand_id,config').eq('slug', slug).maybeSingle(),
      step ? db.from('bfcm_step_assignees').select('profile_id').in('step_id', [step.id, ...(step.parent_id ? [step.parent_id] : [])]) : Promise.resolve({ data: [] as { profile_id: string }[] }),
    ])
    const brandName = (plan?.config as { brand?: { name?: string } } | null)?.brand?.name ?? slug
    const label = CALIBRATION_TRACKS.find(t => t.id === track)!.label.toLowerCase()
    await createNotifications((assignees ?? []).map(a => ({
      recipient_id: a.profile_id as string, actor_label: author, type: 'client_feedback' as const, brand_id: (plan?.brand_id as string | null) ?? null,
      title: `${brandName} sent feedback on the ${label} samples`, body: clientNote?.slice(0, 140) ?? 'Open the samples to see their notes.',
      link: `/bfcm-creatives/${slug}#calibration`,
    })))
    refresh(slug, token)
    return { ok: true }
  } catch { return { ok: false, error: 'Couldn’t submit. Please try again.' } }
}
