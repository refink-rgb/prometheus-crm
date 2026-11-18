// Prometheus 2.0: reads for the pods screens. Server only.

import type { createClient } from '@/lib/supabase/server'
import { getCachedProfiles } from '@/lib/profiles'
import { profileName } from '@/lib/types'
import { MISSING_TABLE, MISSING_COLUMN, POD_ROLES, type Pod, type PodMember } from './model'

type Supabase = Awaited<ReturnType<typeof createClient>>

export type Person = { id: string; name: string }
export type Client = { id: string; name: string; is_active: boolean; pod_id: string | null }
export type PodView = Pod & {
  members: (PodMember & { name: string })[]
  clients: Client[]
}

export type PodsData =
  | { missing: true }
  | { missing: false; pods: PodView[]; people: Person[]; clients: Client[] }

/** Active pods with their people and clients, everyone who can be put in a pod,
 *  and every client. `missing` when the 2.0 tables aren't in this database yet. */
export async function loadPods(supabase: Supabase): Promise<PodsData> {
  const [podsRes, membersRes, brandsRes, profiles] = await Promise.all([
    supabase.from('pods').select('id, name, archived_at, created_at').is('archived_at', null).order('name'),
    supabase.from('pod_members').select('pod_id, profile_id, role'),
    supabase.from('brands').select('id, name, is_active, pod_id').order('name'),
    getCachedProfiles(),
  ])
  const missing = [podsRes.error, membersRes.error, brandsRes.error]
    .some(e => e && (MISSING_TABLE.has(e.code ?? '') || MISSING_COLUMN.has(e.code ?? '')))
  if (missing) return { missing: true }

  const people: Person[] = profiles
    .filter(p => p.can_edit)
    .map(p => ({ id: p.id, name: profileName(p) }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const nameOf = (id: string) => people.find(p => p.id === id)?.name ?? profiles.find(p => p.id === id)?.email ?? 'Someone'
  const roleOrder = (role: string) => {
    const i = POD_ROLES.findIndex(r => r.id === role)
    return i === -1 ? POD_ROLES.length : i
  }

  const clients = ((brandsRes.data ?? []) as Client[]).map(c => ({ ...c, is_active: c.is_active ?? true }))
  const members = (membersRes.data ?? []) as PodMember[]
  const pods: PodView[] = ((podsRes.data ?? []) as Pod[]).map(pod => ({
    ...pod,
    members: members
      .filter(m => m.pod_id === pod.id)
      .map(m => ({ ...m, name: nameOf(m.profile_id) }))
      .sort((a, b) => roleOrder(a.role) - roleOrder(b.role) || a.name.localeCompare(b.name)),
    clients: clients.filter(c => c.pod_id === pod.id),
  }))
  return { missing: false, pods, people, clients }
}
