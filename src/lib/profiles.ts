import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import type { Profile } from '@/lib/types'

// The whole roster is ~9 rows and changes rarely, so pages fetch it once and
// resolve editor FKs against it in render rather than joining.
//
// Why not a join: projects has TWO FKs to profiles (lp_editor_id and
// creative_editor_id). PostgREST can't disambiguate two relationships to the
// same table without explicit constraint-name hints on every select
// (`profiles!projects_lp_editor_id_fkey(...)`), which would have to be threaded
// through the narrow selects on the dashboard, pipeline, and brand pages. Two
// uuid columns + one small cached query is cheaper and far less fragile.
//
// cache() dedupes across the layout + page + components of a single request,
// same as getCachedUser in supabase/server.ts.
export const getCachedProfiles = cache(async (): Promise<Profile[]> => {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, can_edit, is_lp_editor, is_creative_editor, created_at')
    .order('full_name', { ascending: true })

  // Don't throw: profiles is read on hot paths, and a page that can't resolve an
  // editor's name should still render the project. Callers treat [] as "unknown".
  if (error) {
    console.error('[getCachedProfiles] failed:', error.message)
    return []
  }
  return (data ?? []) as Profile[]
})

export const getProfileMap = cache(async (): Promise<Map<string, Profile>> => {
  const profiles = await getCachedProfiles()
  return new Map(profiles.map(p => [p.id, p]))
})

// NOTE: editorsFor() lives in types.ts, not here. This module imports the
// server-only Supabase client (next/headers), so client components can't pull
// anything from it.
