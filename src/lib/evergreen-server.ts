import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import type { EvergreenStage } from '@/lib/evergreen'

/**
 * Who is on each ad. `ready` is false until the 20261110 migration adds the
 * table: the pages then hide the people controls instead of breaking.
 */
export async function loadAdAssignees(db: SupabaseClient, adIds: string[]): Promise<{ ready: boolean; byAd: Map<string, string[]> }> {
  const byAd = new Map<string, string[]>()
  const query = db.from('evergreen_ad_assignees').select('ad_id, profile_id')
  const { data, error } = await (adIds.length ? query.in('ad_id', adIds) : query.limit(1))
  if (error) return { ready: false, byAd }
  if (adIds.length) for (const r of data ?? []) byAd.set(r.ad_id as string, [...(byAd.get(r.ad_id as string) ?? []), r.profile_id as string])
  return { ready: true, byAd }
}

export type MyEvergreenAd = { id: string; name: string; stage: EvergreenStage; due_date: string | null; brand: string }

/** Evergreen ads one person is building and that are not live yet, for the dashboard's My Work. Empty on any error. */
export async function loadMyEvergreenAds(profileId: string): Promise<MyEvergreenAd[]> {
  const db = createServiceClient()
  const mine = await db.from('evergreen_ad_assignees').select('ad_id').eq('profile_id', profileId)
  if (mine.error || !mine.data?.length) return []
  const { data, error } = await db.from('evergreen_ads').select('id, name, stage, due_date, brands(name)')
    .in('id', mine.data.map(r => r.ad_id as string)).eq('is_archived', false).neq('stage', 'live')
  if (error || !data) return []
  return data.map(a => ({
    id: a.id as string, name: a.name as string, stage: a.stage as EvergreenStage, due_date: (a.due_date as string | null) ?? null,
    brand: (a.brands as unknown as { name?: string } | null)?.name ?? '',
  })).sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))
}
