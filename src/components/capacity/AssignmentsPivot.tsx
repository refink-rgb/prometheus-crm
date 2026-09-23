'use client'

// Assignments-by-editor pivot — the automated version of the workload sheet
// management kept rebuilding by hand (Lucas's Sep 23 pivot screenshot is the
// reference). Tracks as bands, editors as rows with monthly totals, client
// breakdown COLLAPSED behind a per-editor toggle.
//
// Counts are ASSIGNMENTS (projects per launch/due month, attributed via
// lp_editor_id / creative_editor_id, with the legacy assigned_designer string
// as the creative-side fallback). Unassigned work is shown, not hidden — an
// "Unassigned" row is a data-quality prompt, and deleting a user nulls their
// history (see project memory), so hiding it would hide real work.

import { useState } from 'react'

export interface PivotClient {
  name: string
  months: Record<string, number>
  total: number
}

export interface PivotEditor {
  name: string
  months: Record<string, number>
  total: number
  clients: PivotClient[]
}

export interface PivotTrack {
  track: string
  editors: PivotEditor[]
  months: Record<string, number>
  total: number
}

export default function AssignmentsPivot({
  tracks,
  months,
  monthLabels,
}: {
  tracks: PivotTrack[]
  /** 'YYYY-MM' keys, chronological. */
  months: string[]
  /** Display labels aligned with `months`. */
  monthLabels: string[]
}) {
  const [open, setOpen] = useState<Set<string>>(new Set())

  function toggle(key: string) {
    setOpen(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const num = (v: number | undefined) => (v ? v : null)

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--surface-raised)' }}>
              <th style={{ ...TH, textAlign: 'left', minWidth: 220 }}>Editor</th>
              {monthLabels.map(m => <th key={m} style={TH}>{m}</th>)}
              <th style={TH}>Total</th>
            </tr>
          </thead>
          <tbody>
            {tracks.map(t => (
              <TrackRows key={t.track} t={t} months={months} open={open} toggle={toggle} num={num} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TrackRows({
  t, months, open, toggle, num,
}: {
  t: PivotTrack
  months: string[]
  open: Set<string>
  toggle: (k: string) => void
  num: (v: number | undefined) => number | null
}) {
  return (
    <>
      <tr>
        <td colSpan={months.length + 2} style={{
          padding: '8px 14px', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
          textTransform: 'uppercase', color: 'var(--text-secondary)',
          background: 'var(--surface-2)', borderTop: '1px solid var(--border)',
        }}>
          {t.track}
        </td>
      </tr>
      {t.editors.map(e => {
        const key = `${t.track}|${e.name}`
        const isOpen = open.has(key)
        const unassigned = e.name === 'Unassigned'
        return (
          <EditorRows
            key={key}
            e={e}
            months={months}
            isOpen={isOpen}
            unassigned={unassigned}
            onToggle={() => toggle(key)}
            num={num}
          />
        )
      })}
      <tr style={{ background: 'var(--surface-raised)' }}>
        <td style={{ ...TD, fontWeight: 700 }}>Total {t.track}</td>
        {months.map(m => (
          <td key={m} style={{ ...TD_NUM, fontWeight: 700 }}>{num(t.months[m])}</td>
        ))}
        <td style={{ ...TD_NUM, fontWeight: 700 }}>{t.total}</td>
      </tr>
    </>
  )
}

function EditorRows({
  e, months, isOpen, unassigned, onToggle, num,
}: {
  e: PivotEditor
  months: string[]
  isOpen: boolean
  unassigned: boolean
  onToggle: () => void
  num: (v: number | undefined) => number | null
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        style={{ cursor: 'pointer', borderTop: '1px solid var(--border)' }}
        title={isOpen ? 'Hide client breakdown' : 'Show client breakdown'}
      >
        <td style={{ ...TD, fontWeight: 600, color: unassigned ? 'var(--warning)' : 'var(--text-primary)' }}>
          <span style={{
            display: 'inline-block', width: 14, color: 'var(--text-muted)',
            transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.12s',
          }}>›</span>
          {e.name}
          <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}>
            {e.clients.length} client{e.clients.length === 1 ? '' : 's'}
          </span>
        </td>
        {months.map(m => (
          <td key={m} style={{ ...TD_NUM, fontWeight: 600 }}>{num(e.months[m])}</td>
        ))}
        <td style={{ ...TD_NUM, fontWeight: 700 }}>{e.total}</td>
      </tr>
      {isOpen && e.clients.map(c => (
        <tr key={c.name} style={{ background: 'var(--surface-1)' }}>
          <td style={{ ...TD, paddingLeft: 34, color: 'var(--text-secondary)' }}>{c.name}</td>
          {months.map(m => (
            <td key={m} style={{ ...TD_NUM, color: 'var(--text-secondary)' }}>{num(c.months[m])}</td>
          ))}
          <td style={{ ...TD_NUM, color: 'var(--text-secondary)' }}>{c.total}</td>
        </tr>
      ))}
    </>
  )
}

const TH: React.CSSProperties = {
  padding: '9px 14px', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
  textTransform: 'uppercase', color: 'var(--text-muted)', textAlign: 'right',
}
const TD: React.CSSProperties = { padding: '8px 14px', textAlign: 'left' }
const TD_NUM: React.CSSProperties = { padding: '8px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
