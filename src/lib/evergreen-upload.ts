'use client'

import { createClient } from '@/lib/supabase/client'
import { attachEvergreenUpload, createEvergreenUploadUrl } from '@/lib/evergreen-actions'
import { MEDIA_LABELS, maxBytesOf, mediaTypeOf } from '@/lib/evergreen'
import { captureVideoPoster } from '@/lib/video-poster'

// Upload a static or a video onto an evergreen ad, the way creative revisions
// are uploaded (upload-revision.ts): the browser sends the bytes straight to
// Supabase Storage on a signed URL, and the server only records the paths. For
// a video the browser also grabs a still frame for the player's poster.

const BUCKET = 'project-images'

export async function uploadEvergreenFile(
  file: File,
  adId: string,
  replaceId?: string | null,
): Promise<{ ok: true; creativeId: string } | { ok: false; error: string }> {
  const type = mediaTypeOf(file.type)
  if (!type) return { ok: false, error: `${file.name}: upload an image (JPG, PNG, WebP, GIF) or a video (MP4, MOV, WebM).` }
  // Checked BEFORE uploading: Storage only refuses an oversized file after
  // every byte has gone up.
  const limit = maxBytesOf(type)
  if (file.size > limit) {
    return { ok: false, error: `${file.name} is ${(file.size / 1048576).toFixed(1)}MB. The limit for a ${MEDIA_LABELS[type].one} is ${limit / 1048576}MB.` }
  }

  const signed = await createEvergreenUploadUrl(adId, file.type)
  if (!signed.ok) return signed

  const storage = createClient().storage.from(BUCKET)
  const { error } = await storage.uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type, cacheControl: '31536000' })
  if (error) return { ok: false, error: `${file.name}: upload failed: ${error.message}` }

  // Best-effort: no still just means a dark tile with a play badge.
  let posterPath: string | null = null
  if (type === 'video' && signed.posterPath && signed.posterToken) {
    const still = await captureVideoPoster(file)
    if (still) {
      const put = await storage.uploadToSignedUrl(signed.posterPath, signed.posterToken, still, { contentType: 'image/jpeg', cacheControl: '31536000' })
      if (put.error) console.error('[uploadEvergreenFile] poster upload', adId, put.error.message)
      else posterPath = signed.posterPath
    }
  }

  const name = file.name.replace(/\.[a-z0-9]+$/i, '')
  const saved = await attachEvergreenUpload({ adId, path: signed.path, posterPath, name, replaceId })
  return saved.ok ? saved : { ok: false, error: `${file.name}: ${saved.error}` }
}
