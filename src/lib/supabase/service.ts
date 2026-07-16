import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * Service-role Supabase client for server-side API routes that must bypass RLS
 * (e.g. the token-gated creative read API in /api/creative/*).
 *
 * NEVER import this into client components — it holds full database access.
 * Requires SUPABASE_SERVICE_ROLE_KEY (set in Vercel env + .env.local for local dev).
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (needed by the creative read API).',
    )
  }
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
