'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { saveBrandProfileFields } from '@/lib/brands/actions'

// What the client answered on intake. Read first, long answers clamped.

export default function IntakeAnswers({ brandId, answers, canEdit }: { brandId: string; answers: string | null; canEdit: boolean }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(answers ?? '')
  const [all, setAll] = useState(false)
  const [err, setErr] = useState('')
  const [pending, start] = useTransition()
  const long = (answers?.length ?? 0) > 600

  if (editing) {
    return (
      <div className="bp-form">
        <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={10} autoFocus
          placeholder="Paste the intake answers: question, then answer." />
        {err && <p className="mo-error">{err}</p>}
        <div className="bp-actions">
          <button className="btn-primary" disabled={pending} style={{ fontSize: 14 }} onClick={() => start(async () => {
            const r = await saveBrandProfileFields(brandId, { intake_answers: draft })
            if (!r.ok) { setErr(r.error); return }
            setEditing(false)
            router.refresh()
          })}>{pending ? 'Saving…' : 'Save'}</button>
          <button className="bp-link bp-link-muted" onClick={() => { setDraft(answers ?? ''); setEditing(false) }}>Cancel</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {answers ? (
        <p style={{
          margin: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap',
          ...(long && !all ? { maxHeight: 160, overflow: 'hidden', maskImage: 'linear-gradient(#000 70%, transparent)' } : {}),
        }}>{answers}</p>
      ) : (
        <p className="bp-empty">No intake answers recorded.</p>
      )}
      <div className="bp-actions">
        {long && <button className="bp-link bp-link-muted" style={{ fontSize: 13 }} onClick={() => setAll(v => !v)}>{all ? 'Show less' : 'Show all'}</button>}
        {canEdit && <button className="bp-link" style={{ fontSize: 13 }} onClick={() => setEditing(true)}>{answers ? 'Edit answers' : 'Add answers'}</button>}
      </div>
    </div>
  )
}
