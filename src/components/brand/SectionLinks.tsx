'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { addAssetLink, removeAssetLink } from '@/lib/brands/portal-actions'
import type { AssetLink } from './IntakePanel'

// Brand kit: the shared links (Drive folder, Canva, Dropbox) that hold one kind
// of file, shown as chips right above that kind's uploads, with "+ Add link"
// beside them. Same brand_asset_links rows the intake card reads, so a link
// added here also ticks that item off the intake checklist.

export default function SectionLinks({ brandId, kind, links }: { brandId: string; kind: string; links: AssetLink[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const [pending, start] = useTransition()
  const mine = links.filter(l => l.covers?.includes(kind))

  function save() {
    start(async () => {
      const r = await addAssetLink(brandId, url, [kind], note)
      if (!r.ok) { setErr(r.error); return }
      setUrl(''); setNote(''); setErr(''); setOpen(false)
      router.refresh()
    })
  }
  function remove(id: string) {
    if (!window.confirm('Remove this link?')) return
    start(async () => { const r = await removeAssetLink(id, brandId); if (!r.ok) setErr(r.error); else router.refresh() })
  }

  return (
    <div className="bk-links">
      {mine.map(l => (
        <span key={l.id} className="bk-chip">
          <span aria-hidden>📁</span>
          <a href={l.url} target="_blank" rel="noreferrer" title={l.url}>{linkName(l.url)} ↗</a>
          {(l.note || l.added_by) && <em>{[l.note, l.added_by].filter(Boolean).join(' · ')}</em>}
          <button onClick={() => remove(l.id)} disabled={pending} aria-label="Remove link">✕</button>
        </span>
      ))}
      {open ? (
        <div className="bk-addlink">
          <input type="url" autoFocus placeholder="https://drive.google.com/… (folder, Canva, Dropbox)" value={url} onChange={e => setUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') save() }} />
          <input type="text" placeholder="Note (optional), e.g. new logo Nov 2026" value={note} onChange={e => setNote(e.target.value)} style={{ maxWidth: 260 }} />
          <button className="btn-primary" style={{ fontSize: 13 }} disabled={pending || !url.trim()} onClick={save}>Save link</button>
          <button className="bp-link bp-link-muted" style={{ fontSize: 13 }} onClick={() => { setOpen(false); setErr('') }}>Cancel</button>
        </div>
      ) : (
        <button className="bp-link" style={{ fontSize: 12.5 }} onClick={() => setOpen(true)}>+ Add link</button>
      )}
      {err && <p className="mo-error" style={{ width: '100%' }}>{err}</p>}
    </div>
  )
}

function linkName(url: string): string {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '')
    if (h.includes('drive.google')) return 'Google Drive'
    if (h.includes('docs.google')) return 'Google Docs'
    if (h.includes('dropbox')) return 'Dropbox'
    if (h.includes('canva')) return 'Canva'
    if (h.includes('figma')) return 'Figma'
    if (h.includes('slack')) return 'Slack file'
    return h
  } catch { return url.slice(0, 40) }
}
