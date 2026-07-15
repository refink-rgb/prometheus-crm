'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { confirmOfferByClient } from '@/lib/actions'
import { useConfirm } from '@/components/ConfirmDialog'
import { useToast } from '@/components/Toast'

export default function ConfirmOfferButton({ token }: { token: string }) {
  const [loading, setLoading] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const router = useRouter()
  const confirm = useConfirm()
  const toast = useToast()

  async function handleConfirm() {
    const ok = await confirm({
      title: 'Confirm offer details',
      message: 'Once confirmed, these details are locked for production.',
      confirmLabel: 'Confirm offer',
    })
    if (!ok) return
    setLoading(true)
    try {
      await confirmOfferByClient(token)
      setConfirmed(true)
      toast.success('Offer confirmed and locked for production.')
      router.refresh()
    } catch {
      toast.error("Couldn't confirm the offer. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  if (confirmed) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
        padding: 'var(--space-3)', borderRadius: 8,
        background: 'color-mix(in srgb, var(--success) 8%, transparent)',
        border: '1px solid color-mix(in srgb, var(--success) 20%, transparent)',
      }}>
        <span>🔒</span>
        <span style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--success)' }}>
          Offer Confirmed — locked for production
        </span>
      </div>
    )
  }

  return (
    <button
      onClick={handleConfirm}
      disabled={loading}
      className="btn-primary"
      style={{ width: '100%', justifyContent: 'center' }}
    >
      {loading ? 'Confirming…' : '✓ Confirm Offer — Lock for Production'}
    </button>
  )
}
