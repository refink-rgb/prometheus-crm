'use client'

import { useState } from 'react'
import type { IntakeSection } from '@/lib/brands/intake'
import './brand.css'

// The client's intake answers laid out for the team to read: grouped like the
// form, question beside answer, links clickable. Skipped questions are hidden
// until asked for, so the team can see what still has to be chased.

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
  brandName, sections, text, submittedAt, updatedAt,
}: {
  brandName: string
  sections: IntakeSection[]
  /** The same answers as plain text, for Copy. */
  text: string
  submittedAt: string | null
  updatedAt: string | null
}) {
  const [showSkipped, setShowSkipped] = useState(false)
  const [copied, setCopied] = useState(false)
  const all = sections.flatMap(s => s.items)
  const answered = all.filter(i => i.a).length
  if (answered === 0) return null

  const when = (iso: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso))

  async function copy() {
    try { await navigator.clipboard.writeText(`${brandName} intake answers\n\n${text}`); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* nothing to show */ }
  }

  return (
    <section className="mo-panel" aria-label="Intake answers">
      <div className="bp-card-head">
        <div>
          <h2 className="mo-h2">
            Intake answers <span className="mo-count">· {answered}/{all.length}</span>
          </h2>
          <p className="bp-purpose">
            What {brandName} told us on the intake form
            {submittedAt ? `, sent ${when(submittedAt)}.` : updatedAt ? `, still in progress (last saved ${when(updatedAt)}).` : '.'}
            {' '}Their don&apos;ts are already on the Client feedback tab.
          </p>
        </div>
        <div className="bp-actions">
          <button className="bp-link bp-link-muted" style={{ fontSize: 13 }} onClick={() => setShowSkipped(v => !v)}>
            {showSkipped ? 'Hide skipped' : `Show skipped (${all.length - answered})`}
          </button>
          <button className="bp-link" style={{ fontSize: 13 }} onClick={copy}>{copied ? '✓ Copied' : 'Copy as text'}</button>
        </div>
      </div>
      <div className="bp-card-body ir-body">
        {sections.map(s => {
          const items = showSkipped ? s.items : s.items.filter(i => i.a)
          if (!items.length) return null
          const n = s.items.filter(i => i.a).length
          return (
            <details key={s.title} className="ir-group" open>
              <summary>
                <span>{s.title}</span>
                <em>{n}/{s.items.length}</em>
              </summary>
              <dl className="ir-qa">
                {items.map(i => (
                  <div key={i.q} className={i.a ? '' : 'ir-skipped'}>
                    <dt>{i.q}</dt>
                    <dd>{i.a ? <Answer text={i.a} /> : 'Not answered'}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )
        })}
      </div>
    </section>
  )
}
