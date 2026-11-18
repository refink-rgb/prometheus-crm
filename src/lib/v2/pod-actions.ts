'use server'
// Prometheus 2.0: setting up pods. Management only (canUse2), on top of the
// app-wide canEdit gate.

import { revalidatePath } from 'next/cache'
import { getCachedProfiles } from '@/lib/profiles'
import { isPodRole, isUuid, roleLabel } from './model'
import { cleanText as cleanName, failure as baseFailure, isMissing, manager, refresh as baseRefresh, type DbError, type Result } from './guard'

const NOT_AUTHORIZED = { ok: false as const, error: 'Only the management team can set up pods for now.' }
const NAME_LIMIT = 80

const failure = (error: DbError, fallback: string) => baseFailure(error, fallback, fallback)

function refresh(podId?: string) {
  baseRefresh('/v2/pods', ...(podId ? [`/v2/pods/${podId}`] : []))
}

export async function createPod(rawName: string): Promise<Result<{ id: string }>> {
  const m = await manager()
  if (!m) return NOT_AUTHORIZED
  const name = cleanName(rawName)
  if (!name) return { ok: false, error: 'Give the pod a name.' }
  if (name.length > NAME_LIMIT) return { ok: false, error: `Keep the name under ${NAME_LIMIT} characters.` }
  const { data, error } = await m.supabase.from('pods').insert({ name, created_by: m.meId }).select('id').single()
  if (error || !data) return failure(error, `There's already a pod called "${name}".`)
  refresh(data.id)
  return { ok: true, id: data.id }
}

export async function renamePod(podId: string, rawName: string): Promise<Result> {
  const m = await manager()
  if (!m) return NOT_AUTHORIZED
  if (!isUuid(podId)) return { ok: false, error: 'That pod no longer exists.' }
  const name = cleanName(rawName)
  if (!name) return { ok: false, error: 'Give the pod a name.' }
  if (name.length > NAME_LIMIT) return { ok: false, error: `Keep the name under ${NAME_LIMIT} characters.` }
  const { error } = await m.supabase.from('pods').update({ name, updated_at: new Date().toISOString() }).eq('id', podId)
  if (error) return failure(error, `There's already a pod called "${name}".`)
  refresh(podId)
  return { ok: true }
}

/** Archiving frees its clients (they show as "no pod") and keeps its history. */
export async function archivePod(podId: string): Promise<Result> {
  const m = await manager()
  if (!m) return NOT_AUTHORIZED
  if (!isUuid(podId)) return { ok: false, error: 'That pod no longer exists.' }
  const { error: brandErr } = await m.supabase.from('brands').update({ pod_id: null }).eq('pod_id', podId)
  if (brandErr) return failure(brandErr, 'Could not free the pod\'s clients.')
  const { error } = await m.supabase.from('pods').update({ archived_at: new Date().toISOString() }).eq('id', podId)
  if (error) return failure(error, 'Could not archive the pod.')
  refresh(podId)
  return { ok: true }
}

export async function addPodMember(podId: string, profileId: string, role: string): Promise<Result> {
  const m = await manager()
  if (!m) return NOT_AUTHORIZED
  if (!isUuid(podId) || !isUuid(profileId)) return { ok: false, error: 'Pick a person.' }
  if (!isPodRole(role)) return { ok: false, error: 'Pick a role.' }
  const person = (await getCachedProfiles()).find(p => p.id === profileId && p.can_edit)
  if (!person) return { ok: false, error: 'That person doesn\'t have access to Prometheus.' }
  const { error } = await m.supabase.from('pod_members').insert({ pod_id: podId, profile_id: profileId, role })
  if (error) {
    return failure(error, role === 'account_manager'
      ? 'This pod already has an account manager. Remove them first.'
      : `${person.full_name || person.email} is already a ${roleLabel(role).toLowerCase()} in this pod.`)
  }
  refresh(podId)
  return { ok: true }
}

export async function removePodMember(podId: string, profileId: string, role: string): Promise<Result> {
  const m = await manager()
  if (!m) return NOT_AUTHORIZED
  if (!isUuid(podId) || !isUuid(profileId)) return { ok: false, error: 'That person is no longer in the pod.' }
  const { error } = await m.supabase.from('pod_members').delete().eq('pod_id', podId).eq('profile_id', profileId).eq('role', role)
  if (error) return failure(error, 'Could not remove them.')
  refresh(podId)
  return { ok: true }
}

/** Puts a client in a pod (or takes them out with null). Their open 2.0 work
 *  moves with them. */
export async function setClientPod(brandId: string, podId: string | null): Promise<Result> {
  const m = await manager()
  if (!m) return NOT_AUTHORIZED
  if (!isUuid(brandId)) return { ok: false, error: 'That client no longer exists.' }
  if (podId !== null && !isUuid(podId)) return { ok: false, error: 'Pick a pod.' }
  const { data: before } = await m.supabase.from('brands').select('pod_id').eq('id', brandId).maybeSingle()
  const { error } = await m.supabase.from('brands').update({ pod_id: podId }).eq('id', brandId)
  if (error) return failure(error, 'Could not move the client.')
  const { error: workErr } = await m.supabase.from('work').update({ pod_id: podId, updated_at: new Date().toISOString() })
    .eq('brand_id', brandId).in('status', ['active', 'on_hold'])
  if (workErr && !isMissing(workErr)) return failure(workErr, 'The client moved, but their open work did not.')
  const oldPod = (before as { pod_id: string | null } | null)?.pod_id ?? undefined
  refresh(podId ?? undefined)
  if (oldPod) revalidatePath(`/v2/pods/${oldPod}`)
  return { ok: true }
}
