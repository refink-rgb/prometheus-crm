// Pulling calibration samples from the team's Drive folder, the way Moments
// creatives come in. Unlike Moments, every file (image or video) is COPIED into
// the CRM's own storage: the client then sees it even if the Drive folder is not
// shared publicly, and a video plays without waiting for an importer.
//
// No app-only imports here: Drive access and the database are passed in, so a
// test can run this with a fake Drive (see calibration-drive.test.ts).

import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

export const CALIBRATION_BUCKET = 'project-images'
export const SAMPLE_IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }
export const SAMPLE_VIDEO_TYPES: Record<string, string> = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-m4v': 'm4v' }
export const MAX_SAMPLE_IMAGE_BYTES = 50 * 1024 * 1024
// Same ceiling as Moments videos (MAX_VIDEO_BYTES): the storage project's per-object limit.
export const MAX_SAMPLE_VIDEO_BYTES = 250 * 1024 * 1024

export type CalibrationTrack = 'statics' | 'motion'
export type DriveListing = { id: string; name: string; mimeType: string; modifiedTime?: string; folderPath?: string[] }
export type DriveFetcher = (fileId: string, maxBytes: number) => Promise<{ ok: true; bytes: Buffer; mimeType: string } | { ok: false; reason: 'too_large' | 'error'; message: string }>
type Existing = { id: string; drive_file_id: string | null; drive_modified_at: string | null }

const folderTrack = (name: string): CalibrationTrack | null => /motion|video/i.test(name) ? 'motion' : /static|image/i.test(name) ? 'statics' : null
/** Only folders named for a track are read, so pasting too high up can't pull in "00 Assets" or "03 Final". */
export const isTrackFolder = (name: string) => folderTrack(name) !== null
/**
 * Editors park superseded cuts in a subfolder ("_old-versions", "Old", "Archive").
 * Everything below a track folder used to count, so those came back as samples.
 * Any folder starting with "_" or named old/archive/previous/superseded is skipped.
 */
export const isArchivedFolder = (name: string) => name.startsWith('_') || /(^|[^a-z0-9])(old|archived?|previous|superseded|outdated)([^a-z0-9]|$)/i.test(name)
export const isArchivedPath = (path: string[] | undefined) => (path ?? []).some(isArchivedFolder)

/** The Drive folder decides the track; a file directly in the pasted folder goes by its type. */
export function sampleTrack(file: Pick<DriveListing, 'mimeType' | 'folderPath'>): CalibrationTrack {
  for (const name of file.folderPath ?? []) { const track = folderTrack(name); if (track) return track }
  return file.mimeType.startsWith('video/') ? 'motion' : 'statics'
}

export const sampleExtension = (mime: string) => SAMPLE_IMAGE_TYPES[mime] ?? SAMPLE_VIDEO_TYPES[mime] ?? null
export const sampleKind = (mime: string): 'image' | 'video' | null => SAMPLE_IMAGE_TYPES[mime] ? 'image' : SAMPLE_VIDEO_TYPES[mime] ? 'video' : null
export const sampleName = (fileName: string) => fileName.replace(/\.[^.]+$/, '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 200) || 'Sample'

/**
 * What a sync will do. New Drive files are added; a file already copied but edited
 * since (newer modifiedTime) is refreshed in place, keeping its client notes.
 * Files that left the folder are never removed: samples a client has seen stay put.
 */
export function planDriveSync(listed: DriveListing[], existing: Existing[]) {
  const byDriveId = new Map(existing.filter(e => e.drive_file_id).map(e => [e.drive_file_id!, e]))
  const add: DriveListing[] = [], refresh: { file: DriveListing; itemId: string }[] = [], unsupported: string[] = []
  let unchanged = 0
  for (const file of listed) {
    if (!sampleKind(file.mimeType)) { unsupported.push(file.name); continue }
    const known = byDriveId.get(file.id)
    if (!known) add.push(file)
    else if ((file.modifiedTime ?? '') !== (known.drive_modified_at ?? '')) refresh.push({ file, itemId: known.id })
    else unchanged++
  }
  return { add, refresh, unchanged, unsupported }
}

/** Copies one Drive file into storage and records it as a sample (new, or replacing an edited one). */
export async function copyDriveSample(
  db: SupabaseClient, slug: string, file: DriveListing, itemId: string | null, fetchFile: DriveFetcher, uploadedBy: string | null,
): Promise<{ ok: true; outcome: 'added' | 'refreshed' } | { ok: false; message: string }> {
  const kind = sampleKind(file.mimeType)
  if (!kind) return { ok: false, message: `${file.name}: not an image or video the client page can show.` }
  const got = await fetchFile(file.id, kind === 'image' ? MAX_SAMPLE_IMAGE_BYTES : MAX_SAMPLE_VIDEO_BYTES)
  if (!got.ok) return { ok: false, message: got.reason === 'too_large' ? `${file.name}: over the ${kind === 'image' ? 50 : 250}MB limit.` : `${file.name}: ${got.message}` }
  // Trust the listing's type over the download's: Drive sometimes serves octet-stream.
  const mime = sampleKind(got.mimeType) === kind ? got.mimeType : file.mimeType
  const path = `bfcm-calibration/${slug}/${randomUUID()}.${sampleExtension(mime)}`
  const up = await db.storage.from(CALIBRATION_BUCKET).upload(path, got.bytes, { contentType: mime, upsert: false, cacheControl: '31536000' })
  if (up.error) return { ok: false, message: `${file.name}: storage: ${up.error.message}` }

  if (itemId) {
    const { data: old } = await db.from('bfcm_calibration_items').select('storage_path').eq('id', itemId).eq('plan_slug', slug).maybeSingle()
    // A changed file needs a fresh look from the client, so its verdict resets; its notes stay.
    const { error } = await db.from('bfcm_calibration_items')
      .update({ storage_path: path, media_type: kind, track: sampleTrack(file), name: sampleName(file.name), drive_modified_at: file.modifiedTime ?? null, client_status: 'pending' })
      .eq('id', itemId).eq('plan_slug', slug)
    if (error) { await db.storage.from(CALIBRATION_BUCKET).remove([path]); return { ok: false, message: `${file.name}: couldn’t update the sample.` } }
    if (old?.storage_path) await db.storage.from(CALIBRATION_BUCKET).remove([old.storage_path as string])
    return { ok: true, outcome: 'refreshed' }
  }

  const { data: last } = await db.from('bfcm_calibration_items').select('sort_order').eq('plan_slug', slug).order('sort_order', { ascending: false }).limit(1)
  const { error } = await db.from('bfcm_calibration_items').insert({
    plan_slug: slug, storage_path: path, name: sampleName(file.name), media_type: kind, track: sampleTrack(file),
    sort_order: ((last?.[0]?.sort_order as number | undefined) ?? 0) + 1,
    drive_file_id: file.id, drive_modified_at: file.modifiedTime ?? null, uploaded_by: uploadedBy,
  })
  if (error) {
    await db.storage.from(CALIBRATION_BUCKET).remove([path])
    // Unique (plan_slug, drive_file_id): a second sync running at the same time already added it.
    return /duplicate|unique/i.test(error.message) ? { ok: true, outcome: 'added' } : { ok: false, message: `${file.name}: couldn’t add the sample.` }
  }
  return { ok: true, outcome: 'added' }
}
