'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { confirmOfferByClient } from '@/lib/actions'

export default function ConfirmOfferButton({ token }: { token: string }) {
  const [loading, setLoading] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const router = useRouter()

  async function handleConfirm() {
    if (!confirm('Confirm the offer details above? Once confirmed, these details will be locked for production.')) return
    setLoading(true)
    try {
      await confirmOfferByClient(token)
      setConfirmed(true)
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  if (confirmed) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 8 }}>
        <span>🔒</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--success)' }}>Offer Confirmed — locked for production</span>
      </div>
    )
  }

  return (
    <button
      onClick={handleConfirm}
      disabled={loading}
      style={{
        fontSize: 13, fontWeight: 600,
        color: 'white',
        background: 'var(--accent)',
        border: 'none',
        borderRadius: 8,
        padding: '10px 20px',
        cursor: 'pointer',
        width: '100%',
      }}
    >
      {loading ? 'Confirming...' : '✓ Confirm Offer — Lock for Production'}
    </button>
  )
}
