'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateProjectLists, proposeProjectProducts, uploadProductImage } from '@/lib/actions'
import type { ProjectProduct } from '@/lib/types'

// Products, grouped into bundles or tiers.
//
// The group is a label on each row rather than a nested structure, so a product
// is never orphaned by a bad group and moving one between bundles is a single
// edit. This component only ever presents them grouped.
//
// The AI proposal loads into this editor UNSAVED. Nothing a model produced
// reaches the database without someone reading it and pressing Save.

type Row = ProjectProduct & { _key: string; _gid: string }

const newKey = () => globalThis.crypto?.randomUUID?.() ?? `k-${Math.random().toString(36).slice(2)}`
const isLink = (v: string | null) => !v?.trim() || /^https?:\/\//i.test(v.trim())

function ImageCell({
  value, projectId, onChange,
}: {
  value: string | null
  projectId: string
  onChange: (url: string | null) => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function send(file: File | null | undefined) {
    if (!file) return
    setBusy(true); setErr('')
    try {
      const fd = new FormData()
      fd.append('file', file); fd.append('project_id', projectId)
      const r = await uploadProductImage(fd)
      if (r.ok) onChange(r.url); else setErr(r.error)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed.')
    } finally { setBusy(false) }
  }

  const fromClipboard = (e: React.ClipboardEvent) => {
    const item = [...e.clipboardData.items].find(i => i.type.startsWith('image/'))
    if (!item) return
    e.preventDefault()
    void send(item.getAsFile())
  }

  return (
    <div style={{ position: 'relative' }}>
      <label
        tabIndex={0}
        onPaste={fromClipboard}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); void send(e.dataTransfer.files?.[0]) }}
        title="Click to choose, or paste a screenshot"
        style={{
          textTransform: 'none', letterSpacing: 0,
          display: 'grid', placeItems: 'center', width: 44, height: 44, flexShrink: 0,
          borderRadius: 6, cursor: busy ? 'wait' : 'pointer', overflow: 'hidden',
          background: 'var(--surface-2)',
          border: `1px ${value ? 'solid' : 'dashed'} var(--border)`,
        }}
      >
        <input
          type="file" accept="image/*" disabled={busy} style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; void send(f) }}
        />
        {busy
          ? <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>…</span>
          : value
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={value} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            : <span style={{ fontSize: 15, color: 'var(--text-muted)' }}>＋</span>}
      </label>
      {value && !busy && (
        <button
          onClick={() => onChange(null)}
          title="Remove image"
          style={{ position: 'absolute', top: -6, right: -6, width: 16, height: 16, borderRadius: '50%', fontSize: 9, lineHeight: 1, border: '1px solid var(--border)', background: 'var(--surface-raised)', color: 'var(--text-secondary)', cursor: 'pointer' }}
        >✕</button>
      )}
      {err && <div style={{ position: 'absolute', top: 46, left: 0, whiteSpace: 'nowrap', fontSize: 10, color: 'var(--danger)' }}>{err}</div>}
    </div>
  )
}

