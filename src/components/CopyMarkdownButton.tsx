'use client'

import { useState } from 'react'

/**
 * Copy a block of markdown to the clipboard.
 *
 * `markdown` may be a string or a getter. The getter form matters for views
 * whose content changes with on-screen state (the pipeline table's filters):
 * building the text at click time keeps the copy in step with what the user is
 * looking at, instead of with what was on screen at mount.
 */
export default function CopyMarkdownButton({
  markdown,
  label = 'Copy as Markdown',
  title,
  style,
}: {
  markdown: string | (() => string)
  label?: string
  title?: string
  style?: React.CSSProperties
}) {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)

  async function copy() {
    const text = typeof markdown === 'function' ? markdown() : markdown
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setFailed(false)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard access can be refused (insecure origin, denied permission).
      // Say so rather than showing a success state for a copy that never landed.
      setFailed(true)
      setTimeout(() => setFailed(false), 2500)
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="btn-secondary"
      title={title ?? 'Copy every filled-in field as markdown'}
      style={{ fontSize: 'var(--text-sm)', whiteSpace: 'nowrap', ...style }}
    >
      {failed ? 'Copy failed' : copied ? 'Copied ✓' : `⧉ ${label}`}
    </button>
  )
}
