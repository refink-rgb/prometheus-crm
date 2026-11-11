'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service'
import { BRAND_DOC_BUCKET } from '@/lib/brand-docs'
import { MAX_CONTRACT_AI_BYTES, readContractWithGemini, type ContractRead } from '@/lib/ai/contract-reader'
import { requireStaffProfile } from './production-server'
import { autofillContract } from './contract-autofill'

// A contract belongs to the brand, not to BFCM: one SOW often covers Moments and BFCM.
// The signed file is a brand document (uploaded with the brand-docs flow), so it also
// shows in the brand's Documents. This table holds the summary the team works from.

const validId = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id)
type Fields = { title: string; signed_on: string | null; deliverables: string; revisions: string; special_terms: string }

async function revalidateBrand(brandId: string) {
  revalidatePath(`/brands/${brandId}`)
  const { data } = await createServiceClient().from('bfcm_plans').select('slug').eq('brand_id', brandId)
  for (const p of data ?? []) revalidatePath(`/bfcm-creatives/${p.slug}`)
}
async function documentOf(brandId: string, documentId: string) {
  const { data } = await createServiceClient().from('brand_documents').select('id,storage_path,mime_type,byte_size').eq('id', documentId).eq('brand_id', brandId).maybeSingle()
  return data as { id: string; storage_path: string; mime_type: string; byte_size: number } | null
}
function clean(input: Fields): Fields | string {
  const t = (v: unknown, max: number) => (typeof v === 'string' ? v.trim() : '').slice(0, max)
  const title = t(input.title, 200)
  if (!title) return 'Give the contract a name.'
  const signed = input.signed_on ? t(input.signed_on, 10) : ''
  if (signed && !/^\d{4}-\d{2}-\d{2}$/.test(signed)) return 'Invalid date.'
  return { title, signed_on: signed || null, deliverables: t(input.deliverables, 5000), revisions: t(input.revisions, 2000), special_terms: t(input.special_terms, 5000) }
}

/** Reads an uploaded contract with AI. Returns the fields for a person to check; saves nothing. */
export async function readContract(brandId: string, documentId: string): Promise<{ ok: true; fields: ContractRead } | { ok: false; error: string }> {
  try {
    await requireStaffProfile()
    if (!validId(brandId) || !validId(documentId)) return { ok: false, error: 'Invalid document.' }
    const doc = await documentOf(brandId, documentId)
    if (!doc) return { ok: false, error: 'That document is no longer on this brand.' }
    if (doc.mime_type !== 'application/pdf' && doc.mime_type !== 'text/plain') return { ok: false, error: 'The AI can read PDF or TXT contracts. Fill the fields in by hand for this one.' }
    if (doc.byte_size > MAX_CONTRACT_AI_BYTES) return { ok: false, error: 'This file is too large for the AI read. Fill the fields in by hand.' }
    const { data: blob, error } = await createServiceClient().storage.from(BRAND_DOC_BUCKET).download(doc.storage_path)
    if (error || !blob) return { ok: false, error: 'Couldn’t open the file.' }
    const fields = await readContractWithGemini(Buffer.from(await blob.arrayBuffer()), doc.mime_type as 'application/pdf' | 'text/plain')
    return { ok: true, fields }
  } catch (error) {
    console.error('[contract read]', error)
    const message = error instanceof Error ? error.message : ''
    return { ok: false, error: /GEMINI_API_KEY/.test(message) ? 'The AI isn’t set up on this server. Fill the fields in by hand.' : message === 'Unauthorized access.' ? 'You need CRM access to do that.' : 'The AI read failed. Try again, or fill the fields in by hand.' }
  }
}

export async function saveContract(brandId: string, contractId: string | null, documentId: string | null, input: Fields): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const me = await requireStaffProfile()
    if (!validId(brandId)) return { ok: false, error: 'Unknown brand.' }
    const fields = clean(input)
    if (typeof fields === 'string') return { ok: false, error: fields }
    if (documentId !== null && (!validId(documentId) || !await documentOf(brandId, documentId))) return { ok: false, error: 'That document is no longer on this brand.' }
    const db = createServiceClient()
    // A contract file already has its record (the database makes one on upload),
    // so "new contract" for that file means filling in that record.
    if (contractId === null && documentId !== null) {
      const { data: existing } = await db.from('brand_contracts').select('id').eq('brand_id', brandId).eq('document_id', documentId).maybeSingle()
      if (existing) contractId = existing.id
    }
    const row = { ...fields, document_id: documentId, updated_by: me.id, updated_by_name: me.name, updated_at: new Date().toISOString() }
    const query = contractId === null
      ? db.from('brand_contracts').insert({ ...row, brand_id: brandId }).select('id').single()
      : validId(contractId) ? db.from('brand_contracts').update(row).eq('id', contractId).eq('brand_id', brandId).select('id').single() : null
    if (!query) return { ok: false, error: 'Invalid contract.' }
    const { data, error } = await query
    if (error || !data) return { ok: false, error: 'Unable to save the contract.' }
    await revalidateBrand(brandId)
    return { ok: true, id: data.id }
  } catch (error) {
    console.error('[contract save]', error)
    return { ok: false, error: error instanceof Error && error.message === 'Unauthorized access.' ? 'You need CRM access to do that.' : 'Unable to save the contract.' }
  }
}

/** Removes the summary. The signed file stays in the brand's Documents. */
export async function deleteContract(brandId: string, contractId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireStaffProfile()
    if (!validId(brandId) || !validId(contractId)) return { ok: false, error: 'Invalid contract.' }
    const { error } = await createServiceClient().from('brand_contracts').delete().eq('id', contractId).eq('brand_id', brandId)
    if (error) return { ok: false, error: 'Unable to remove the contract.' }
    await revalidateBrand(brandId)
    return { ok: true }
  } catch { return { ok: false, error: 'Unable to remove the contract.' } }
}

/** Reads the contract's file with AI and saves the terms, if nobody has filled them in yet. */
export async function fillContractFromFile(brandId: string, documentId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireStaffProfile()
    if (!validId(brandId) || !validId(documentId)) return { ok: false, error: 'Invalid document.' }
    const r = await autofillContract(brandId, documentId)
    if (r.ok) await revalidateBrand(brandId)
    return r
  } catch (error) {
    console.error('[contract fill]', error)
    const message = error instanceof Error ? error.message : ''
    return { ok: false, error: /GEMINI_API_KEY/.test(message) ? 'The AI isn’t set up on this server. Fill the terms in by hand.' : message === 'Unauthorized access.' ? 'You need CRM access to do that.' : 'The AI read failed. Try again, or fill the terms in by hand.' }
  }
}
