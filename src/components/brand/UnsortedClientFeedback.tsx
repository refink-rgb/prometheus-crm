'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { setCommentRuleChecked } from '@/lib/brands/actions'
import { shortDate, type RuleOption, type UnsortedComment } from '@/lib/brands/profile'
import SaveCommentAsRule from './SaveCommentAsRule'

// Client comments from review links that nobody has sorted yet. Each one is a
// new rule, a repeat of a rule we have, or a one-off fix for that piece. Shown
// on the Feedback tab so standing feedback reaches the rules without anyone
// having to remember to go through every project's review.

const FIRST = 8

export default function UnsortedClientFeedback({
  brandId, comments, rules, projects, canEdit,
}: {
  brandId: string
  comments: UnsortedComment[]
  rules: RuleOption[]
  projects: Record<string, string>
  canEdit: boolean
}) {
  const [all, setAll] = useState(false)
  // Marked one-off during this visit: kept as a line with Undo, since the row
  // itself leaves the list on refresh.
  const [done, setDone] = useState<UnsortedComment[]>([])
  if (comments.length === 0 && done.length === 0) return null
  const shown = all ? comments : comments.slice(0, FIRST)

  return (
    <section className="mo-panel" aria-labelledby="unsorted-head">
      <div className="bp-card-head">
        <div>
          <h2 className="mo-h2" id="unsorted-head">
            Unsorted client feedback <span className="cr-count">· {comments.length}</span>
          </h2>
          <p className="bp-purpose">
            Comments from review links not yet sorted. If it should hold for all future work, save it as a rule, or as one
            more time they told us a rule we have. If it was only about that piece, mark it one-off.
          </p>
        </div>
      </div>
      <div className="bp-card-body">
        <ul className="cr-list">
          {shown.map(c => (
            <UnsortedItem key={c.id} c={c} brandId={brandId} rules={rules} projects={projects} canEdit={canEdit}
              onOneOff={() => setDone(d => [c, ...d])} />
          ))}
        </ul>
        {comments.length > FIRST && (
          <button className="bp-link bp-link-muted" style={{ marginTop: 10 }} onClick={() => setAll(v => !v)}>
            {all ? 'Show fewer' : `Show all ${comments.length}`}
          </button>
        )}
        {done.length > 0 && (
          <ul className="cr-list" style={{ marginTop: 10 }}>
            {done.map(c => (
              <UndoLine key={c.id} c={c} brandId={brandId} onUndone={() => setDone(d => d.filter(x => x.id !== c.id))} />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function UnsortedItem({ c, brandId, rules, projects, canEdit, onOneOff }: {
  c: UnsortedComment; brandId: string; rules: RuleOption[]; projects: Record<string, string>; canEdit: boolean; onOneOff: () => void
}) {
  const router = useRouter()
  const [err, setErr] = useState('')
  const [pending, start] = useTransition()
  const where = c.track === 'lp' ? 'Landing page' : c.track === 'image' ? 'Creatives' : null

  const oneOff = () => {
    setErr('')
    start(async () => {
      const r = await setCommentRuleChecked(brandId, c.id, true)
      if (!r.ok) { setErr(r.error); return }
      onOneOff()
      router.refresh()
    })
  }

  return (
    <li className="cr-item">
      <p className="cr-rule" style={{ fontWeight: 400, margin: 0 }}>{c.content}</p>
      <div className="cr-meta">
        <span>{c.author_name} · {shortDate(c.created_at)}</span>
        {projects[c.project_id] && (
          <Link href={`/brands/${brandId}/projects/${c.project_id}`} className="bp-link" style={{ fontSize: 13 }}>
            {projects[c.project_id]}
          </Link>
        )}
        {where && <span>{where}{c.section_tag && c.section_tag !== 'General' ? ` · ${c.section_tag}` : ''}</span>}
      </div>
      {canEdit && (
        <SaveCommentAsRule
          brandId={brandId}
          projectId={c.project_id}
          comment={c}
          rules={rules}
          extra={
            <button type="button" className="bp-link bp-link-muted" style={{ fontSize: 13 }} disabled={pending} onClick={oneOff}
              title="Only about that piece, not something for all future work">
              {pending ? 'Saving…' : 'One-off'}
            </button>
          }
        />
      )}
      {err && <p className="mo-error">{err}</p>}
    </li>
  )
}

function UndoLine({ c, brandId, onUndone }: { c: UnsortedComment; brandId: string; onUndone: () => void }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <li className="cr-meta" style={{ padding: '4px 0' }}>
      <span>Marked one-off: “{c.content.length > 80 ? `${c.content.slice(0, 80)}…` : c.content}”</span>
      <button className="bp-link" style={{ fontSize: 13 }} disabled={pending} onClick={() => start(async () => {
        const r = await setCommentRuleChecked(brandId, c.id, false)
        if (r.ok) { onUndone(); router.refresh() }
      })}>Undo</button>
    </li>
  )
}
