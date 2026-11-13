'use server'

// Client check-in actions. The client holds only the intake token: the public
// action looks the brand up by it with the service client and can only add a
// check-in for that brand. Staff mark a flagged check-in as followed up.

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { canEdit } from '@/lib/permissions'
import { isIntakeToken } from './intake'
import { parseCheckIn } from './checkin'

type Result = { ok: true } | { ok: false; error: string }

const GONE = { ok: false as const, error: 'This link is no longer active. Ask your Marketing Moments contact for a new one.' }

/** Saves the client's answers. A second send within a day replaces the first, so a double tap or a quick fix makes one row, not two. */
export async function submitCheckIn(token: string, raw: unknown): Promise<Result> {
  if (!isIntakeToken(token)) return GONE
  const parsed = parseCheckIn(raw)
  if (!parsed.ok) return parsed
  const db = createServiceClient()
  const { data: brand } = await db.from('brands').select('id').eq('intake_token', token).maybeSingle()
  if (!brand) return GONE

  const since = new Date(Date.now() - 86_400_000).toISOString()
  const { data: recent } = await db.from('client_checkins').select('id')
    .eq('brand_id', brand.id).gte('created_at', since)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()

  const { error } = recent
    ? await db.from('client_checkins').update({ ...parsed.value, followed_up_at: null, followed_up_by: null }).eq('id', recent.id)
    : await db.from('client_checkins').insert({ ...parsed.value, brand_id: brand.id })
  if (error) return { ok: false, error: 'Could not send. Check your connection and try again.' }
  revalidatePath(`/brands/${brand.id}`)
  return { ok: true }
}

/** Staff: someone has reached out about this check-in. */
export async function markCheckInFollowedUp(id: string, brandId: string): Promise<Result> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) return { ok: false, error: 'Not authorized.' }
  const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle()
  const { error } = await supabase.from('client_checkins')
    .update({ followed_up_at: new Date().toISOString(), followed_up_by: prof?.full_name || user.email })
    .eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/brands/${brandId}`)
  return { ok: true }
}
