'use server'

import { createHash, randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service'
import { validateOffers, setCopyApproval, approveCopies, lockDraft, reopenDraft, updateDraft, parseStoredDraft, type Draft, type DraftPatch } from './model'
import { planMotionReferences } from './content'
import { loadPlan, requireBfcmEditor, resolveClientPlan } from './server'

type Operation = 'save' | 'approve' | 'lock' | 'reopen' | 'apply-offers' | 'approve-copy' | 'unapprove-copy' | 'regenerate-copy' | 'more-references'
type Result = { ok: true; version: number; draft?: Draft } | { ok: false; error: string }
const editable = ['offers', 'prePercent', 'allocation', 'allocationLocks', 'copies', 'motionIds', 'voiceover', 'sfx', 'notes', 'missing', 'useClientCopy', 'noPreBf'] as const

async function persist(slug: string, input: Draft, expectedVersion: number, operation: Operation, copyId?: string): Promise<Result> {
  if (!['save', 'approve', 'lock', 'reopen', 'apply-offers', 'approve-copy', 'unapprove-copy', 'regenerate-copy', 'more-references'].includes(operation) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) return { ok: false, error: 'Invalid request.' }
  // Runtime validation is required: exported server actions are public POST endpoints.
  const raw = JSON.stringify(input)
  if (raw.length > 240_000) return { ok: false, error: 'This plan is too large. Shorten the text before saving.' }
  const candidate = parseStoredDraft(raw, slug)
  if (!candidate) return { ok: false, error: 'Invalid data. Reload the plan.' }
  const client = createServiceClient()
  const { row, brand, config, draft: current } = await loadPlan(slug, client)
  if (row.version !== expectedVersion) return { ok: false, error: 'This plan was changed in another session. Reload before continuing; your changes have not been overwritten.' }
  const allowedRefs = new Set(planMotionReferences(config).map(ref => ref.id))
  if (candidate.motionIds.length > 10 || candidate.motionIds.some(id => !allowedRefs.has(id))) return { ok: false, error: 'Invalid motion reference for this brand.' }
  if (candidate.copies.some((copy, i) => copy.id !== current.copies[i].id || copy.source !== current.copies[i].source)) return { ok: false, error: 'Copy source labels cannot be changed.' }
  const patch: DraftPatch = {}
  for (const key of editable) {
    if (JSON.stringify(candidate[key]) !== JSON.stringify(current[key])) Object.assign(patch, { [key]: candidate[key] })
  }
  let next = current
  if (operation === 'save') {
    if (current.status === 'locked') return { ok: false, error: 'Explicitly reopen the plan before editing.' }
    if (!Object.keys(patch).length) return { ok: true, version: row.version }
    // Approval/revision/history/status are always derived from the persisted state.
    next = updateDraft({ ...current, allocationLocks: candidate.allocationLocks }, patch)
  } else {
    if (Object.keys(patch).length) return { ok: false, error: 'Wait for your changes to save before confirming.' }
    if (current.status === 'locked' && operation !== 'reopen') return { ok: false, error: 'Explicitly reopen the plan before editing.' }
    if (['approve-copy', 'unapprove-copy', 'regenerate-copy'].includes(operation) && (typeof copyId !== 'string' || !current.copies.some(copy => copy.id === copyId))) return { ok: false, error: 'Invalid copy line.' }
    if (operation === 'approve-copy' || operation === 'unapprove-copy') next = setCopyApproval(current, copyId!, operation === 'approve-copy')
    if (operation === 'more-references') {
      const visible = current.visibleMotionIds ?? config.motionReferences.map(ref => ref.id)
      const replacements = planMotionReferences(config).map(ref => ref.id).filter(id => !visible.includes(id) && !current.motionIds.includes(id))
      if (!replacements.length || current.motionIds.length === 10) return { ok: false, error: 'No more unselected references are available.' }
      let cursor = 0
      const visibleMotionIds = visible.map(id => current.motionIds.includes(id) ? id : replacements[cursor++] ?? id)
      next = { ...current, visibleMotionIds, revision: current.revision + 1 }
    }
    if (operation === 'apply-offers' || operation === 'regenerate-copy') {
      if (current.useClientCopy) return { ok: false, error: 'Client-provided copy is selected. Turn it off before generating CRM copy.' }
      if (operation === 'regenerate-copy' && current.approvedCopyIds.includes(copyId!)) return { ok: false, error: 'Unapprove this copy before generating a replacement.' }
      if (current.approvedCopyIds.length === current.copies.length) return { ok: false, error: 'All copy is approved. Unapprove a line before generating a replacement.' }
      if (current.status === 'locked') return { ok: false, error: 'Reopen the plan before generating copy.' }
      const errors = validateOffers(current.offers, current.noPreBf)
      if (errors.length) return { ok: false, error: errors.join(' ') }
      const { generateBfcmCopies } = await import('./generate')
      // Keep the existing hypercare restriction, including the actual linked brand name.
      let linkedName: string | null = null
      if (row.brand_id) {
        const { data: linked, error: linkedError } = await client.from('brands').select('name').eq('id', row.brand_id).single()
        if (linkedError || !linked) return { ok: false, error: 'Unable to verify this brand’s restrictions.' }
        linkedName = linked.name
      }
      const { data: claimed, error: claimError } = await client.rpc('bfcm_claim_generation', { p_slug: slug, p_expected_version: row.version })
      if (claimError || claimed !== true) return { ok: false, error: 'Wait 60 seconds between generations, or reload if the plan has changed.' }
      const copies = await generateBfcmCopies(brand, current, linkedName, config.websiteFacts, operation === 'regenerate-copy' ? copyId : undefined)
      next = updateDraft(current, { copies })
    }
    if (operation === 'approve') next = approveCopies(current)
    if (operation === 'lock') next = lockDraft(brand, current, true)
    if (operation === 'reopen') next = reopenDraft(current, true)
  }
  // History is append-only in its own table, atomically recorded by the RPC.
  const state = { ...next, history: undefined }
  const { data: version, error } = await client.rpc('bfcm_save_plan', { p_slug: slug, p_state: state, p_expected_version: expectedVersion })
  if (error || typeof version !== 'number') {
    return { ok: false, error: error?.message.includes('BFCM_CONFLICT') ? 'This plan was changed in another session. Reload to continue.' : 'Unable to save. Your plan has not been confirmed. Try again.' }
  }
  revalidatePath('/bfcm-creatives')
  if (operation !== 'save') {
    const saved = await loadPlan(slug, client)
    return { ok: true, version, draft: saved.draft }
  }
  return { ok: true, version }
}

export async function saveStaffBfcmPlan(slug: string, draft: Draft, expectedVersion: number, operation: Operation = 'save', copyId?: string): Promise<Result> {
  try {
    await requireBfcmEditor()
    return await persist(slug, draft, expectedVersion, operation, copyId)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unable to save the plan.' }
  }
}
export async function saveClientBfcmPlan(token: string, draft: Draft, expectedVersion: number, operation: Operation = 'save', copyId?: string): Promise<Result> {
  try {
    const resolved = await resolveClientPlan(token)
    if (!resolved) return { ok: false, error: 'Invalid or unavailable link.' }
    // slug is derived solely from verified module token → plan. Never draft.brandSlug.
    return await persist(resolved.slug, draft, expectedVersion, operation, copyId)
  } catch {
    return { ok: false, error: 'Unable to save. Try again or contact the team.' }
  }
}

/** Explicit staff-only capability rotation. This does not send any client message. */
export async function createBfcmAccessLink(slug: string): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  try {
    await requireBfcmEditor()
    if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug)) return { ok: false, error: 'Invalid plan.' }
    const token = randomBytes(32).toString('hex')
    const digest = createHash('sha256').update(token).digest('hex')
    const { data, error } = await createServiceClient().from('bfcm_plans').update({ access_token_hash: digest }).eq('slug', slug).select('slug').single()
    if (error || !data) return { ok: false, error: 'Unable to generate the link.' }
    return { ok: true, path: `/portal/bfcm/${token}` }
  } catch { return { ok: false, error: 'Access is unauthorized or unavailable.' } }
}
export async function revokeBfcmAccessLink(slug: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireBfcmEditor()
    if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug)) return { ok: false, error: 'Invalid plan.' }
    const { error } = await createServiceClient().from('bfcm_plans').update({ access_token_hash: null }).eq('slug', slug)
    return error ? { ok: false, error: 'Unable to revoke the link.' } : { ok: true }
  } catch { return { ok: false, error: 'Access is unauthorized or unavailable.' } }
}
