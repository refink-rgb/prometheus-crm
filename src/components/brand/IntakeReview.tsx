'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { IntakeQA, IntakeSection } from '@/lib/brands/intake'
import { saveIntakeAnswer } from '@/lib/brands/intake-actions'
import './brand.css'

// The client's intake answers laid out for the team to read: grouped like the
// form, question beside answer, links clickable. Starts collapsed to one line so
// it never takes over the page; each group opens on its own. Free-text answers
// can be corrected by the team. Skipped questions are hidden until asked for.

const URL_RE = /(https?:\/\/[^\s<>"')]+)/g

function Answer({ text }: { text: string }) {
  const parts = text.split(URL_RE)
  return (
    <>
      {parts.map((p, i) => i % 2
        ? <a key={i} href={p} target="_blank" rel="noreferrer">{p}</a>
        : p)}
    </>
  )
}

export default function IntakeReview({
  brandId, brandName, sections, text, submittedAt, updatedAt, canEdit = false,
}: {
  brandId: string
  brandName: string
  sections: IntakeSection[]
  /** The same answers as plain text, for Copy. */
  text: string
  submittedAt: string | null
  updatedAt: string | null
  canEdit?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [showSkipped, setShowSkipped] = useState(false)
  const [copied, setCopied] = useState(false)
  const all = sections.flatMap(s => s.items)
  const answered = all.filter(i => i.a).length
  if (answered === 0 && !canEdit) return null

  const when = (iso: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso))

  async function copy() {
    try { await navigator.clipboard.writeText(`${brandName} intake answers\n\n${text}`); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* nothing to show */ }
  }

  return (
    <section aria-label="Client answers">
      <div className="bp-card-head" style={{ padding: 0 }}>
        <div>
          <p className="bp-purpose" style={{ margin: 0 }}>
            <b>{answered} of {all.length}</b> answered on the intake form
            {submittedAt ? `, sent ${when(submittedAt)}.` : updatedAt ? `, still in progress (last saved ${when(updatedAt)}).` : '.'}
            {' '}Their don&apos;ts are already on the Feedback tab.
          </p>
        </div>
        <div className="bp-actions">
          {open && (
            <button className="bp-link bp-link-muted" style={{ fontSize: 13 }} onClick={() => setShowSkipped(v => !v)}>
              {showSkipped ? 'Hide skipped' : `Show skipped (${all.length - answered})`}
            </button>
          )}
          <button className="bp-link bp-link-muted" style={{ fontSize: 13 }} onClick={copy}>{copied ? '✓ Copied' : 'Copy as text'}</button>
          <button className="bp-link" style={{ fontSize: 13 }} onClick={() => setOpen(v => !v)} aria-expanded={open}>
            {open ? 'Hide answers' : 'Show answers'}
          </button>
        </div>
      </div>
      {open && (
        <div className="ir-body">
          {sections.map(s => {
            const items = showSkipped ? s.items : s.items.filter(i => i.a)
            if (!items.length) return null
            const n = s.items.filter(i => i.a).length
            return (
              <details key={s.title} className="ir-group">
                <summary>
                  <span>{s.title}</span>
                  <em>{n}/{s.items.length}</em>
                </summary>
                <dl className="ir-qa">
                  {items.map(i => <Row key={i.q} brandId={brandId} item={i} canEdit={canEdit} />)}
                </dl>
              </details>
            )
          })}
        </div>
      )}
    </section>
  )
}

function Row({ brandId, item, canEdit }: { brandId: string; item: IntakeQA; canEdit: boolean }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.a)
  const [err, setErr] = useState('')
  const [pending, start] = useTransition()

  function save() {
    if (!item.field) return
    start(async () => {
      const r = await saveIntakeAnswer(brandId, item.field!, draft)
      if (!r.ok) { setErr(r.error); return }
      setErr(''); setEditing(false); router.refresh()
    })
  }

  return (
    <div className={item.a ? '' : 'ir-skipped'}>
      <dt>{item.q}</dt>
      <dd>
        {editing ? (
          <div className="ir-edit">
            <textarea value={draft} onChange={e => setDraft(e.target.value)} autoFocus />
            <div className="bp-actions">
              <button className="btn-primary" style={{ fontSize: 13 }} disabled={pending} onClick={save}>{pending ? 'Saving…' : 'Save'}</button>
              <button className="bp-link bp-link-muted" style={{ fontSize: 13 }} onClick={() => { setDraft(item.a); setEditing(false); setErr('') }}>Cancel</button>
            </div>
            {err && <p className="mo-error">{err}</p>}
          </div>
        ) : (
          <>
            {item.a ? <Answer text={item.a} /> : 'Not answered'}
            {canEdit && item.field && (
              <>{' '}<button className="bp-link bp-link-muted" style={{ fontSize: 12 }} onClick={() => setEditing(true)}>Edit</button></>
            )}
          </>
        )}
      </dd>
    </div>
  )
}
