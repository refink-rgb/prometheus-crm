'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { saveCopyApprovals, restorePrunedCopy } from '@/lib/actions'
import type { CopyApprovals } from '@/lib/types'
import { verdictFor } from '@/lib/products'

// The copy deck with sign-off.
//
// Three states per line, not two: approved, rejected, and NOT YET LOOKED AT.
// A plain checkbox cannot express the third, and conflating "not reviewed" with
// "rejected" is how a line that nobody has read ends up looking deliberately
// killed.
//
// Lines are identified by their text, so editing a headline drops its approval.
// That is the point — changed copy has not been signed off.

type Status = 'approved' | 'rejected' | null

export default function CopyApprovalDeck({
  projectId, brandId, columns, approvals,
}: {
  projectId: string
  brandId: string
  columns: { label: string; lines: string[] }[]
  approvals: CopyApprovals
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const [note, setNote] = useState('')

  // Seeded from what is saved; edits live here until Save.
  const [draft, setDraft] = useState<Record<string, Status>>(() => {
    const seed: Record<string, Status> = {}
    for (const col of columns) {
      for (const line of col.lines) seed[line] = verdictFor(approvals, line)?.status ?? null
    }
    return seed
  })

  const saved = useMemo(() => {
    const m: Record<string, Status> = {}
    for (const col of columns) {
      for (const line of col.lines) m[line] = verdictFor(approvals, line)?.status ?? null
    }
    return m
  }, [columns, approvals])

  const dirty = Object.keys(draft).some(k => draft[k] !== saved[k])
  const counts = {
    approved: Object.values(draft).filter(v => v === 'approved').length,
    rejected: Object.values(draft).filter(v => v === 'rejected').length,
  }
  const latest = approvals.log[0] ?? null

  const set = (line: string, next: Status) =>
    setDraft(prev => ({ ...prev, [line]: prev[line] === next ? null : next }))

  const total = columns.reduce((n, c) => n + c.lines.length, 0)

  // Once anything has been approved, the deck shows the approved set by default.
  // Nothing is deleted — a verdict changes what you look at, not what exists —
  // so this is reversible with one click and there is nothing to confirm.
  // Hiding is driven by what is SAVED, never by the draft.
  //
  // It used to key off `draft`, so ticking the first line instantly hid every
  // other line — including the ones you had not read yet. You could not pick a
  // few, because picking one removed the list you were picking from.
  //
  // Now the full deck stays up while you work, and collapses to the approved set
  // only once you press Save.
  const savedApproved = useMemo(
    () => Object.values(saved).filter(v => v === 'approved').length,
    [saved],
  )
  // The full deck is the DEFAULT, including on a fresh page load. Collapsing is
  // something Save does, not a state the page wakes up in — an editor opening a
  // project should see every line they have to choose from, not a filtered view
  // of a decision made last week.
  const [justSaved, setJustSaved] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const collapsed = justSaved && !dirty && !showAll && savedApproved > 0
  const hidden = collapsed ? total - savedApproved : 0

  function save() {
    setErr(''); setNote('')
    startTransition(async () => {
      try {
        const verdicts = Object.entries(draft)
          .filter(([, v]) => v !== null)
          .map(([text, status]) => ({ text, status: status as 'approved' | 'rejected' }))
        const r = await saveCopyApprovals(projectId, brandId, verdicts)
        if (!r.ok) { setErr(r.error); return }
        // Collapse now, and only now.
        setJustSaved(true)
        setShowAll(false)
        router.refresh()
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Could not save.')
      }
    })
  }

  function undo() {
    setErr(''); setNote('')
    startTransition(async () => {
      try {
        const r = await restorePrunedCopy(projectId, brandId)
        if (!r.ok) { setErr(r.error); return }
        setNote(`${r.restored} line${r.restored === 1 ? '' : 's'} put back.`)
        router.refresh()
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Could not restore.')
      }
    })
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 16 }}>
        {columns.filter(c => c.lines.length).map(col => (
          <div key={col.label}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: 6 }}>
              {col.label} ({collapsed
                ? col.lines.filter(l => saved[l] === 'approved').length
                : col.lines.length})
            </div>
            {col.lines
              .filter(line => !collapsed || saved[line] === 'approved')
              .map((line, i) => {
              const v = draft[line] ?? null
              const who = verdictFor(approvals, line)
              return (
                <div key={`${line}-${i}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 6 }}>
                  <div style={{ display: 'flex', gap: 3, flexShrink: 0, paddingTop: 4 }}>
                    <button
                      onClick={() => set(line, 'approved')}
                      aria-pressed={v === 'approved'}
                      title={v === 'approved' ? 'Approved — click to clear' : 'Approve'}
                      style={mark(v === 'approved', 'var(--success)')}
                    >✓</button>
                    <button
                      onClick={() => set(line, 'rejected')}
                      aria-pressed={v === 'rejected'}
                      title={v === 'rejected' ? 'Rejected — click to clear' : 'Reject'}
                      style={mark(v === 'rejected', 'var(--danger)')}
                    >✕</button>
                  </div>

                  {/* Still copyable: lifting a line is what this deck is for, and
                      approving it should not cost that. */}
                  <button
                    onClick={async () => {
                      try { await navigator.clipboard.writeText(line); setCopied(line); setTimeout(() => setCopied(null), 1000) } catch { /* blocked */ }
                    }}
                    title="Click to copy"
                    style={{
                      textAlign: 'left', flex: 1, minWidth: 0, fontSize: 13, padding: '5px 10px', borderRadius: 6,
                      cursor: 'pointer', whiteSpace: 'normal', lineHeight: 1.45,
                      border: `1px solid ${v === 'approved' ? 'var(--success)' : v === 'rejected' ? 'var(--border)' : 'var(--border)'}`,
                      background: v === 'approved' ? 'rgba(34,197,94,0.08)' : 'var(--surface-2)',
                      color: copied === line ? 'var(--success)' : v === 'rejected' ? 'var(--text-muted)' : 'var(--text-primary)',
                      textDecoration: v === 'rejected' ? 'line-through' : 'none',
                    }}
                  >
                    {copied === line ? 'Copied' : line}
                    {who && (
                      <span style={{ display: 'block', fontSize: 10, color: 'var(--text-muted)', marginTop: 2, textDecoration: 'none' }}>
                        {who.status === 'approved' ? 'Approved' : 'Rejected'} by {who.by ?? 'unknown'}
                      </span>
                    )}
                  </button>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
        <button
          onClick={save}
          disabled={pending || !dirty}
          style={{
            fontSize: 12, fontWeight: 700, padding: '7px 14px', borderRadius: 8, cursor: pending ? 'wait' : dirty ? 'pointer' : 'not-allowed',
            border: `1px solid ${dirty ? 'var(--accent)' : 'var(--border)'}`,
            background: dirty ? 'var(--accent-muted)' : 'transparent',
            color: dirty ? 'var(--accent)' : 'var(--text-muted)',
          }}
        >{pending ? 'Saving…' : dirty ? 'Save sign-off' : 'Saved'}</button>

        <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
          {counts.approved} approved · {counts.rejected} rejected
        </span>

        {savedApproved > 0 && !dirty && (
          <button
            onClick={() => setShowAll(v => !v)}
            style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--accent)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
          >
            {collapsed ? `Show all ${total} · ${hidden} hidden` : `Show approved only (${savedApproved})`}
          </button>
        )}

        {latest && (
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)', marginLeft: 'auto' }}>
            Approved by <strong style={{ color: 'var(--text-secondary)' }}>{latest.by ?? 'unknown'}</strong>
            {' · '}{new Date(latest.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        )}
      </div>

      {approvals.log.length > 1 && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer' }}>History ({approvals.log.length})</summary>
          <div style={{ marginTop: 8 }}>
            {approvals.log.map((l, i) => (
              <div key={`${l.at}-${i}`} style={{ fontSize: 11, color: 'var(--text-secondary)', padding: '3px 0' }}>
                {new Date(l.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                {' — '}{l.by ?? 'unknown'} · {l.approved} approved, {l.rejected} rejected
              </div>
            ))}
          </div>
        </details>
      )}

      {note && <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 8 }}>{note}</div>}

      {approvals.removed.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            {approvals.removed.length} line{approvals.removed.length === 1 ? '' : 's'} removed by a previous sign-off.
          </span>
          <button onClick={undo} disabled={pending} style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--accent)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
            Put them back
          </button>
        </div>
      )}

      {err && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 8 }}>{err}</div>}
    </div>
  )
}

const mark = (on: boolean, colour: string): React.CSSProperties => ({
  width: 22, height: 22, borderRadius: 5, fontSize: 11, lineHeight: 1, cursor: 'pointer',
  border: `1px solid ${on ? colour : 'var(--border)'}`,
  background: on ? colour : 'transparent',
  color: on ? '#fff' : 'var(--text-muted)',
})
