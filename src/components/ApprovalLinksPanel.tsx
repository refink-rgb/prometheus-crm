'use client'

import { useState } from 'react'

// Where the team gets each profit engineer's links. Two per engineer, both
// permanent:
//   approval link — their offer queue; anyone holding it can approve.
//   status link   — read-only board of their brands' projects, with the
//                   client-approved files to download. Safe to forward: it
//                   cannot be turned back into the approval link.

export interface EngineerLink {
  name: string
  token: string
  /** Token for the read-only /status board (derived from the approval token). */
  statusToken: string
  /** Offers currently in Internal Review on this engineer's brands. */
  waiting: number
}

export default function ApprovalLinksPanel({ engineers }: { engineers: EngineerLink[] }) {
  const [copied, setCopied] = useState<string | null>(null)

  async function copy(path: string, key: string) {
    const url = `${window.location.origin}${path}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(key)
      setTimeout(() => setCopied(current => (current === key ? null : current)), 2000)
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
        approve, so treat it like the client review link. The status link is read-only:
        where every project on their brands stands, plus the client-approved files.
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
            onClick={() => copy(`/approvals/${engineer.token}`, engineer.name)}
            className="btn-accent-outline btn-sm"
            style={{ whiteSpace: 'nowrap' }}
          >
            {copied === engineer.name ? '✓ Copied' : 'Copy link'}
          </button>
          <a
            href={`/status/${engineer.statusToken}`}
            target="_blank"
            rel="noreferrer"
            className="btn-secondary"
            style={{ fontSize: 'var(--text-sm)', whiteSpace: 'nowrap', textDecoration: 'none' }}
          >
            Open status
          </a>
          <button
            type="button"
            onClick={() => copy(`/status/${engineer.statusToken}`, `${engineer.name}:status`)}
            className="btn-accent-outline btn-sm"
            style={{ whiteSpace: 'nowrap' }}
          >
            {copied === `${engineer.name}:status` ? '✓ Copied' : 'Copy status link'}
          </button>
        </div>
      ))}
    </div>
  )
}
