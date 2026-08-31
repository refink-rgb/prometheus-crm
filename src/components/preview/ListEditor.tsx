'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateProjectLists } from '@/lib/actions'

// One editor for both of the Creatives tab's repeating lists. Products and
// competitors are the same shape — a name plus two links — so they get one
// implementation parameterised by column labels.
//
// The whole array is rewritten on save, so this is last-write-wins per project:
// two people editing the same tab at once will overwrite each other. That is the
// accepted cost of storing these as JSONB rather than child tables.

export type ListRow = { id: string; name: string; a: string; b: string }

const newId = () => globalThis.crypto?.randomUUID?.() ?? `p-${Math.random().toString(36).slice(2)}`
const isLink = (v: string) => !v.trim() || /^https?:\/\//i.test(v.trim())

export default function ListEditor({
  projectId, brandId, kind, rows: initial, labels, onDone,
}: {
  projectId: string
  brandId: string
  kind: 'products' | 'competitors'
  rows: ListRow[]
  labels: { name: string; a: string; b: string; add: string }
  onDone: () => void
}) {
  const router = useRouter()
  const [rows, setRows] = useState<ListRow[]>(initial)
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState('')

  const set = (i: number, k: keyof ListRow, v: string) =>
    setRows(prev => prev.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
  const move = (i: number, d: -1 | 1) =>
    setRows(prev => {
      const next = [...prev]
      const j = i + d
      if (j < 0 || j >= next.length) return prev
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  // The server strips a bad URL to null silently. Say so here first, or a
  // pasted "wowsports.com/x" disappears on save with no explanation.
  const bad = rows.some(r => !isLink(r.a) || !isLink(r.b))

  function save() {
    if (bad) { setErr('Links must start with http:// or https://'); return }
    setErr('')
    startTransition(async () => {
      try {
        const payload = rows.filter(r => r.name.trim())
        await updateProjectLists(projectId, brandId,
          kind === 'products'
            ? { products: payload.map(r => ({ id: r.id, name: r.name, url: r.a || null, assets_url: r.b || null })) }
            : { competitors: payload.map(r => ({ id: r.id, name: r.name, site_url: r.a || null, motion_url: r.b || null })) })
        router.refresh()
        onDone()
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Could not save.')
      }
    })
  }

  const input = (v: string, ok: boolean): React.CSSProperties => ({
    width: '100%', fontSize: 12, padding: '6px 8px', borderRadius: 6,
    border: `1px solid ${ok ? 'var(--border)' : 'var(--danger)'}`,
    background: 'var(--surface-2)', color: 'var(--text-primary)',
  })

  return (
    <div>
      {rows.map((r, i) => (
        <div key={r.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr) minmax(0,1fr) auto', gap: 8, marginBottom: 8, alignItems: 'center' }}>
          <input value={r.name} placeholder={labels.name} onChange={e => set(i, 'name', e.target.value)} style={input(r.name, true)} />
          <input value={r.a} placeholder={labels.a} onChange={e => set(i, 'a', e.target.value)} style={input(r.a, isLink(r.a))} />
          <input value={r.b} placeholder={labels.b} onChange={e => set(i, 'b', e.target.value)} style={input(r.b, isLink(r.b))} />
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => move(i, -1)} disabled={i === 0} title="Move up" style={miniBtn}>↑</button>
            <button onClick={() => move(i, 1)} disabled={i === rows.length - 1} title="Move down" style={miniBtn}>↓</button>
            <button onClick={() => setRows(prev => prev.filter((_, j) => j !== i))} title="Remove" style={{ ...miniBtn, color: 'var(--danger)' }}>✕</button>
          </div>
        </div>
      ))}

      <button
        onClick={() => setRows(prev => [...prev, { id: newId(), name: '', a: '', b: '' }])}
        style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', background: 'none', border: '1px dashed var(--border-strong)', borderRadius: 6, padding: '7px 12px', cursor: 'pointer', marginTop: 4 }}
      >+ {labels.add}</button>

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
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
