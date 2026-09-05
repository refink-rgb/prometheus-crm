'use client'

import { useState } from 'react'

// Where the team gets each profit engineer's approval link. One link per
// engineer, permanent — the queue behind it is computed per request, so a new
// offer entering Internal Review shows up without reissuing anything.

export interface EngineerLink {
  name: string
  token: string
  /** Offers currently in Internal Review on this engineer's brands. */
  waiting: number
}

export default function ApprovalLinksPanel({ engineers }: { engineers: EngineerLink[] }) {
  const [copied, setCopied] = useState<string | null>(null)

  async function copy(token: string, name: string) {
    const url = `${window.location.origin}/approvals/${token}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(name)
      setTimeout(() => setCopied(current => (current === name ? null : current)), 2000)
    } catch {
      // Clipboard can be blocked; the link is selectable in the row itself.
    }
  }

  if (engineers.length === 0) {
    return (
      <p style={{ fontSize: 'var(--text-base)', color: 'var(--text-muted)', padding: '16px 0' }}>
        No profit engineers yet. Add one on a brand page, then their approval link appears here.
      </p>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 4 }}>
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginBottom: 4 }}>
        Send each engineer their own link. It stays valid — anything of theirs that
        reaches internal review appears there automatically. Anyone with the link can
        approve, so treat it like the client review link.
      </p>
      {engineers.map(engineer => (
        <div
          key={engineer.name}
          style={{
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '10px 14px',
          }}
        >
          <span style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)' }}>
            {engineer.name}
          </span>
          <span style={{
            fontSize: 'var(--text-2xs)', fontWeight: 700, borderRadius: 20, padding: '2px 8px',
            color: engineer.waiting > 0 ? 'var(--stage-internal-text)' : 'var(--text-muted)',
            background: engineer.waiting > 0 ? 'var(--stage-internal-bg)' : 'transparent',
            border: `1px solid ${engineer.waiting > 0 ? 'var(--stage-internal)' : 'var(--border)'}`,
          }}>
            {engineer.waiting} awaiting
          </span>
          <code style={{
            fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            flex: 1, minWidth: 120,
          }}>
            /approvals/{engineer.token}
          </code>
          <a
            href={`/approvals/${engineer.token}`}
            target="_blank"
            rel="noreferrer"
            className="btn-secondary"
            style={{ fontSize: 'var(--text-sm)', whiteSpace: 'nowrap', textDecoration: 'none' }}
          >
            Open
          </a>
          <button
            type="button"
            onClick={() => copy(engineer.token, engineer.name)}
            className="btn-accent-outline btn-sm"
            style={{ whiteSpace: 'nowrap' }}
          >
            {copied === engineer.name ? '✓ Copied' : 'Copy link'}
          </button>
        </div>
      ))}
    </div>
  )
}
