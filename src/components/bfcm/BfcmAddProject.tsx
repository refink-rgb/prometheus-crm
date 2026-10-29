'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createStaffBfcmPlan } from '@/lib/bfcm/create'

export type BfcmBrandOption = { id: string; name: string; existingSlug: string | null }
export default function BfcmAddProject({ brands, unavailable = false }: { brands: BfcmBrandOption[]; unavailable?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const submitting = useRef(false)
  const router = useRouter()
  const [brandId, setBrandId] = useState('')
  const [cap, setCap] = useState('')
  const [grouped, setGrouped] = useState(false)
  const [statics, setStatics] = useState('')
  const [motion, setMotion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const existing = brands.find(brand => brand.id === brandId)?.existingSlug
  function close() { if (!submitting.current) { dialog.current?.close(); setError('') } }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    if (existing) { dialog.current?.close(); router.push(`/bfcm-creatives/${existing}`); return }
    const total = Number(cap), staticCount = Number(statics), motionCount = Number(motion)
    if (!brandId || !cap || !Number.isSafeInteger(total) || total < 1 || total > 100000) { setError('Select a brand and enter a total between 1 and 100,000.'); return }
    if (grouped && (!statics || !motion || !Number.isSafeInteger(staticCount) || !Number.isSafeInteger(motionCount) || staticCount < 0 || motionCount < 0 || staticCount + motionCount !== total)) { setError('Statics and Motion must be whole numbers that add up to the total.'); return }
    submitting.current = true; setBusy(true); setError('')
    try {
      const result = await createStaffBfcmPlan({ brandId, cap: total, contract: grouped ? 'grouped' : 'flexible', ...(grouped ? { static: staticCount, motion: motionCount } : {}) })
      if (!result.ok) { setError(result.error); return }
      dialog.current?.close(); router.push(`/bfcm-creatives/${result.slug}`); router.refresh()
    } catch { setError('Unable to confirm creation. Try again; an existing plan will not be overwritten.') }
    finally { submitting.current = false; setBusy(false) }
  }
  const field = { display: 'grid', gap: 8, fontSize: 14 } as const
  const input = { width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-primary)', color: 'var(--text-primary)' } as const
  return <>
    <button className="btn-primary" disabled={unavailable} onClick={() => { setError(''); dialog.current?.showModal() }}>Add project</button>
    <dialog ref={dialog} aria-labelledby="bfcm-add-title" onCancel={event => { if (busy) event.preventDefault() }} style={{ width: 'min(520px,calc(100vw - 32px))', maxHeight: 'calc(100vh - 40px)', padding: 28, border: '1px solid var(--border)', borderRadius: 16, background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <form onSubmit={submit} style={{ display: 'grid', gap: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 20 }}><h2 id="bfcm-add-title" style={{ margin: 0, fontSize: 24 }}>Add BFCM project</h2><button type="button" aria-label="Close" className="btn-secondary" disabled={busy} onClick={close}>×</button></div>
        <label style={field}>Brand<select style={input} value={brandId} onChange={event => setBrandId(event.target.value)} disabled={busy} required><option value="">Select a brand</option>{brands.map(brand => <option key={brand.id} value={brand.id}>{brand.name}{brand.existingSlug ? ' — existing plan' : ''}</option>)}</select></label>
        {existing ? <p style={{ margin: 0 }}>This brand already has a BFCM plan.</p> : <>
          <label style={field}>Total creatives<input style={input} type="number" min="1" max="100000" step="1" value={cap} onChange={event => setCap(event.target.value)} disabled={busy} required /></label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14 }}><input type="checkbox" checked={grouped} onChange={event => setGrouped(event.target.checked)} disabled={busy} />Set contracted Statics / Motion quantities</label>
          {grouped && <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}><label style={field}>Statics<input style={input} type="number" min="0" max="100000" step="1" value={statics} onChange={event => setStatics(event.target.value)} disabled={busy} required /></label><label style={field}>Motion<input style={input} type="number" min="0" max="100000" step="1" value={motion} onChange={event => setMotion(event.target.value)} disabled={busy} required /></label></div>}
        </>}
        {error && <p role="alert" style={{ margin: 0, color: 'var(--danger,#b42318)' }}>{error}</p>}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}><button type="button" className="btn-secondary" disabled={busy} onClick={close}>Cancel</button><button type="submit" className="btn-primary" disabled={busy || !brands.length}>{busy ? 'Creating…' : existing ? 'Open plan' : 'Create project'}</button></div>
      </form>
    </dialog>
  </>
}
