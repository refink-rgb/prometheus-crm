'use server'

// Staff actions behind the one-page client portal: shared asset links, the
// promised dates a client sees, the "page checked" gate, and asking for a
// check-in. All need an editor.

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { canEdit } from '@/lib/permissions'
import { LINKABLE } from './intake'

type Result = { ok: true } | { ok: false; error: string }

async function editor() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) return null
  const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle()
  return { supabase, name: (prof?.full_name as string | undefined) || user.email || 'Team' }
}
const NO = { ok: false as const, error: 'Not authorized.' }

export async function addAssetLink(brandId: string, url: string, covers: string[], note: string): Promise<Result> {
  const ed = await editor(); if (!ed) return NO
  const u = url.trim()
  if (!/^https?:\/\/\S+$/i.test(u)) return { ok: false, error: 'Paste a full link, starting with https://' }
  const kinds = LINKABLE.map(l => l.k as string).filter(k => covers.includes(k))
  if (kinds.length === 0) return { ok: false, error: 'Tick what the link holds.' }
  const { error } = await ed.supabase.from('brand_asset_links').insert({
    brand_id: brandId, url: u, covers: kinds, note: note.trim() || null, added_by: ed.name,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/brands/${brandId}`)
  return { ok: true }
}

export async function removeAssetLink(id: string, brandId: string): Promise<Result> {
  const ed = await editor(); if (!ed) return NO
  const { error } = await ed.supabase.from('brand_asset_links').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/brands/${brandId}`)
  return { ok: true }
}

/** The date the client sees on their portal. Empty clears it. */
export async function setPromisedDate(projectId: string, brandId: string, date: string): Promise<Result> {
  const ed = await editor(); if (!ed) return NO
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'Pick a date.' }
  const { error } = await ed.supabase.from('projects').update({ promised_date: date || null }).eq('id', projectId)
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/brands/${brandId}`)
  return { ok: true }
}

/** Someone has checked the client's page; it now shows their projects. */
export async function setPortalReady(brandId: string, ready: boolean): Promise<Result> {
  const ed = await editor(); if (!ed) return NO
  const { error } = await ed.supabase.from('brands').update({ portal_ready_at: ready ? new Date().toISOString() : null }).eq('id', brandId)
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/brands/${brandId}`)
  return { ok: true }
}

/** Shows the check-in card on the client's portal now (until answered or 14 days). */
export async function requestCheckIn(brandId: string, on: boolean): Promise<Result> {
  const ed = await editor(); if (!ed) return NO
  const { error } = await ed.supabase.from('brands').update({ checkin_requested_at: on ? new Date().toISOString() : null }).eq('id', brandId)
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/brands/${brandId}`)
  return { ok: true }
}
