'use client'

import { createClient } from '@/lib/supabase/client'
import { createRevisionUploadUrl, attachRevisionUpload } from '@/lib/actions'

// Put a revised creative in front of an asset, without the bytes touching our
// server.
//
// The old path sent the File to a Server Action. Next caps that body at 1MB by
// default and Vercel caps a function request at 4.5MB; the creatives here are
// median 1.81MB and reach 8.6MB, so almost every upload failed. The browser now
// uploads straight to Supabase Storage with a short-lived signed URL and the
// server only records the resulting path.
//
// One helper so the single and bulk uploaders cannot drift.
export async function uploadRevisionFile(
  file: File,
  assetId: string,
  projectId: string,
  brandId: string,
): Promise<{ ok: true; revisionNumber: number | null } | { ok: false; error: string }> {
  if (!file.type.startsWith('image/')) return { ok: false, error: 'That is not an image file.' }

  const signed = await createRevisionUploadUrl(assetId, file.type)
  if (!signed.ok) return signed

  const supabase = createClient()
  const { error } = await supabase.storage
    .from('project-images')
    .uploadToSignedUrl(signed.path, signed.token, file, {
      contentType: file.type,
      cacheControl: '31536000',
    })
  if (error) return { ok: false, error: `Upload failed: ${error.message}` }

  return attachRevisionUpload(assetId, signed.path, projectId, brandId)
}
