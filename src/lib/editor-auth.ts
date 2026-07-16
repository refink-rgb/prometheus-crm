import type { SupabaseClient } from '@supabase/supabase-js'

export interface EditorToken {
  id: string
  label: string | null
  allowed_brand_ids: string[] | null
}

/** Extract the bearer token from an Authorization header. */
export function bearerToken(req: Request): string | null {
  const h = req.headers.get('authorization') || ''
  const m = h.match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : null
}

/**
 * Validate an editor token against the editor_tokens table using a service-role
 * client. Returns the token row if valid + active, else null. Any DB error
 * (e.g. table missing) is treated as "invalid" so routes fail closed with 401.
 * Best-effort updates last_used_at.
 */
export async function validateEditorToken(
  supabase: SupabaseClient,
  token: string | null,
): Promise<EditorToken | null> {
  if (!token) return null
  const { data, error } = await supabase
    .from('editor_tokens')
    .select('id, label, allowed_brand_ids, revoked, expires_at')
    .eq('token', token)
    .maybeSingle()
  if (error || !data || data.revoked) return null
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null
  void supabase
    .from('editor_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
  return {
    id: data.id,
    label: data.label,
    allowed_brand_ids: data.allowed_brand_ids,
  }
}
