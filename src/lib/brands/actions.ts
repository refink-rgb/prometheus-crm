'use server'

// Brand profile server actions: contacts, communication channel, intake
// answers and client rules. Rule edits keep their old wording in
// client_rule_history (database trigger), so these only write the change.

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { canEdit } from '@/lib/permissions'
import { getCachedProfiles } from '@/lib/profiles'
import { CHANNELS, RULE_AREAS, RULE_SOURCES, type Channel, type DocKind, type RuleArea, type RuleSource } from './profile'

type Result = { ok: true } | { ok: false; error: string }

async function editor() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) return { ok: false as const, error: 'Not authorized.' }
  const profiles = await getCachedProfiles()
  const meId = profiles.find(p => p.email.toLowerCase() === (user.email ?? '').toLowerCase())?.id ?? null
  return { ok: true as const, supabase, meId }
}

// Rules show on project, offer and job pages too; the brand page is the one
// that always changes.
function refresh(brandId: string, projectId?: string | null) {
  revalidatePath(`/brands/${brandId}`)
  if (projectId) revalidatePath(`/brands/${brandId}/projects/${projectId}`)
}

const text = (v: FormDataEntryValue | null) => String(v ?? '').trim() || null
const isArea = (v: string): v is RuleArea => v in RULE_AREAS
const isSource = (v: string): v is RuleSource => v in RULE_SOURCES
const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d)

// ── contact & channel ─────────────────────────────────────────────────────
export async function saveContact(formData: FormData): Promise<Result> {
  const auth = await editor()
  if (!auth.ok) return auth
  const { supabase } = auth
  const brandId = String(formData.get('brand_id') ?? '')
  const id = String(formData.get('id') ?? '')
  const name = text(formData.get('name'))
  if (!name) return { ok: false, error: 'Add a name.' }
  const row = {
    name,
    role: text(formData.get('role')),
    email: text(formData.get('email')),
    phone: text(formData.get('phone')),
    notes: text(formData.get('notes')),
    is_primary: formData.get('is_primary') === 'on',
    updated_at: new Date().toISOString(),
  }
  // One primary contact per brand.
  if (row.is_primary) {
    await supabase.from('brand_contacts').update({ is_primary: false }).eq('brand_id', brandId).neq('id', id || '00000000-0000-0000-0000-000000000000')
  }
  const { error } = id
    ? await supabase.from('brand_contacts').update(row).eq('id', id).eq('brand_id', brandId)
    : await supabase.from('brand_contacts').insert({ ...row, brand_id: brandId, sort_order: Date.now() % 2_000_000_000 })
  if (error) return { ok: false, error: error.message }
  refresh(brandId)
  return { ok: true }
}

export async function deleteContact(brandId: string, id: string): Promise<Result> {
  const auth = await editor()
  if (!auth.ok) return auth
  const { error } = await auth.supabase.from('brand_contacts').delete().eq('id', id).eq('brand_id', brandId)
  if (error) return { ok: false, error: error.message }
  refresh(brandId)
  return { ok: true }
}