export default function ProductGroupEditor({
  projectId, brandId, initial, onDone,
}: {
  projectId: string
  brandId: string
  initial: ProjectProduct[]
  onDone: () => void
}) {
  const router = useRouter()
  // Rows arriving from the server carry only a group NAME. Map each distinct
  // name to one stable id up front; from then on the id is identity and the name
  // is just a label that can be edited freely.
  const [rows, setRows] = useState<Row[]>(() => {
    const ids = new Map<string, string>()
    return initial.map(p => {
      const name = p.group ?? ''
      if (!ids.has(name)) ids.set(name, newKey())
      return { ...p, _key: newKey(), _gid: ids.get(name)! }
    })
  })
  const [pending, startTransition] = useTransition()
  const [proposing, setProposing] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')

  // Group order follows first appearance, so reordering rows reorders groups.
  // Keyed by _gid, so two groups may share a name mid-edit without merging.
  const groups: { gid: string; name: string }[] = []
  for (const r of rows) {
    if (!groups.some(g => g.gid === r._gid)) groups.push({ gid: r._gid, name: r.group ?? '' })
  }
  if (!groups.length) groups.push({ gid: 'g0', name: '' })

  const set = (key: string, field: keyof ProjectProduct, v: string) =>
    setRows(prev => prev.map(r => (r._key === key ? { ...r, [field]: v } : r)))

  const addTo = (gid: string, name: string) =>
    setRows(prev => [...prev, { _key: newKey(), _gid: gid, id: '', name: '', url: null, assets_url: null, group: name || null, image_url: null }])

  // Renames by ID, so a name that transiently matches another group no longer
  // swallows it.
  const renameGroup = (gid: string, to: string) =>
    setRows(prev => prev.map(r => (r._gid === gid ? { ...r, group: to || null } : r)))

  const bad = rows.some(r => !isLink(r.url) || !isLink(r.assets_url))

  function save() {
    if (bad) { setErr('Links must start with http:// or https://'); return }
    setErr('')
    startTransition(async () => {
      try {
        await updateProjectLists(projectId, brandId, {
          products: rows.filter(r => r.name.trim()).map(r => ({
            id: r.id || undefined, name: r.name, url: r.url, assets_url: r.assets_url, group: r.group, image_url: r.image_url,
          })),
        })
        router.refresh()
        onDone()
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Could not save.')
      }
    })
  }

  async function propose() {
    setProposing(true); setErr(''); setNote('')
    try {
      const r = await proposeProjectProducts(projectId)
      if (!r.ok) { setErr(r.error); return }
      // MERGE, do not replace. The old version threw away every curated
      // product link, HQ assets link and stable id, keeping only images and only
      // by exact name match — twenty minutes of link-entry gone because someone
      // re-read the brief to pick up one new SKU.
      //
      // Matching is by normalised name. A product the model names again keeps
      // everything it already had and takes only its group; a product it does
      // not mention is KEPT, not deleted — the model missing something is not
      // evidence the product is gone.
      const norm = (v: string) => v.trim().toLowerCase()
      const existing = new Map(rows.map(r => [norm(r.name), r]))
      const gids = new Map<string, string>()
      for (const r of rows) if (!gids.has(r.group ?? '')) gids.set(r.group ?? '', r._gid)

      let added = 0
      const merged: Row[] = r.products.map(pr => {
        const prev = existing.get(norm(pr.name))
        const groupName = pr.group ?? ''
        if (!gids.has(groupName)) gids.set(groupName, newKey())
        if (prev) {
          existing.delete(norm(pr.name))
          // Only the group moves. url/assets_url/image_url/id are whatever a
          // person put there.
          return { ...prev, group: pr.group, _gid: gids.get(groupName)! }
        }
        added++
        return {
          _key: newKey(), _gid: gids.get(groupName)!, id: '',
          name: pr.name, url: pr.url, assets_url: null, group: pr.group, image_url: null,
        }
      })
      // Anything the model did not mention, kept at the end.
      const untouched = [...existing.values()]
      setRows([...merged, ...untouched])

      setNote(
        `Read ${r.products.length} from the brief — ${added} new, ${r.products.length - added} already here (links kept)` +
        `${untouched.length ? `, ${untouched.length} not mentioned and left alone` : ''}. Nothing is saved until you press Save.`,
      )
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not read the brief.')
    } finally {
      setProposing(false)
    }
  }

  const input = (ok: boolean): React.CSSProperties => ({
    width: '100%', fontSize: 12, padding: '6px 8px', borderRadius: 6,
    border: `1px solid ${ok ? 'var(--border)' : 'var(--danger)'}`,
    background: 'var(--surface-2)', color: 'var(--text-primary)',
  })

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 16 }}>
        <button onClick={propose} disabled={proposing || pending} style={aiBtn}>
          {proposing ? 'Reading the brief…' : '✦ Fill from the brief'}
        </button>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Adds what is missing. Your links are kept.</span>
      </div>
      {note && <div style={{ fontSize: 11.5, color: 'var(--success)', marginBottom: 12 }}>{note}</div>}

      {groups.map(g => (
        <div key={g.gid} style={{ marginBottom: 20, paddingLeft: 12, borderLeft: `2px solid ${g.name ? 'var(--accent)' : 'var(--border)'}` }}>
          <input
            value={g.name}
            placeholder="Group name — e.g. Bundle 1"
            onChange={e => renameGroup(g.gid, e.target.value)}
            style={{ ...input(true), fontWeight: 700, fontSize: 12.5, marginBottom: 8, maxWidth: 380 }}
          />

          {rows.filter(r => r._gid === g.gid).map(r => (
            <div key={r._key} style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0,1.2fr) minmax(0,1fr) minmax(0,1fr) auto', gap: 8, marginBottom: 8, alignItems: 'center' }}>
              <ImageCell
                value={r.image_url}
                projectId={projectId}
                onChange={url => setRows(prev => prev.map(x => (x._key === r._key ? { ...x, image_url: url } : x)))}
              />
              <input value={r.name} placeholder="Product name" onChange={e => set(r._key, 'name', e.target.value)} style={input(true)} />
              <input value={r.url ?? ''} placeholder="Product link" onChange={e => set(r._key, 'url', e.target.value)} style={input(isLink(r.url))} />
              <input value={r.assets_url ?? ''} placeholder="HQ assets link" onChange={e => set(r._key, 'assets_url', e.target.value)} style={input(isLink(r.assets_url))} />
              <button onClick={() => setRows(prev => prev.filter(x => x._key !== r._key))} title="Remove" style={{ ...miniBtn, color: 'var(--danger)' }}>✕</button>
            </div>
          ))}

          <button onClick={() => addTo(g.gid, g.name)} style={ghostBtn}>+ Add product to this group</button>
        </div>
      ))}

      <button
        onClick={() => setRows(prev => [...prev, { _key: newKey(), _gid: newKey(), id: '', name: '', url: null, assets_url: null, group: `Bundle ${groups.filter(g => g.name).length + 1}`, image_url: null }])}
        style={{ ...ghostBtn, borderStyle: 'solid' }}
      >+ Add a group</button>

      <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
        <button onClick={save} disabled={pending} style={{ fontSize: 12, fontWeight: 700, padding: '8px 14px', borderRadius: 8, border: '1px solid var(--accent)', background: 'var(--accent-muted)', color: 'var(--accent)', cursor: pending ? 'wait' : 'pointer' }}>
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onDone} disabled={pending} style={{ fontSize: 12, fontWeight: 600, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
          Cancel
        </button>
      </div>

      {err && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 8 }}>{err}</div>}
    </div>
  )
}

const miniBtn: React.CSSProperties = {
  fontSize: 12, width: 26, height: 26, borderRadius: 6, cursor: 'pointer',
  border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-secondary)',
}
const ghostBtn: React.CSSProperties = {
  fontSize: 11.5, fontWeight: 600, color: 'var(--accent)', background: 'none',
  border: '1px dashed var(--border-strong)', borderRadius: 6, padding: '6px 10px', cursor: 'pointer',
}
const aiBtn: React.CSSProperties = {
  fontSize: 11.5, fontWeight: 600, padding: '6px 11px', borderRadius: 6,
  border: '1px solid var(--border-strong)', background: 'none', color: 'var(--text-secondary)', cursor: 'pointer',
}
