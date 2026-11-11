import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'
import { BRAND_DOC_BUCKET } from '@/lib/brand-docs'
import { MAX_CONTRACT_AI_BYTES, readContractWithGemini } from '@/lib/ai/contract-reader'

// Fills a contract's terms from its file with AI, for contracts nobody has
// filled in yet. Called after a contract file is uploaded (the database makes
// the record; see 20261111b_contract_file_makes_contract.sql) and from the
// "Fill in from the file" button. Never overwrites terms a person has written.

export type AutofillResult = { ok: true } | { ok: false; error: string }

export async function autofillContract(brandId: string, documentId: string): Promise<AutofillResult> {
  const db = createServiceClient()
  const { data: contract } = await db.from('brand_contracts')
    .select('id, deliverables, revisions, special_terms')
    .eq('brand_id', brandId).eq('document_id', documentId).maybeSingle()
  if (!contract) return { ok: false, error: 'No contract record for that file.' }
  if (contract.deliverables || contract.revisions || contract.special_terms) return { ok: true }

  const { data: doc } = await db.from('brand_documents')
    .select('storage_path, mime_type, byte_size').eq('id', documentId).eq('brand_id', brandId).maybeSingle()
  if (!doc) return { ok: false, error: 'That file is no longer on this brand.' }
  if (doc.mime_type !== 'application/pdf' && doc.mime_type !== 'text/plain') return { ok: false, error: 'The AI can read PDF or TXT contracts. Fill the terms in by hand for this one.' }
  if (doc.byte_size > MAX_CONTRACT_AI_BYTES) return { ok: false, error: 'This file is too large for the AI read. Fill the terms in by hand.' }

  const { data: blob, error } = await db.storage.from(BRAND_DOC_BUCKET).download(doc.storage_path)
  if (error || !blob) return { ok: false, error: 'Couldn’t open the file.' }
  const f = await readContractWithGemini(Buffer.from(await blob.arrayBuffer()), doc.mime_type as 'application/pdf' | 'text/plain')

  const update: Record<string, string> = {
    deliverables: (f.deliverables ?? '').slice(0, 5000),
    revisions: (f.revisions ?? '').slice(0, 2000),
    special_terms: (f.special_terms ?? '').slice(0, 5000),
    updated_by_name: 'AI read of the contract file',
    updated_at: new Date().toISOString(),
  }
  if (f.title?.trim()) update.title = f.title.trim().slice(0, 200)
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.signed_on ?? '')) update.signed_on = f.signed_on
  // Only while still blank: a person may have saved terms while the AI read.
  await db.from('brand_contracts').update(update)
    .eq('id', contract.id).eq('deliverables', '').eq('revisions', '').eq('special_terms', '')
  return { ok: true }
}
