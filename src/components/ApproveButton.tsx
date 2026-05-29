'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { approveProject } from '@/lib/actions'

export default function ApproveButton({ token }: { token: string }) {
  const router = useRouter()
  const [approving, setApproving] = useState(false)

  async function handleApprove() {
    if (!confirm('Approve this project? This confirms you\'ve reviewed the deliverables and are satisfied.')) return
    setApproving(true)
    try {
      await approveProject(token)
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
      style={{ fontSize: 15, padding: '12px 28px', justifyContent: 'center' }}
    >
      {approving ? 'Approving…' : '✓ Approve this project'}
    </button>
  )
}
