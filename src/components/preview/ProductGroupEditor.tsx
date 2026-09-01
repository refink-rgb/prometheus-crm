'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateProjectLists, proposeProjectProducts } from '@/lib/actions'
import type { ProjectProduct } from '@/lib/types'

// Products, grouped into bundles or tiers.
//
// The group is a label on each row rather than a nested structure, so a product
// is never orphaned by a bad group and moving one between bundles is a single
// edit. This component only ever presents them grouped.
//
// The AI proposal loads into this editor UNSAVED. Nothing a model produced
// reaches the database without someone reading it and pressing Save.

type Row = ProjectProduct & { _key: string }

const newKey = () => globalThis.crypto?.randomUUID?.() ?? `k-${Math.random().toString(36).slice(2)}`
const isLink = (v: string | null) => !v?.trim() || /^https?:\/\//i.test(v.trim())

export default function ProductGroupEditor({
  projectId, brandId, initial, onDone,
}: {
  projectId: string
  brandId: string
  initial: ProjectProduct[]
  onDone: () => void
}) {
  const router = useRouter()
  const [rows, setRows] = useState<Row[]>(initial.map(p => ({ ...p, _key: newKey() })))
  const [pending, startTransition] = useTransition()
  const [proposing, setProposing] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')

  // Group order follows first appearance, so reordering rows reorders groups.
  const groups: (string | null)[] = []
  for (const r of rows) {
    const g = r.group || null
    if (!groups.some(x => x === g)) groups.push(g)
  }
  if (!groups.length) groups.push(null)

  const set = (key: string, field: keyof ProjectProduct, v: string) =>
    setRows(prev => prev.map(r => (r._key === key ? { ...r, [field]: v } : r)))

  const addTo = (group: string | null) =>
    setRows(prev => [...prev, { _key: newKey(), id: '', name: '', url: null, assets_url: null, group }])

  const renameGroup = (from: string | null, to: string) =>
    setRows(prev => prev.map(r => ((r.group || null) === from ? { ...r, group: to || null } : r)))

  const bad = rows.some(r => !isLink(r.url) || !isLink(r.assets_url))

  function save() {
    if (bad) { setErr('Links must start with http:// or https://'); return }
    setErr('')
    startTransition(async () => {
      try {
        await updateProjectLists(projectId, brandId, {
          products: rows.filter(r => r.name.trim()).map(r => ({
            id: r.id || undefined, name: r.name, url: r.url, assets_url: r.assets_url, group: r.group,
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
      setRows(r.products.map(p => ({
        _key: newKey(), id: '', name: p.name, url: p.url, assets_url: null, group: p.group,
      })))
      setNote(`Read ${r.products.length} product${r.products.length === 1 ? '' : 's'} from the brief. Nothing is saved until you press Save.`)
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
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Replaces what is below. Nothing saves until you press Save.</span>
      </div>
      {note && <div style={{ fontSize: 11.5, color: 'var(--success)', marginBottom: 12 }}>{note}</div>}

      {groups.map(group => (
        <div key={group ?? '__none'} style={{ marginBottom: 20, paddingLeft: 12, borderLeft: `2px solid ${group ? 'var(--accent)' : 'var(--border)'}` }}>
          <input
            value={group ?? ''}
            placeholder="Group name — e.g. Bundle 1, Tier 2. Leave blank for ungrouped."
            onChange={e => renameGroup(group, e.target.value)}
            style={{ ...input(true), fontWeight: 700, fontSize: 12.5, marginBottom: 8, maxWidth: 380 }}
          />

          {rows.filter(r => (r.group || null) === group).map(r => (
            <div key={r._key} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr) minmax(0,1fr) auto', gap: 8, marginBottom: 8, alignItems: 'center' }}>
              <input value={r.name} placeholder="Product name" onChange={e => set(r._key, 'name', e.target.value)} style={input(true)} />
              <input value={r.url ?? ''} placeholder="Product link" onChange={e => set(r._key, 'url', e.target.value)} style={input(isLink(r.url))} />
              <input value={r.assets_url ?? ''} placeholder="HQ assets link" onChange={e => set(r._key, 'assets_url', e.target.value)} style={input(isLink(r.assets_url))} />
              <button onClick={() => setRows(prev => prev.filter(x => x._key !== r._key))} title="Remove" style={{ ...miniBtn, color: 'var(--danger)' }}>✕</button>
            </div>
          ))}

          <button onClick={() => addTo(group)} style={ghostBtn}>+ Add product to this group</button>
        </div>
      ))}

      <button
        onClick={() => setRows(prev => [...prev, { _key: newKey(), id: '', name: '', url: null, assets_url: null, group: `Bundle ${groups.filter(Boolean).length + 1}` }])}
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
