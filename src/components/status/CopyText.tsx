'use client'

// A button that copies a fixed piece of text: a website URL, or the brief a
// strategist pastes into an AI agent.

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

export default function CopyText({
  text,
  label,
  primary = false,
}: {
  text: string
  label: string
  primary?: boolean
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      // Clipboard can be blocked (an embedded browser, no permission).
      setState('failed')
    }
    setTimeout(() => setState('idle'), 2500)
  }

  return (
    <button
      type="button"
      className={primary ? 'btn-primary' : 'btn-secondary btn-sm'}
      onClick={() => void copy()}
      style={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6 }}
    >
      {state === 'copied' ? <Check size={primary ? 14 : 12} aria-hidden /> : <Copy size={primary ? 14 : 12} aria-hidden />}
      <span aria-live="polite">
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Could not copy. Select the text instead.' : label}
      </span>
    </button>
  )
}
