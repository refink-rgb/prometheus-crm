'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { approveProject } from '@/lib/actions'

export default function ApproveButton({
  token,
  track,
  label,
}: {
  token: string
  track: 'lp' | 'creatives'
  label: string
}) {
  const router = useRouter()
  const [approving, setApproving] = useState(false)

  async function handleApprove() {
    if (!confirm(`Approve the ${label}? This confirms you've reviewed it and are satisfied.`)) return
    setApproving(true)
    try {
      await approveProject(token, track)
      router.refresh()
    } finally {
      setApproving(false)
    }
  }

  return (
    <button
      onClick={handleApprove}
      disabled={approving}
      className="btn-primary"
      style={{ fontSize: 14, padding: '10px 22px' }}
    >
      {approving ? 'Approving…' : `✓ Approve ${label}`}
    </button>
  )
}
