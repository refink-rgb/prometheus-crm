'use client'

import { useState } from 'react'
import { generateClientToken } from '@/lib/actions'

export default function ClientPortalButton({
  brandId,
  initialToken,
}: {
  brandId: string
  initialToken: string | null
}) {
  const [token, setToken] = useState(initialToken)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const portalUrl = token
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/portal/${token}`
    : null

  async function handleGenerate() {
    setLoading(true)
    try {
      const t = await generateClientToken(brandId)
      setToken(t)
    } finally {
      setLoading(false)
    }
  }

  async function handleCopy() {
    if (!portalUrl) return
    await navigator.clipboard.writeText(portalUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!token) {
    return (
      <button
        onClick={handleGenerate}
        disabled={loading}
        className="btn-secondary"
        style={{ fontSize: 13 }}
      >
        {loading ? 'Generating...' : '🔗 Generate Client Portal Link'}
      </button>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px',
        background: 'var(--surface-raised)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        fontSize: 12,
        color: 'var(--text-muted)',
        wordBreak: 'break-all',
      }}>
        <span style={{ flex: 1 }}>{portalUrl}</span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={handleCopy}
          className="btn-secondary"
          style={{ fontSize: 12, flex: 1 }}
        >
          {copied ? '✓ Copied!' : 'Copy Link'}
        </button>
        <button
          onClick={handleGenerate}
          disabled={loading}
          style={{
            fontSize: 12,
            background: 'transparent',
            color: 'var(--text-muted)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '6px 12px',
            cursor: 'pointer',
          }}
        >
          {loading ? '...' : 'Regenerate'}
        </button>
      </div>
    </div>
  )
}
