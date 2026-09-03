'use client'

import { useState } from 'react'
import { Link2, Check, RotateCcw } from 'lucide-react'
import { generateShareToken } from '@/lib/actions'

export default function ShareButton({
  projectId,
  initialToken,
}: {
  projectId: string
  initialToken: string | null
}) {
  const [token, setToken] = useState(initialToken)
  const [generating, setGenerating] = useState(false)
  const [copied, setCopied] = useState(false)

  const url = token ? `${typeof window !== 'undefined' ? window.location.origin : ''}/review/${token}` : null

  async function generate() {
    setGenerating(true)
    try {
      const t = await generateShareToken(projectId)
      setToken(t)
    } finally {
      setGenerating(false)
    }
  }

  async function copy() {
    if (!url) return
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  if (!token) {
    return (
      <button
        onClick={generate}
        disabled={generating}
        className="btn-secondary"
        style={{ fontSize: 13 }}
      >
        {generating ? 'Generating…' : <><Link2 size={14} strokeWidth={2} aria-hidden /> Generate client link</>}
      </button>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{
          flex: 1,
          background: 'var(--surface-raised)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '8px 12px',
          fontSize: 12,
          color: 'var(--text-muted)',
          fontFamily: 'monospace',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          userSelect: 'all',
        }}>
          {url}
        </div>
        <button
          onClick={copy}
          className="btn-primary"
          style={{ fontSize: 13, flexShrink: 0, padding: '8px 16px' }}
        >
          {copied ? <><Check size={14} strokeWidth={2} aria-hidden /> Copied</> : 'Copy link'}
        </button>
      </div>
      <button
        onClick={generate}
        disabled={generating}
        style={{
          background: 'none',
          border: 'none',
          fontSize: 12,
          color: 'var(--text-muted)',
          cursor: 'pointer',
          textAlign: 'left',
          padding: 0,
        }}
      >
        {generating ? 'Regenerating…' : <><RotateCcw size={12} strokeWidth={2} aria-hidden style={{ verticalAlign: '-2px', marginRight: 4 }} />Regenerate link (invalidates old one)</>}
      </button>
    </div>
  )
}
