'use client'

import { useState } from 'react'

// The link a strategist sends when an offer goes to the client. It is the
// brand's existing client_token, so there is nothing to mint here — a brand
// without one gets pointed at the generator on its own page instead.

export default function ClientOfferLink({
  brandId,
  clientToken,
}: {
  brandId: string
  clientToken: string | null
}) {
  const [copied, setCopied] = useState(false)

  if (!clientToken) {
    return (
      <div style={box}>
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
          This brand has no client link yet.
        </span>
        <a
          href={`/brands/${brandId}`}
          className="btn-secondary"
          style={{ fontSize: 'var(--text-sm)', textDecoration: 'none', whiteSpace: 'nowrap', marginLeft: 'auto' }}
        >
          Generate on brand page →
        </a>
      </div>
    )
  }

  const path = `/offer-approval/${clientToken}`

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard can be blocked; the path is selectable in the row itself.
    }
  }

  return (
    <div style={box}>
      <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
        Client approval link
      </span>
      <code style={{
        fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        flex: 1, minWidth: 100,
      }}>
        {path}
      </code>
      <a
        href={path}
        target="_blank"
        rel="noreferrer"
        className="btn-secondary"
        style={{ fontSize: 'var(--text-sm)', textDecoration: 'none', whiteSpace: 'nowrap' }}
      >
        Preview
      </a>
      <button type="button" onClick={copy} className="btn-accent-outline btn-sm" style={{ whiteSpace: 'nowrap' }}>
        {copied ? '✓ Copied' : 'Copy link'}
      </button>
    </div>
  )
}

const box: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
  background: 'var(--surface-2)', border: '1px solid var(--border)',
  borderRadius: 10, padding: '10px 14px', marginBottom: 16,
}
