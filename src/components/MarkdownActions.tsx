'use client'

import CopyMarkdownButton from './CopyMarkdownButton'

function safeFilename(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${cleaned || 'prometheus-export'}.md`
}

/** Clipboard copy plus a real .md download for offer workspaces and libraries. */
export default function MarkdownActions({
  markdown,
  filename,
  copyLabel = 'Copy Markdown',
  style,
}: {
  markdown: string | (() => string)
  filename: string
  copyLabel?: string
  style?: React.CSSProperties
}) {
  function download() {
    const text = typeof markdown === 'function' ? markdown() : markdown
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = safeFilename(filename.replace(/\.md$/i, ''))
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, ...style }}>
      <CopyMarkdownButton markdown={markdown} label={copyLabel} />
      <button
        type="button"
        className="btn-secondary"
        onClick={download}
        title="Download this view as a Markdown file"
        style={{ fontSize: 'var(--text-sm)', whiteSpace: 'nowrap' }}
      >
        ↓ Download .md
      </button>
    </div>
  )
}
