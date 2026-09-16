import { createClient } from '@/lib/supabase/client'
import { createBrandLogoUploadUrl, saveBrandLogo } from '@/lib/actions'

// Browser side of a brand logo upload: sign, upload straight to Storage, record.
// Shared by the brand page's DNA panel and the Creatives tab's Brand section.

export const BRAND_LOGO_ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml,.svg'

const BY_EXT: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml' }

/** Returns an error message, or null once the logo is saved on the brand. */
export async function uploadBrandLogoFile(brandId: string, file: File): Promise<string | null> {
  // Some browsers report '' for .svg; fall back to the extension.
  const type = file.type || BY_EXT[file.name.split('.').pop()?.toLowerCase() ?? ''] || ''
  const signed = await createBrandLogoUploadUrl(brandId, type, file.size)
  if (!signed.ok) return signed.error
  // Re-wrapped: uploadToSignedUrl sends a File's own .type and ignores contentType.
  const body = file.type === type ? file : new File([file], file.name, { type })
  const { error } = await createClient().storage
    .from('project-images')
    .uploadToSignedUrl(signed.path, signed.token, body, { contentType: type, cacheControl: '31536000' })
  if (error) return `Upload failed: ${error.message}`
  const saved = await saveBrandLogo(brandId, signed.path)
  return saved.ok ? null : saved.error
}

/** A same-page download: Storage's ?download= sends Content-Disposition: attachment. */
export function brandLogoDownloadUrl(logoUrl: string, brandName: string): string {
  const ext = logoUrl.split('?')[0].split('.').pop()?.toLowerCase() || 'png'
  const safe = brandName.replace(/[^\w\- ]+/g, '').trim() || 'brand'
  return `${logoUrl}${logoUrl.includes('?') ? '&' : '?'}download=${encodeURIComponent(`${safe} logo.${ext}`)}`
}
