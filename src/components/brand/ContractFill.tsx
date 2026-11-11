'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { fillContractFromFile } from '@/lib/bfcm/contract-actions'

// Shown on the brand overview for a contract whose terms are still blank:
// the file is on record, so one click reads it.

export default function ContractFill({ brandId, documentId }: { brandId: string; documentId: string }) {
  const router = useRouter()
  const [err, setErr] = useState('')
  const [pending, start] = useTransition()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
      <p className="bp-empty" style={{ margin: 0 }}>Terms not filled in yet.</p>
      <button type="button" className="btn-secondary btn-sm" disabled={pending}
        onClick={() => start(async () => {
          setErr('')
          const r = await fillContractFromFile(brandId, documentId)
          if (!r.ok) setErr(r.error)
          else router.refresh()
        })}>
        {pending ? 'Reading the contract…' : 'Fill in from the file'}
      </button>
      {err && <p style={{ margin: 0, fontSize: 13, color: 'var(--danger)' }}>{err}</p>}
    </div>
  )
}
