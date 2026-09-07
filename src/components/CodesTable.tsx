'use client'

import { useState, useMemo, useDeferredValue } from 'react'
import Link from 'next/link'
import MomentCodeChip from './MomentCodeChip'

export interface CodeRow {
  id: string
  brandId: string
  brand: string
  project: string
  code: string | null
  due: string | null
  complete: boolean
}

// Three columns and a search box. This is a lookup table, not a dashboard —
// the job is "find the code for that thing" in under five seconds.

export default function CodesTable({ rows }: { rows: CodeRow[] }) {
  const [q, setQ] = useState('')
  const [showDone, setShowDone] = useState(false)
  const deferred = useDeferredValue(q)

  const shown = useMemo(() => {
    const s = deferred.trim().toLowerCase()
    return rows
      .filter(r => showDone || !r.complete)
      // Brand, project OR code — you rarely remember which one you know.
      .filter(r => !s || r.brand.toLowerCase().includes(s) || r.project.toLowerCase().includes(s) || (r.code ?? '').toLowerCase().includes(s))
      .sort((a, b) => a.brand.localeCompare(b.brand) || (b.due ?? '').localeCompare(a.due ?? ''))
  }, [rows, deferred, showDone])

  const missing = rows.filter(r => !r.complete && !r.code).length

  function copyAll() {
    const tsv = shown.map(r => [r.brand, r.project, r.code ?? ''].join('\t')).join('\n')
    navigator.clipboard.writeText(`Brand\tProject\tCode\n${tsv}`).catch(() => {})
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Search brand, project or code…"
          value={q}
          onChange={e => setQ(e.target.value)}
          style={{ fontSize: 13, maxWidth: 320, flex: '1 1 240px' }}
        />
        <label style={{ textTransform: 'none', letterSpacing: 0, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
          <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} style={{ width: 'auto', margin: 0 }} />
          Include completed
        </label>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{shown.length} shown</span>
        {/* Tab-separated, so it pastes straight into Sheets as three columns. */}
        <button onClick={copyAll} style={{
          marginLeft: 'auto', fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 8,
          border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-secondary)', cursor: 'pointer',
        }}>Copy all for Sheets</button>
      </div>

      {missing > 0 && (
        <div style={{ marginBottom: 14, padding: '8px 12px', borderRadius: 10, fontSize: 12, color: 'var(--warning)', background: 'rgba(234,179,8,0.10)', border: '1px solid rgba(234,179,8,0.28)' }}>
          {missing} active project{missing === 1 ? ' has' : 's have'} no code — they have no due date to date one from.
        </div>
      )}

      <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: 'minmax(120px,1fr) minmax(180px,2fr) minmax(150px,auto)',
          gap: 12, padding: '10px 14px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)',
          fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)',
        }}>
          <span>Brand</span><span>Project</span><span>Code</span>
        </div>
        {shown.map(r => (
          <div key={r.id} style={{
            display: 'grid', gridTemplateColumns: 'minmax(120px,1fr) minmax(180px,2fr) minmax(150px,auto)',
            gap: 12, padding: '9px 14px', borderBottom: '1px solid var(--border)', alignItems: 'center',
            opacity: r.complete ? 0.55 : 1,
          }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.brand}</span>
            <Link
              href={`/brands/${r.brandId}/projects/${r.id}`}
              title={r.project}
              style={{ fontSize: 12.5, color: 'var(--text-secondary)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >{r.project}</Link>
            {r.code
              ? <MomentCodeChip code={r.code} compact />
              : <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>—</span>}
          </div>
        ))}
        {shown.length === 0 && (
          <div style={{ padding: '40px 14px', textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
            Nothing matches “{q}”.
          </div>
        )}
      </div>
    </>
  )
}
