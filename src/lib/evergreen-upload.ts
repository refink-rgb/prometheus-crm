'use client'

import { createClient } from '@/lib/supabase/client'
import { attachEvergreenVideo, createEvergreenVideoUploadUrl } from '@/lib/evergreen-actions'
import { MAX_VIDEO_BYTES, VIDEO_TYPES } from '@/lib/creative-media'
import { captureVideoPoster } from '@/lib/video-poster'

// Upload a motion video onto an evergreen ad, the way creative revisions are
// uploaded (upload-revision.ts): the browser sends the bytes straight to
// Supabase Storage on a signed URL, grabs a still frame from the file for the
// tile and the player's poster, and the server only records the paths.

export async function uploadEvergreenVideo(
  file: File,
  adId: string,
  replaceVideoId?: string | null,
): Promise<{ ok: true; videoId: string } | { ok: false; error: string }> {
  if (!(file.type in VIDEO_TYPES)) return { ok: false, error: `${file.name}: not a video we can play (MP4, MOV, WebM).` }
  // Checked BEFORE uploading: Storage only refuses an oversized file after
  // every byte has gone up.
  if (file.size > MAX_VIDEO_BYTES) {
    return { ok: false, error: `${file.name} is ${(file.size / 1048576).toFixed(1)}MB — the limit is ${MAX_VIDEO_BYTES / 1048576}MB. Export a lighter cut.` }
  }

  const signed = await createEvergreenVideoUploadUrl(adId, file.type)
  if (!signed.ok) return signed

  const supabase = createClient()
  const { error } = await supabase.storage
    .from('project-images')
    .uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type, cacheControl: '31536000' })
  if (error) return { ok: false, error: `Upload failed: ${error.message}` }

  // Best-effort: no still just means a dark tile with a play badge.
  let posterPath: string | null = null
  if (signed.posterPath && signed.posterToken) {
    const still = await captureVideoPoster(file)
    if (still) {
      const put = await supabase.storage
        .from('project-images')
        .uploadToSignedUrl(signed.posterPath, signed.posterToken, still, { contentType: 'image/jpeg', cacheControl: '31536000' })
      if (put.error) console.error('[uploadEvergreenVideo] poster upload', adId, put.error.message)
      else posterPath = signed.posterPath
    }
  }

  const name = file.name.replace(/\.[a-z0-9]+$/i, '')
  return attachEvergreenVideo({ adId, path: signed.path, posterPath, name, replaceVideoId })
}
