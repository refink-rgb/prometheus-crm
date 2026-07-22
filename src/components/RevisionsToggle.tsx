'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toggleProjectRevisions } from '@/lib/actions'

export default function RevisionsToggle({
  projectId,
  brandId,
  currentValue,
}: {
  projectId: string
  brandId: string
  currentValue: boolean
}) {
  const router = useRouter()
  const [active, setActive] = useState(currentValue)
  const [loading, setLoading] = useState(false)

  async function toggle() {
    setLoading(true)
    try {
      await toggleProjectRevisions(projectId, brandId, !active)
      setActive(!active)
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={loading}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 14px',
        borderRadius: 8,
        border: `1px solid ${active ? 'color-mix(in srgb, var(--accent) 40%, transparent)' : 'var(--border)'}`,
        background: active ? 'var(--accent-muted)' : 'var(--surface-raised)',
        color: active ? 'var(--warning)' : 'var(--text-muted)',
        fontSize: 13,
        fontWeight: 600,
        cursor: loading ? 'wait' : 'pointer',
        transition: 'all 0.15s',
      }}
    >
      <span style={{ fontSize: 15 }}>{active ? '↩' : '✓'}</span>
      {loading ? 'Updating…' : active ? 'Revisions needed — click to clear' : 'Mark as needs revisions'}
    </button>
  )
}
