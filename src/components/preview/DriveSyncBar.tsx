'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { syncDriveImages } from '@/lib/actions'

// Where creatives come into a project.
//
// This is the FIRST thing an editor does — nothing else on the tab works until
// the folder is synced — and it was living behind a disclosure labelled "Manage
// assets & Drive sync" inside the last card on the page. Being tidy is worth
// nothing on the one control that gates everything after it.
//
// Prominence follows state: unset, it is a dashed accent panel that explains
// itself; set, it is one quiet line with a re-sync. A permanent loud box on a
// project that is already synced would be the same mistake in reverse.

export default function DriveSyncBar({
  projectId, brandId, folderUrl, assetCount,
}: {
  projectId: string
  brandId: string
  folderUrl: string | null
  assetCount: number
}) {
  const router = useRouter()
  const [url, setUrl] = useState(folderUrl ?? '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [editing, setEditing] = useState(false)

  async function sync() {
    const u = url.trim()
    if (!u) { setErr('Paste a link first.'); return }
    if (!/^https?:\/\//i.test(u)) { setErr('That is not a link — it should start with https://'); return }
    setBusy(true); setErr(''); setMsg('')
    try {
      const n = await syncDriveImages(projectId, brandId, u)
      setMsg(`Synced ${n} image${n === 1 ? '' : 's'}.`)
      setEditing(false)
      router.refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not sync that folder.')
    } finally {
      setBusy(false)
    }
  }

  const linked = !!folderUrl && !editing

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      padding: linked ? '10px 14px' : '14px 16px', marginBottom: 20, borderRadius: 10,
      border: linked ? '1px solid var(--border)' : '1px dashed var(--accent)',
      background: linked ? 'var(--surface-1)' : 'var(--accent-muted)',
    }}>
      {linked ? (
        <>
          <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>Final output</span>
          <a href={folderUrl!} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: 'var(--accent)' }}>Open ↗</a>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            {assetCount} synced
          </span>
          <button onClick={sync} disabled={busy} style={btn}>{busy ? 'Syncing…' : '⟳ Re-sync'}</button>
          <button onClick={() => setEditing(true)} disabled={busy} style={{ ...btn, border: 'none', color: 'var(--text-muted)' }}>Change folder</button>
        </>
      ) : (
        <>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700 }}>Paste your Drive folder link</div>

          </div>
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void sync() }}
            placeholder="https://drive.google.com/drive/folders/…"
            style={{
              flex: 1, minWidth: 260, fontSize: 12.5, padding: '8px 10px', borderRadius: 7,
              border: '1px solid var(--border-strong)', background: 'var(--surface-2)', color: 'var(--text-primary)',
            }}
          />
          <button onClick={sync} disabled={busy} style={{ ...btn, borderColor: 'var(--accent)', color: 'var(--accent)', fontWeight: 700 }}>
            {busy ? 'Syncing…' : 'Link & sync'}
          </button>
          {folderUrl && (
            <button onClick={() => { setUrl(folderUrl); setEditing(false); setErr('') }} disabled={busy} style={{ ...btn, border: 'none', color: 'var(--text-muted)' }}>Cancel</button>
          )}
        </>
      )}

      {msg && <span style={{ fontSize: 11.5, color: 'var(--success)', width: '100%' }}>{msg}</span>}
      {err && <span style={{ fontSize: 11.5, color: 'var(--danger)', width: '100%' }}>{err}</span>}
    </div>
  )
}

const btn: React.CSSProperties = {
  fontSize: 11.5, fontWeight: 600, padding: '6px 12px', borderRadius: 7, cursor: 'pointer',
  border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)',
  flexShrink: 0,
}
