'use client'

import { useState } from 'react'

// The project's searchable code, sitting under its name with a copy button.
//
// Copy, never retype. One wrong character and the moment silently disappears
// from every report built on it — and unlike a broken link, nothing errors.

export default function MomentCodeChip({ code, compact = false }: { code: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false)

  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(code)
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        } catch { /* clipboard blocked — the code is on screen to read */ }
      }}
      title="Copy — paste this into the ad set name and every ad name in Meta"
      aria-label={`Copy moment code ${code}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7,
        padding: compact ? '2px 7px' : '3px 9px', borderRadius: compact ? 6 : 7, cursor: 'pointer',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: compact ? 10.5 : 12, fontWeight: 700, letterSpacing: '0.02em',
        border: `1px solid ${copied ? 'var(--success)' : 'var(--border-strong)'}`,
        background: copied ? 'color-mix(in srgb, var(--success) 12%, transparent)' : 'var(--surface-2)',
        color: copied ? 'var(--success)' : 'var(--text-primary)',
        transition: 'border-color 0.12s, background 0.12s, color 0.12s',
      }}
    >
      {code}
      <span style={{ fontSize: compact ? 9 : 10, fontWeight: 600, opacity: 0.7 }}>{copied ? 'copied' : 'copy'}</span>
    </button>
  )
}
