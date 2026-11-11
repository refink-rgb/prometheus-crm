'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createIntakeLink } from '@/lib/brands/intake-actions'
import type { IntakeItem } from '@/lib/brands/intake'
import './brand.css'

// Top of the brand page: what the makers still don't have from the client, and
// the one link that asks the client for it.

export default function IntakePanel({
  brandId, brandName, token, items, submittedAt, updatedAt, canEdit,
}: {
  brandId: string
  brandName: string
  token: string | null
  items: IntakeItem[]
  submittedAt: string | null
  updatedAt: string | null
  canEdit: boolean
}) {
  const router = useRouter()
  const [t, setT] = useState(token)
  const [copied, setCopied] = useState(false)
  const [err, setErr] = useState('')
  const [pending, start] = useTransition()
  const missing = items.filter(i => !i.done)
  const url = t ? `${typeof window !== 'undefined' ? window.location.origin : ''}/intake/${t}` : null

  function make(rotate: boolean) {
    if (rotate && !window.confirm('Make a new link? The old one stops working, so resend the new one to the client.')) return
    start(async () => {
      const r = await createIntakeLink(brandId)
      if (!r.ok) { setErr(r.error); return }
      setT(r.token)
      setErr('')
      await copy(`${window.location.origin}/intake/${r.token}`)
      router.refresh()
    })
  }

  async function copy(u = url) {
    if (!u) return
    try { await navigator.clipboard.writeText(u); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* shown in the box anyway */ }
  }

  const when = (iso: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))

  return (
    <section className="mo-panel" aria-label="Client intake">
      <div className="bp-card-head">
        <div>
          <h2 className="mo-h2">
            Client intake <span className="mo-count">· {items.length - missing.length}/{items.length}</span>
          </h2>
          <p className="bp-purpose">
            {missing.length === 0
              ? `Makers have everything they need from ${brandName}.`
              : `What makers need from ${brandName} before they start.`}
            {submittedAt ? ` Client sent the form ${when(submittedAt)}.` : updatedAt ? ` Client started the form ${when(updatedAt)}, not sent yet.` : t ? ' Link not opened yet.' : ''}
          </p>
        </div>
      </div>
      <div className="bp-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <ul className="ik-check">
          {items.map(i => (
            <li key={i.key} className={i.done ? 'ok' : 'miss'}>
              <span aria-hidden>{i.done ? '✓' : '○'}</span>
              <b>{i.label}</b>
              {i.note && <em>{i.note}</em>}
            </li>
          ))}
        </ul>
        {canEdit && (
          <div className="ik-linkbox">
            {url ? (
              <>
                <code title={url}>{url}</code>
                <div className="bp-actions">
                  <button className="btn-primary" style={{ fontSize: 13.5 }} onClick={() => copy()}>{copied ? '✓ Copied' : 'Copy intake link'}</button>
                  <a className="bp-link" href={url} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>Open as client ↗</a>
                  <button className="bp-link bp-link-muted" style={{ fontSize: 13 }} disabled={pending} onClick={() => make(true)}>New link</button>
                </div>
              </>
            ) : (
              <button className="btn-primary" style={{ fontSize: 13.5, alignSelf: 'flex-start' }} disabled={pending} onClick={() => make(false)}>
                {pending ? 'Creating…' : 'Create intake link for the client'}
              </button>
            )}
            <p className="bp-hint" style={{ margin: 0 }}>
              One link for the client: they upload logos, product images, fonts and the brand book, and answer the AI, copy, offer and contact questions. Answers land on this page.
            </p>
            {err && <p className="mo-error">{err}</p>}
          </div>
        )}
      </div>
    </section>
  )
}

/** Compact version for job and project pages: only what is missing. */
export function IntakeMissing({ brandId, brandName, items }: { brandId: string; brandName: string; items: IntakeItem[] }) {
  const missing = items.filter(i => !i.done)
  if (missing.length === 0) return null
  return (
    <div className="ik-missing" role="note">
      <b>Missing from {brandName}:</b> {missing.map(i => i.label).join(', ')}.{' '}
      <a href={`/brands/${brandId}`}>Brand page →</a>
    </div>
  )
}
