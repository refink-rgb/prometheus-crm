'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createIntakeLink } from '@/lib/brands/intake-actions'
import { addAssetLink, removeAssetLink } from '@/lib/brands/portal-actions'
import { LINKABLE, type IntakeItem } from '@/lib/brands/intake'
import './brand.css'

// Top of the brand page: what the makers still don't have from the client, and
// the one link that asks the client for it.

export default function IntakePanel({
  brandId, brandName, token, items, submittedAt, updatedAt, canEdit, links = [],
}: {
  brandId: string
  brandName: string
  token: string | null
  items: IntakeItem[]
  submittedAt: string | null
  updatedAt: string | null
  canEdit: boolean
  links?: AssetLink[]
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
            <li key={i.key} className={i.linked ? 'linked' : i.done ? 'ok' : 'miss'}>
              <span aria-hidden>{i.linked ? '↗' : i.done ? '✓' : '○'}</span>
              <b>{i.label}</b>
              {i.note && <em>{i.note}</em>}
            </li>
          ))}
        </ul>
        <AssetLinks brandId={brandId} links={links} canEdit={canEdit} toFile={items.filter(i => i.linked).map(i => i.label)} />
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

export type AssetLink = { id: string; url: string; covers: string[]; note: string | null; added_by: string | null; created_at: string }

/** Links that hold brand files we haven't filed yet. The client isn't asked
 *  for what a link covers; the team still owes the upload. */
function AssetLinks({ brandId, links, canEdit, toFile }: { brandId: string; links: AssetLink[]; canEdit: boolean; toFile: string[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [note, setNote] = useState('')
  const [covers, setCovers] = useState<string[]>([])
  const [err, setErr] = useState('')
  const [pending, start] = useTransition()
  const label = (k: string) => LINKABLE.find(l => l.k === k)?.label ?? k

  function save() {
    start(async () => {
      const r = await addAssetLink(brandId, url, covers, note)
      if (!r.ok) { setErr(r.error); return }
      setUrl(''); setNote(''); setCovers([]); setErr(''); setOpen(false)
      router.refresh()
    })
  }
  function remove(id: string) {
    if (!window.confirm('Remove this link? Anything it covered shows as missing again.')) return
    start(async () => { const r = await removeAssetLink(id, brandId); if (!r.ok) setErr(r.error); else router.refresh() })
  }

  if (!links.length && !canEdit) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {toFile.length > 0 && (
        <div className="bp-warn">↗ We have these in a link, not filed yet: {toFile.join(', ')}. Upload them under Documents so makers have the files.</div>
      )}
      {links.length > 0 && (
        <ul className="al-list">
          {links.map(l => (
            <li key={l.id}>
              <a href={l.url} target="_blank" rel="noreferrer">{l.url.replace(/^https?:\/\//, '').slice(0, 60)}</a>
              <em>{l.covers.map(label).join(', ')}{l.note ? ` · ${l.note}` : ''}{l.added_by ? ` · ${l.added_by}` : ''}</em>
              {canEdit && <button className="bp-link bp-link-muted" style={{ fontSize: 12.5 }} disabled={pending} onClick={() => remove(l.id)}>Remove</button>}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (open ? (
        <div className="al-form">
          <input type="url" placeholder="https://drive.google.com/… (folder, Canva, Slack file)" value={url} onChange={e => setUrl(e.target.value)} />
          <div className="al-kinds" role="group" aria-label="What the link holds">
            {LINKABLE.map(l => (
              <label key={l.k}>
                <input type="checkbox" checked={covers.includes(l.k)}
                  onChange={e => setCovers(c => e.target.checked ? [...c, l.k] : c.filter(x => x !== l.k))} />
                {l.label}
              </label>
            ))}
          </div>
          <input type="text" placeholder="Note (optional), e.g. sent in Slack 12 Jun" value={note} onChange={e => setNote(e.target.value)} />
          <div className="bp-actions">
            <button className="btn-primary" style={{ fontSize: 13 }} disabled={pending} onClick={save}>Save link</button>
            <button className="bp-link bp-link-muted" style={{ fontSize: 13 }} onClick={() => setOpen(false)}>Cancel</button>
          </div>
          {err && <p className="mo-error">{err}</p>}
        </div>
      ) : (
        <button className="bp-link" style={{ fontSize: 13, alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>+ We have files in a link</button>
      ))}
    </div>
  )
}
