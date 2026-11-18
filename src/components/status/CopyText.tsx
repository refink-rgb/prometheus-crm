'use client'

// A button that copies a fixed piece of text: a website URL, or the prompt a
// strategist pastes into an AI agent.

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

export default function CopyText({
  text,
  label,
  primary = false,
  ariaLabel,
  fallbackHref,
}: {
  text: string
  label: string
  primary?: boolean
  /** What the button does, in full, where the label alone is too short. */
  ariaLabel?: string
  /** A page that shows the same text, offered when the clipboard is blocked. */
  fallbackHref?: string
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
    setTimeout(() => setState('idle'), fallbackHref ? 8000 : 2500)
  }

  // Nothing on a row to select by hand, so a blocked clipboard gets a link to
  // the page that shows the text.
  if (state === 'failed' && fallbackHref) {
    return (
      <a href={fallbackHref} className="btn-secondary btn-sm" style={{ whiteSpace: 'nowrap', textDecoration: 'none' }}>
        Could not copy. Open it instead
      </a>
    )
  }

  return (
    <button
      type="button"
      className={primary ? 'btn-primary' : 'btn-secondary btn-sm'}
      onClick={() => void copy()}
      aria-label={state === 'idle' ? ariaLabel : undefined}
      style={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6 }}
    >
      {state === 'copied' ? <Check size={primary ? 14 : 12} aria-hidden /> : <Copy size={primary ? 14 : 12} aria-hidden />}
      <span aria-live="polite">
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Could not copy. Select the text instead.' : label}
      </span>
    </button>
  )
}
