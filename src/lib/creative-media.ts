// Image or video — one place that decides how a creative is shown.
//
// Pure and dependency-free: the server sync, the importer and every client
// viewer (workspace, gallery, client review link, pin screen) read the same
// rules, so a video can never play in one place and show a broken image in
// another.

import { driveThumb, resizeDriveThumb } from '@/lib/drive-thumb'

/**
 * Supabase Storage refuses any single object over the project's upload limit
 * (50MB today — Dashboard -> Project Settings -> Storage). Checked BEFORE an
 * upload starts: a refused file is only rejected after every byte has gone up,
 * which on a 60MB video was over a minute of waiting for an error.
 */
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024

/** What browsers play natively, with the extension the copy is saved under. */
export const VIDEO_TYPES: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-m4v': 'm4v',
}

export const isVideoMime = (mime: string | null | undefined): boolean => !!mime && mime.startsWith('video/')
export const isImageMime = (mime: string | null | undefined): boolean => !!mime && mime.startsWith('image/')

export type VideoStatus = 'pending' | 'importing' | 'ready' | 'failed' | 'too_large'

/** The fields every viewer needs. A subset of CreativeAsset, so tests and the zip can pass less. */
export interface MediaAsset {
  drive_file_id: string
  thumbnail_url?: string | null
  revision_url?: string | null
  published_url?: string | null
  media_type?: 'image' | 'video' | null
  video_url?: string | null
  video_status?: VideoStatus | string | null
  video_error?: string | null
}

export const isVideoAsset = (a: Pick<MediaAsset, 'media_type'>): boolean => a.media_type === 'video'

/**
 * The still picture for a grid tile or filmstrip. For a video it is Drive's own
 * poster frame — always an image, so tiles stay light and never autoplay.
 */
export function posterOf(a: MediaAsset, size: 600 | 2048 = 600): string {
  if (isVideoAsset(a)) return resizeDriveThumb(a.thumbnail_url, size) ?? driveThumb(a.drive_file_id, size)
  if (size === 600) return a.revision_url ?? a.thumbnail_url ?? driveThumb(a.drive_file_id, 600)
  return a.revision_url ?? resizeDriveThumb(a.thumbnail_url, 2048) ?? driveThumb(a.drive_file_id, 2048)
}

/** What the TEAM is working on: the newest version. Null for a video still importing. */
export function internalSrc(a: MediaAsset): string | null {
  if (isVideoAsset(a)) return a.revision_url ?? a.video_url ?? null
  return posterOf(a, 2048)
}

/** What the CLIENT is shown: the published version, else the original. */
export function clientSrc(a: MediaAsset): string | null {
  if (isVideoAsset(a)) return a.published_url ?? a.video_url ?? null
  return a.published_url ?? resizeDriveThumb(a.thumbnail_url, 2048) ?? driveThumb(a.drive_file_id, 2048)
}

/** One line for a video that cannot play yet, or null when it can. */
export function videoWaitingNote(a: MediaAsset, audience: 'team' | 'client'): string | null {
  if (!isVideoAsset(a)) return null
  if (audience === 'team' ? internalSrc(a) : clientSrc(a)) return null
  switch (a.video_status) {
    case 'too_large':
      return audience === 'team'
        ? `Too large to play here: over ${MAX_VIDEO_BYTES / 1048576}MB. Export a lighter cut and re-sync, or raise the upload limit in Supabase.`
        : 'This video is being prepared.'
    case 'failed':
      return audience === 'team'
        ? `Could not copy this video from Drive${a.video_error ? `: ${a.video_error}` : ''}. Re-sync to try again.`
        : 'This video is being prepared.'
    default:
      return audience === 'team' ? 'Preparing the video — copying it from Drive.' : 'This video is being prepared.'
  }
}
