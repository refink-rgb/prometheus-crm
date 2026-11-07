'use client'
import { useState } from 'react'
import { updateBfcmPlanSize } from '@/lib/bfcm/size-actions'
import type { Brand } from '@/lib/bfcm/model'

/** Staff control: change a plan's total creatives (and Statics / Motion split) after it was created. */
export default function BfcmPlanSize({ slug, brand, locked }: { slug: string; brand: Brand; locked: boolean }) {
  const grouped0 = brand.contract.kind === 'grouped'
  const [cap, setCap] = useState(String(brand.cap))
  const [grouped, setGrouped] = useState(grouped0)
  const [statics, setStatics] = useState(brand.contract.kind === 'grouped' ? String(brand.contract.static) : '')
  const [motion, setMotion] = useState(brand.contract.kind === 'grouped' ? String(brand.contract.motion) : '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function save(event: React.FormEvent) {
    event.preventDefault()
    const total = Number(cap), s = Number(statics), m = Number(motion)
    if (!Number.isSafeInteger(total) || total < 1 || total > 100000) { setMessage('Enter a total between 1 and 100,000.'); return }
    if (grouped && (!statics || !motion || !Number.isSafeInteger(s) || !Number.isSafeInteger(m) || s < 0 || m < 0 || s + m !== total)) { setMessage('Statics and Motion must be whole numbers that add up to the total.'); return }
    if (!window.confirm(`Change ${brand.name} to ${total} creatives? The category split on step 1 resets to fit the new total.`)) return
    setBusy(true); setMessage('')
    const result = await updateBfcmPlanSize(slug, { cap: total, contract: grouped ? 'grouped' : 'flexible', ...(grouped ? { static: s, motion: m } : {}) })
    if (!result.ok) { setMessage(result.error); setBusy(false); return }
    // A full reload: the planner below keeps its own copy of the plan and version.
    window.location.reload()
  }

  const input = { width: 110, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', color: 'var(--text-primary)' } as const
  const summary = brand.contract.kind === 'grouped' ? `${brand.cap} creatives · ${brand.contract.static} statics / ${brand.contract.motion} motion` : `${brand.cap} creatives`
  return <details style={{ margin: '12px 32px 0', padding: 14, border: '1px solid var(--border)', borderRadius: 10, fontSize: 13 }}>
    <summary style={{ cursor: 'pointer' }}>Creative count · {summary}</summary>
    {locked
      ? <p style={{ margin: '12px 0 0' }}>This plan is confirmed. Reopen it (bottom of the plan) to change the count.</p>
      : <form onSubmit={save} style={{ display: 'grid', gap: 12, marginTop: 12 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label style={{ display: 'grid', gap: 6 }}>Total creatives<input style={input} type="number" min="1" max="100000" step="1" value={cap} onChange={e => setCap(e.target.value)} disabled={busy} required /></label>
          {grouped && <>
            <label style={{ display: 'grid', gap: 6 }}>Statics<input style={input} type="number" min="0" max="100000" step="1" value={statics} onChange={e => setStatics(e.target.value)} disabled={busy} required /></label>
            <label style={{ display: 'grid', gap: 6 }}>Motion<input style={input} type="number" min="0" max="100000" step="1" value={motion} onChange={e => setMotion(e.target.value)} disabled={busy} required /></label>
          </>}
          <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save count'}</button>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input type="checkbox" style={{ width: 16, height: 16, margin: 0 }} checked={grouped} onChange={e => setGrouped(e.target.checked)} disabled={busy} />Set contracted Statics / Motion quantities</label>
        <p style={{ margin: 0, color: 'var(--text-muted)' }}>The category split on step 1 resets to fit the new total. Anyone with the plan open will be asked to reload.</p>
      </form>}
    {message && <p role="alert" style={{ margin: '12px 0 0', color: 'var(--danger,#b42318)' }}>{message}</p>}
  </details>
}
