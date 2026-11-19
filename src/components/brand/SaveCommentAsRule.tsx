'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { addClientRule } from '@/lib/brands/actions'
import { areaForTrack, RULE_AREAS, type RuleOption } from '@/lib/brands/profile'
import { AreaSelect } from './ClientRulesBoard'
import './brand.css'

// Turns one client review comment into a client rule, or into one more time
// the client told us a rule we already have (which is what "Told us 3×" on the
// Feedback tab counts). Either way the comment is linked through a
// client_rule_mentions row, so it leaves the brand's unsorted list.

export default function SaveCommentAsRule({
  brandId, projectId, comment, rules, saved = [], extra,
}: {
  brandId: string
  projectId: string
  comment: { id: string; content: string; created_at: string; track: string }
  /** The brand's active rules, for "they said this before". */
  rules: RuleOption[]
  /** Rules this comment is already saved to. */
  saved?: RuleOption[]
  /** More actions on the same line (the Feedback tab's One-off). */
  extra?: React.ReactNode
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<'new' | 'again'>('new')
  const [err, setErr] = useState('')
  const [pending, start] = useTransition()
  const choices = rules.filter(r => !saved.some(s => s.id === r.id))
  const area = areaForTrack(comment.track)
  // Same-area rules first: that is where a repeat most likely sits.
  const sorted = [...choices].sort((a, b) => Number(b.area === area) - Number(a.area === area))

  return (
    <div className="cr-save">
      {saved.map(r => (
        <div key={r.id} className="cr-saved">✓ Saved as a {RULE_AREAS[r.area].label.toLowerCase()} rule: {r.rule}</div>
      ))}
      {!open ? (
        <div className="bp-actions" style={{ gap: 14 }}>
          <button type="button" className="bp-link" style={{ fontSize: 13 }} onClick={() => setOpen(true)}>
            {saved.length ? 'Save another rule from this' : 'Save as rule'}
          </button>
          {extra}
        </div>
      ) : (
        <form
          className="bp-form cr-save-box"
          action={fd => {
            setErr('')
            start(async () => {
              const r = await addClientRule(fd)
              if (!r.ok) { setErr(r.error); return }
              setOpen(false)
              router.refresh()
            })
          }}
        >
          <input type="hidden" name="brand_id" value={brandId} />
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="project_comment_id" value={comment.id} />
          <input type="hidden" name="quote" value={comment.content} />
          <input type="hidden" name="source" value="review" />
          <input type="hidden" name="said_on" value={comment.created_at.slice(0, 10)} />

          {choices.length > 0 && (
            <div className="mo-chips" role="group" aria-label="New or repeated rule">
              <button type="button" className="mo-chip" aria-pressed={kind === 'new'} onClick={() => setKind('new')}>New rule</button>
              <button type="button" className="mo-chip" aria-pressed={kind === 'again'} onClick={() => setKind('again')}>They said this before</button>
            </div>
          )}

          {kind === 'again' && choices.length > 0 ? (
            <div>
              <label htmlFor={`again-${comment.id}`}>Which rule</label>
              <select id={`again-${comment.id}`} name="existing_rule_id" required defaultValue="">
                <option value="" disabled>Pick the rule they repeated</option>
                {sorted.map(r => <option key={r.id} value={r.id}>{RULE_AREAS[r.area].label}: {r.rule.length > 110 ? `${r.rule.slice(0, 110)}…` : r.rule}</option>)}
              </select>
            </div>
          ) : (
            <>
              <div>
                <label htmlFor={`rule-${comment.id}`}>Rule, reworded as an instruction for all future work</label>
                <textarea id={`rule-${comment.id}`} name="rule" rows={3} required autoFocus defaultValue={comment.content}
                  placeholder="e.g. “Never use AI images of the product.”" />
              </div>
              <div className="bp-form-row">
                <div>
                  <label htmlFor={`area-${comment.id}`}>Applies to</label>
                  <AreaSelect id={`area-${comment.id}`} defaultValue={area} />
                </div>
                <div>
                  <label htmlFor={`why-${comment.id}`}>Their reason (optional)</label>
                  <input id={`why-${comment.id}`} name="why" />
                </div>
              </div>
            </>
          )}
          <p className="bp-hint" style={{ margin: 0 }}>Their comment is kept with the rule as what they said.</p>
          {err && <p className="mo-error">{err}</p>}
          <div className="bp-actions">
            <button className="btn-primary" disabled={pending} style={{ fontSize: 14 }}>{pending ? 'Saving…' : 'Save rule'}</button>
            <button type="button" className="bp-link bp-link-muted" onClick={() => { setOpen(false); setErr('') }}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  )
}