/** The brand-level fields that are not part of Account details. */
export async function saveBrandProfileFields(
  brandId: string,
  values: { name?: string; website?: string; preferred_channel?: string | null; channel_details?: string | null; intake_answers?: string | null; onboarding_transcript?: string | null; onboarding_call_url?: string | null },
): Promise<Result> {
  const auth = await editor()
  if (!auth.ok) return auth
  const patch: Record<string, string | null> = {}
  if ('name' in values) {
    const name = values.name?.trim()
    if (!name) return { ok: false, error: 'The brand needs a name.' }
    patch.name = name
  }
  if ('website' in values) {
    const w = values.website?.trim() ?? ''
    patch.website = w && !/^https?:\/\//i.test(w) ? `https://${w}` : w
  }
  if ('preferred_channel' in values) {
    const c = values.preferred_channel ?? ''
    patch.preferred_channel = c in CHANNELS ? (c as Channel) : null
  }
  if ('channel_details' in values) patch.channel_details = values.channel_details?.trim() || null
  if ('intake_answers' in values) patch.intake_answers = values.intake_answers?.trim() || null
  if ('onboarding_transcript' in values) patch.onboarding_transcript = values.onboarding_transcript?.trim() || null
  if ('onboarding_call_url' in values) {
    const u = values.onboarding_call_url?.trim() ?? ''
    patch.onboarding_call_url = u ? (/^https?:\/\//i.test(u) ? u : `https://${u}`) : null
  }
  const { error } = await auth.supabase.from('brands').update(patch).eq('id', brandId)
  if (error) return { ok: false, error: error.message }
  refresh(brandId)
  return { ok: true }
}

export async function setDocumentKind(brandId: string, documentId: string, kind: DocKind): Promise<Result> {
  const auth = await editor()
  if (!auth.ok) return auth
  const { error } = await auth.supabase.from('brand_documents').update({ kind }).eq('id', documentId).eq('brand_id', brandId)
  if (error) return { ok: false, error: error.message }
  refresh(brandId)
  return { ok: true }
}

// ── client rules ──────────────────────────────────────────────────────────
/**
 * A new rule, or (with existing_rule_id) one more time the client told us an
 * existing rule. Either way, if the client's words came from somewhere (a
 * review comment, a call), that is recorded as a mention.
 */
export async function addClientRule(formData: FormData): Promise<Result> {
  const auth = await editor()
  if (!auth.ok) return auth
  const { supabase, meId } = auth
  const brandId = String(formData.get('brand_id') ?? '')
  const projectId = text(formData.get('project_id'))
  const existing = text(formData.get('existing_rule_id'))
  const quote = text(formData.get('quote'))
  const sourceRaw = String(formData.get('source') ?? 'other')
  const source: RuleSource = isSource(sourceRaw) ? sourceRaw : 'other'
  const saidOnRaw = String(formData.get('said_on') ?? '')
  const said_on = isDate(saidOnRaw) ? saidOnRaw : new Date().toISOString().slice(0, 10)

  let ruleId = existing
  if (existing) {
    const { data: r } = await supabase.from('client_rules').select('id').eq('id', existing).eq('brand_id', brandId).maybeSingle()
    if (!r) return { ok: false, error: 'That rule is no longer there.' }
    // Repeated by the client: it is clearly still true.
    await supabase.from('client_rules').update({ last_confirmed_at: new Date().toISOString(), updated_by: meId }).eq('id', existing)
  } else {
    const rule = text(formData.get('rule'))
    if (!rule) return { ok: false, error: 'Write the rule so it applies to future work.' }
    const areaRaw = String(formData.get('area') ?? 'general')
    const { data, error } = await supabase.from('client_rules').insert({
      brand_id: brandId,
      area: isArea(areaRaw) ? areaRaw : 'general',
      rule,
      why: text(formData.get('why')),
      created_by: meId,
      updated_by: meId,
      last_confirmed_at: new Date(`${said_on}T12:00:00Z`).toISOString(),
    }).select('id').single()
    if (error || !data) return { ok: false, error: error?.message ?? 'Could not save the rule.' }
    ruleId = data.id
  }

  // A rule typed in with no source and no quote has nothing to record.
  if (quote || source !== 'other' || existing) {
    const { error } = await supabase.from('client_rule_mentions').insert({
      rule_id: ruleId,
      brand_id: brandId,
      source,
      quote,
      project_comment_id: text(formData.get('project_comment_id')),
      project_id: projectId,
      offer_card_id: text(formData.get('offer_card_id')),
      said_on,
      noted_by: meId,
    })
    if (error) return { ok: false, error: error.message }
  }
  refresh(brandId, projectId)
  return { ok: true }
}

export async function updateClientRule(formData: FormData): Promise<Result> {
  const auth = await editor()
  if (!auth.ok) return auth
  const brandId = String(formData.get('brand_id') ?? '')
  const rule = text(formData.get('rule'))
  if (!rule) return { ok: false, error: 'A rule cannot be empty.' }
  const areaRaw = String(formData.get('area') ?? 'general')
  const { error } = await auth.supabase.from('client_rules').update({
    rule,
    area: isArea(areaRaw) ? areaRaw : 'general',
    why: text(formData.get('why')),
    updated_by: auth.meId,
    // Rewording a rule is checking it.
    last_confirmed_at: new Date().toISOString(),
  }).eq('id', String(formData.get('id') ?? '')).eq('brand_id', brandId)
  if (error) return { ok: false, error: error.message }
  refresh(brandId)
  return { ok: true }
}

export async function confirmClientRule(brandId: string, id: string): Promise<Result> {
  const auth = await editor()
  if (!auth.ok) return auth
  const { error } = await auth.supabase.from('client_rules')
    .update({ last_confirmed_at: new Date().toISOString(), updated_by: auth.meId })
    .eq('id', id).eq('brand_id', brandId)
  if (error) return { ok: false, error: error.message }
  refresh(brandId)
  return { ok: true }
}

/** Retired, never deleted: an old rule the client changed their mind on is
 *  still worth knowing about if it comes up again. */
export async function retireClientRule(brandId: string, id: string, reason: string): Promise<Result> {
  const auth = await editor()
  if (!auth.ok) return auth
  if (!reason.trim()) return { ok: false, error: 'Say why it no longer applies.' }
  const { error } = await auth.supabase.from('client_rules').update({
    status: 'retired', retired_reason: reason.trim(), retired_at: new Date().toISOString(), updated_by: auth.meId,
  }).eq('id', id).eq('brand_id', brandId)
  if (error) return { ok: false, error: error.message }
  refresh(brandId)
  return { ok: true }
}

export async function restoreClientRule(brandId: string, id: string): Promise<Result> {
  const auth = await editor()
  if (!auth.ok) return auth
  const { error } = await auth.supabase.from('client_rules').update({
    status: 'active', retired_reason: null, retired_at: null, updated_by: auth.meId, last_confirmed_at: new Date().toISOString(),
  }).eq('id', id).eq('brand_id', brandId)
  if (error) return { ok: false, error: error.message }
  refresh(brandId)
  return { ok: true }
}
