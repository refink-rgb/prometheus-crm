// Prometheus 2.0: the checks every 2.0 server action starts with. Server only.
// (Kept out of the 'use server' files, which may only export actions.)

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { canEdit, canUse2 } from '@/lib/permissions'
import { getCachedProfiles } from '@/lib/profiles'
import { MIGRATION_FILE, MISSING_TABLE, MISSING_COLUMN } from './model'

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }
export type DbError = { code?: string; message: string } | null

export const NOT_AUTHORIZED = { ok: false as const, error: 'Only the management team can use 2.0 for now.' }

/** The signed-in 2.0 user, or null. Profiles are matched by email: profiles.id
 *  is not the auth uid. */
export async function manager() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !(await canEdit(user.email)) || !canUse2(user.email)) return null
  const email = (user.email ?? '').toLowerCase()
  const me = (await getCachedProfiles()).find(p => p.email.toLowerCase() === email) ?? null
  return { supabase, meId: me?.id ?? null }
}

export const isMissing = (error: DbError) =>
  !!error && (MISSING_TABLE.has(error.code ?? '') || MISSING_COLUMN.has(error.code ?? '') || error.code === 'PGRST202')

/** A plain-language error. `duplicate` is used when the database refused a
 *  repeated name or a second lead (unique violation). */
export function failure(error: DbError, fallback: string, duplicate?: string): { ok: false; error: string } {
  if (isMissing(error)) {
    return { ok: false, error: `2.0 needs its latest database changes. Run ${MIGRATION_FILE} and the 2.0 migrations after it in the Supabase SQL editor.` }
  }
  if (error?.code === '23505') return { ok: false, error: duplicate ?? fallback }
  return { ok: false, error: error?.message ? `${fallback} (${error.message})` : fallback }
}

export function refresh(...paths: string[]) {
  revalidatePath('/v2')
  for (const p of paths) revalidatePath(p)
}

export const cleanText = (raw: unknown) => (typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '')
