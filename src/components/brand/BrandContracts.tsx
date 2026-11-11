'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { BRAND_DOC_BUCKET, MAX_BRAND_DOC_BYTES, resolveDocType } from '@/lib/brand-docs'
import { attachBrandDocument, createBrandDocumentUploadUrl, getBrandDocumentUrl } from '@/lib/actions'
import { deleteContract, readContract, saveContract } from '@/lib/bfcm/contract-actions'
import type { BrandContract } from '@/lib/bfcm/production-server'

// The brand's contracts: the same rows and actions the BFCM page uses, one
// contract per SOW. The signed file is a brand document; this keeps the terms the
// team works from.

type Doc = { id: string; file_name: string }
type Form = { id: string | null; document_id: string | null; title: string; signed_on: string; deliverables: string; revisions: string; special_terms: string }
const blank: Form = { id: null, document_id: null, title: '', signed_on: '', deliverables: '', revisions: '', special_terms: '' }

export const contractDay = (d: string | null) => d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null

export default function BrandContracts({ brandId, contracts, documents }: { brandId: string; contracts: BrandContract[]; documents: Doc[] }) {
  const router = useRouter()
  const [form, setForm] = useState<Form | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [docs, setDocs] = useState(documents)
  const set = (patch: Partial<Form>) => setForm(f => f && { ...f, ...patch })

  async function uploadFile(file: File) {
    setError('')
    const type = resolveDocType(file)
    if (!type) { setError('Contracts can be PDF, Word, or TXT files.'); return }
    if (file.size > MAX_BRAND_DOC_BYTES) { setError('That file is too large.'); return }
    setBusy('Uploading…')
    try {
      const signed = await createBrandDocumentUploadUrl(brandId, type, file.size)
      if (!signed.ok) { setError(signed.error); return }
      const body = file.type === type ? file : new File([file], file.name, { type })
      const { error: upErr } = await createClient().storage.from(BRAND_DOC_BUCKET).uploadToSignedUrl(signed.path, signed.token, body, { contentType: type, cacheControl: '3600' })
      if (upErr) { setError(upErr.message); return }
      const attached = await attachBrandDocument(brandId, { path: signed.path, fileName: file.name, contentType: type, byteSize: file.size, kind: 'contract', autofill: false })
      if (!attached.ok) { setError(attached.error); return }
      setDocs(d => [{ id: attached.documentId, file_name: file.name }, ...d])
      set({ document_id: attached.documentId, title: form?.title || file.name.replace(/\.[^.]+$/, '') })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.')
    } finally {
      setBusy(null)
    }
  }

  async function aiRead() {
    if (!form?.document_id) return
    setBusy('Reading the contract…')
    setError('')
    const result = await readContract(brandId, form.document_id)
    if (result.ok) set({ ...result.fields, title: result.fields.title || form.title })
    else setError(result.error)
    setBusy(null)
  }

  async function save() {
    if (!form) return
    setBusy('Saving…')
    setError('')
    const result = await saveContract(brandId, form.id, form.document_id, { ...form, signed_on: form.signed_on || null })
    if (result.ok) { setForm(null); router.refresh() } else setError(result.error)
    setBusy(null)
  }

  async function open(documentId: string) {
    const result = await getBrandDocumentUrl(documentId, 'view')
    if (result.ok) window.open(result.url, '_blank', 'noopener,noreferrer')
    else setError(result.error)
  }

  async function remove(c: BrandContract) {
    if (!window.confirm(`Remove the “${c.title}” summary? The signed file stays in Files.`)) return
    const result = await deleteContract(brandId, c.id)
    if (result.ok) router.refresh()
    else setError(result.error)
  }

  return (
    <div className="bp-contracts">
      {!form && contracts.length === 0 && (
        <p className="bp-empty">No contract yet. Add the signed SOW so the team can see exactly what was agreed.</p>
      )}
      {!form && contracts.map(c => (
        <div key={c.id} className="bp-contract">
          <div className="mo-spread">
            <span><b>{c.title}</b>{c.signed_on && <span className="mo-muted"> · {contractDay(c.signed_on)}</span>}</span>
            <span className="mo-row" style={{ gap: 14 }}>
              {c.document_id && <button type="button" className="bp-link" onClick={() => void open(c.document_id!)}>View {c.file_name ?? 'file'}</button>}
              <button type="button" className="bp-link" onClick={() => setForm({ id: c.id, document_id: c.document_id, title: c.title, signed_on: c.signed_on ?? '', deliverables: c.deliverables, revisions: c.revisions, special_terms: c.special_terms })}>Edit</button>
              <button type="button" className="bp-link bp-link-muted" onClick={() => void remove(c)}>Remove</button>
            </span>
          </div>
          <span className="bp-hint">Last saved by {c.updated_by_name ?? 'the team'}</span>
        </div>
      ))}
      {!form && <div><button type="button" className="btn-secondary btn-sm" onClick={() => setForm(blank)}>Add contract</button></div>}

      {form && (
        <div className="bp-form">
          <div className="mo-row">
            <label className="btn-secondary btn-sm" style={{ cursor: 'pointer', margin: 0 }}>
              Upload signed file
              <input type="file" hidden accept=".pdf,.docx,.txt,application/pdf" disabled={!!busy} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void uploadFile(f) }} />
            </label>
            {docs.length > 0 && (
              <select style={{ width: 'auto', maxWidth: 280 }} value={form.document_id ?? ''} onChange={e => set({ document_id: e.target.value || null })} aria-label="Contract file">
                <option value="">No file linked</option>
                {docs.map(d => <option key={d.id} value={d.id}>{d.file_name}</option>)}
              </select>
            )}
            <button type="button" className="btn-secondary btn-sm" disabled={!!busy || !form.document_id} onClick={() => void aiRead()} title={form.document_id ? 'Fills the fields below from the file. Check them before saving.' : 'Link a file first'}>Read with AI</button>
            {busy && <span className="mo-muted">{busy}</span>}
          </div>
          <div><label>Name</label><input value={form.title} onChange={e => set({ title: e.target.value })} placeholder="e.g. Marketing Moments SOW, Oct 2026" /></div>
          <div><label>Effective date</label><input type="date" value={form.signed_on} onChange={e => set({ signed_on: e.target.value })} style={{ maxWidth: 200 }} /></div>
          <div><label>Deliverables</label><textarea rows={3} value={form.deliverables} onChange={e => set({ deliverables: e.target.value })} /></div>
          <div><label>Revisions promised</label><textarea rows={2} value={form.revisions} onChange={e => set({ revisions: e.target.value })} /></div>
          <div><label>Special terms</label><textarea rows={3} value={form.special_terms} onChange={e => set({ special_terms: e.target.value })} /></div>
          <div className="mo-row">
            <button type="button" className="btn-primary btn-sm" disabled={!!busy || !form.title.trim()} onClick={() => void save()}>Save contract</button>
            <button type="button" className="btn-secondary btn-sm" disabled={!!busy} onClick={() => { setForm(null); setError('') }}>Cancel</button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mo-error" style={{ margin: 0 }}>{error}</p>}
    </div>
  )
}
