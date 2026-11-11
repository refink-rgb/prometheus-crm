'use server'

// Client intake link actions.
//
// Two audiences. Staff (canEdit) create or rotate a brand's link. The client,
// who has no account, holds only the token: every public action below looks the
// brand up by that token with the service client and can touch nothing else.
// What a token can do: write this brand's intake answers and AI field, add contacts and rules on Done, upload files to this brand, and remove
// only files the client uploaded. It cannot read any other brand data.

import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { canEdit } from '@/lib/permissions'
import {
  BRAND_DOC_BUCKET, BRAND_DOC_TYPES, MAX_BRAND_DOC_BYTES, brandDocPath, safeDocName,
} from '@/lib/brand-docs'
import { filledContacts, intakeText, isIntakeToken, normalizeIntake, ruleLines } from './intake'

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

/** The kinds a client may upload. 'intake' holds their marketing calendar.
 *  Contract stays a staff-only file type. */
const CLIENT_KINDS = ['guidelines', 'logo', 'product_images', 'fonts', 'intake', 'other'] as const
type ClientKind = typeof CLIENT_KINDS[number]

// ── staff ─────────────────────────────────────────────────────────────────

/** Creates the brand's intake link, or a new one (the old link stops working). */
export async function createIntakeLink(brandId: string): Promise<Result<{ token: string }>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) return { ok: false, error: 'Not authorized.' }
  const token = randomBytes(24).toString('base64url') // 32 characters
  const { error } = await supabase.from('brands').update({ intake_token: token }).eq('id', brandId)
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/brands/${brandId}`)
  return { ok: true, token }
}

// ── client (token only) ───────────────────────────────────────────────────

async function brandForToken(token: string) {
  if (!isIntakeToken(token)) return null
  const db = createServiceClient()
  const { data } = await db.from('brands').select('id, name, intake_submitted_at').eq('intake_token', token).maybeSingle()
  return data ? { db, brand: data as { id: string; name: string; intake_submitted_at: string | null } } : null
}

const GONE = { ok: false as const, error: 'This link is no longer active. Ask your Marketing Moments contact for a new one.' }

/**
 * Saves the answers. Autosave calls this with submit=false; the Done button
 * with submit=true, which also adds the contacts and don'ts to the brand page
 * (only then, so a half-typed line never becomes a rule).
 */
export async function saveIntake(token: string, raw: unknown, submit: boolean): Promise<Result<{ savedAt: string }>> {
  const hit = await brandForToken(token)
  if (!hit) return GONE
  const { db, brand } = hit
  const form = normalizeIntake(raw)
  const now = new Date().toISOString()

  const update: Record<string, unknown> = {
    intake_form: form,
    intake_answers: intakeText(form) || null,
    intake_updated_at: now,
  }
  // Only what they answered. A blank never wipes what the team already set.
  if (form.ai != null) update.ai_sensitivity = form.ai
  if (submit) update.intake_submitted_at = now

  const { error } = await db.from('brands').update(update).eq('id', brand.id)
  if (error) return { ok: false, error: 'Could not save. Check your connection and try again.' }

  if (submit) {
    await addContacts(db, brand.id, form)
    await addRules(db, brand.id, form)
  }
  revalidatePath(`/brands/${brand.id}`)
  return { ok: true, savedAt: now }
}

type Db = ReturnType<typeof createServiceClient>

/** New people only: matched on email, else on name, so Done twice adds nobody twice. */
async function addContacts(db: Db, brandId: string, form: ReturnType<typeof normalizeIntake>) {
  const people = filledContacts(form)
  if (!people.length) return
  const { data } = await db.from('brand_contacts').select('name, email, is_primary').eq('brand_id', brandId)
  const existing = (data ?? []) as Array<{ name: string; email: string | null; is_primary: boolean }>
  const known = (c: { name: string; email: string }) => existing.some(e =>
    (c.email.trim() && e.email?.toLowerCase() === c.email.trim().toLowerCase()) ||
    e.name.trim().toLowerCase() === c.name.trim().toLowerCase())
  const hasPrimary = existing.some(e => e.is_primary)
  const rows = people.filter(c => !known(c)).map((c, i) => ({
    brand_id: brandId,
    name: c.name.trim(),
    role: c.role.trim() || null,
    email: c.email.trim() || null,
    phone: c.phone.trim() || null,
    is_primary: !hasPrimary && i === 0 && people[0] === c,
    notes: 'Added by the client on the intake form.',
    sort_order: (Date.now() % 2_000_000_000) + i,
  }))
  if (rows.length) await db.from('brand_contacts').insert(rows)
}

/** Each don't line becomes a client rule (copy or design), with the client's words as a mention. */
async function addRules(db: Db, brandId: string, form: ReturnType<typeof normalizeIntake>) {
  const wanted = [
    ...ruleLines(form.copy_donts).map(rule => ({ area: 'copy', rule })),
    ...ruleLines(form.design_donts).map(rule => ({ area: 'design', rule })),
  ]
  if (!wanted.length) return
  const { data } = await db.from('client_rules').select('rule').eq('brand_id', brandId)
  const have = new Set(((data ?? []) as Array<{ rule: string }>).map(r => r.rule.trim().toLowerCase()))
  const fresh = wanted.filter(w => !have.has(w.rule.toLowerCase()))
  if (!fresh.length) return
  const { data: made } = await db.from('client_rules')
    .insert(fresh.map(w => ({ brand_id: brandId, area: w.area, rule: w.rule.slice(0, 500), why: null })))
    .select('id, rule')
  const mentions = ((made ?? []) as Array<{ id: string; rule: string }>).map(r => ({
    rule_id: r.id, brand_id: brandId, source: 'other', quote: `Intake form: "${r.rule}"`,
  }))
  if (mentions.length) await db.from('client_rule_mentions').insert(mentions)
}

export async function createIntakeUploadUrl(
  token: string, kind: string, contentType: string, byteSize: number,
): Promise<Result<{ path: string; token: string }>> {
  const hit = await brandForToken(token)
  if (!hit) return GONE
  if (!CLIENT_KINDS.includes(kind as ClientKind)) return { ok: false, error: 'Unknown upload type.' }
  if (!BRAND_DOC_TYPES[contentType]) return { ok: false, error: 'That file type is not accepted. Try PDF, PNG, JPG, SVG, fonts or a .zip.' }
  if (!Number.isFinite(byteSize) || byteSize <= 0) return { ok: false, error: 'That file is empty.' }
  if (byteSize > MAX_BRAND_DOC_BYTES) return { ok: false, error: `That file is over ${MAX_BRAND_DOC_BYTES / 1048576}MB. Share it as a Drive or Dropbox link below instead.` }
  const { data, error } = await hit.db.storage.from(BRAND_DOC_BUCKET).createSignedUploadUrl(brandDocPath(hit.brand.id, contentType))
  if (error || !data) return { ok: false, error: 'Could not start the upload. Try again.' }
  return { ok: true, path: data.path, token: data.token }
}

export async function attachIntakeFile(
  token: string,
  input: { path: string; fileName: string; contentType: string; byteSize: number; kind: string },
): Promise<Result<{ id: string }>> {
  const hit = await brandForToken(token)
  if (!hit) return GONE
  const { db, brand } = hit
  const spec = BRAND_DOC_TYPES[input.contentType]
  if (!CLIENT_KINDS.includes(input.kind as ClientKind)) return { ok: false, error: 'Unknown upload type.' }
  if (!spec || !input.path.startsWith(`${brand.id}/`) || input.path.includes('..') || !input.path.endsWith(`.${spec.ext}`)) {
    return { ok: false, error: 'That upload does not belong to this link.' }
  }
  if (!Number.isFinite(input.byteSize) || input.byteSize <= 0 || input.byteSize > MAX_BRAND_DOC_BYTES) {
    return { ok: false, error: 'That file is outside the size limit.' }
  }
  const { data, error } = await db.from('brand_documents').insert({
    brand_id: brand.id,
    storage_path: input.path,
    file_name: safeDocName(input.fileName, input.contentType),
    mime_type: input.contentType,
    byte_size: Math.round(input.byteSize),
    uploaded_by: null,
    uploaded_by_name: 'Client (intake link)',
    kind: input.kind,
    from_client: true,
  }).select('id').single()
  if (error || !data) return { ok: false, error: 'The file uploaded but could not be saved. Try again.' }
  await db.from('brands').update({ intake_updated_at: new Date().toISOString() }).eq('id', brand.id)
  revalidatePath(`/brands/${brand.id}`)
  return { ok: true, id: (data as { id: string }).id }
}

/** The client can take back only what they uploaded through the link. */
export async function removeIntakeFile(token: string, documentId: string): Promise<Result> {
  const hit = await brandForToken(token)
  if (!hit) return GONE
  const { db, brand } = hit
  const { data: row } = await db.from('brand_documents').select('storage_path')
    .eq('id', documentId).eq('brand_id', brand.id).eq('from_client', true).maybeSingle()
  if (!row) return { ok: false, error: 'That file is already gone.' }
  const { error } = await db.from('brand_documents').delete().eq('id', documentId).eq('brand_id', brand.id)
  if (error) return { ok: false, error: 'Could not remove it. Try again.' }
  await db.storage.from(BRAND_DOC_BUCKET).remove([(row as { storage_path: string }).storage_path])
  revalidatePath(`/brands/${brand.id}`)
  return { ok: true }
}
