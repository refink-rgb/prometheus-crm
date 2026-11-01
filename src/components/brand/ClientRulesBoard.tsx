'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  addClientRule, confirmClientRule, restoreClientRule, retireClientRule, updateClientRule,
} from '@/lib/brands/actions'
import {
  isStale, RULE_AREA_ORDER, RULE_AREAS, RULE_SOURCES, shortDate, timesTold,
  type RuleArea, type RuleWithMentions,
} from '@/lib/brands/profile'

// The brand's client rules: the full list with where each came from, plus
// adding, rewording, confirming and retiring. Every other screen shows these
// read-only (ClientRulesCallout) and links back here.

type Projects = Record<string, string>

export default function ClientRulesBoard({
  brandId, brandName, rules, people, projects, canEdit,
}: {
  brandId: string
  brandName: string
  /** Active and retired. */
  rules: RuleWithMentions[]
  people: Record<string, string>
  /** Project id → name, for linking where a rule was said. */
  projects: Projects
  canEdit: boolean
}) {
  const [area, setArea] = useState<RuleArea | 'all' | 'repeated'>('all')
  const [adding, setAdding] = useState(false)
  const [showRetired, setShowRetired] = useState(false)
  const active = rules.filter(r => r.status === 'active')
  const retired = rules.filter(r => r.status === 'retired')
  const repeated = active.filter(r => timesTold(r) > 1)
  const stale = active.filter(r => isStale(r))

  const counts = new Map<RuleArea, number>()
  active.forEach(r => counts.set(r.area, (counts.get(r.area) ?? 0) + 1))

  const shown = active
    .filter(r => area === 'all' || (area === 'repeated' ? timesTold(r) > 1 : r.area === area))
    .sort((a, b) => RULE_AREA_ORDER.indexOf(a.area) - RULE_AREA_ORDER.indexOf(b.area))

  return (
    <section id="client-rules" className="mo-panel" style={{ scrollMarginTop: 80 }}>
      <div className="bp-card-head">
        <div>
          <h2 className="mo-h2">Client feedback</h2>
          <p className="bp-purpose">
            What {brandName} has told us that applies to all future work. Built into their Brand DNA. Not for one-off comments, or anything already in their guidelines.
          </p>
        </div>
        {canEdit && !adding && <button className="btn-primary" style={{ fontSize: 14 }} onClick={() => setAdding(true)}>+ Add rule</button>}
      </div>

      <div className="bp-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {(repeated.length > 0 || stale.length > 0) && (
          <div className="cr-summary">
            {repeated.length > 0 && (
              <button className="cr-told cr-told-again" style={{ border: 'none', cursor: 'pointer' }} onClick={() => setArea('repeated')}>
                {repeated.length} {repeated.length === 1 ? 'rule' : 'rules'} the client had to repeat
              </button>
            )}
            {stale.length > 0 && <span className="cr-told" style={{ color: '#92400E', background: 'rgba(245,158,11,0.14)' }}>{stale.length} not checked in 6 months</span>}
          </div>
        )}

        {adding && (
          <RuleForm brandId={brandId} onDone={() => setAdding(false)} />
        )}

        {active.length > 0 && (
          <div className="mo-chips" role="group" aria-label="Filter by area">
            <button className="mo-chip" aria-pressed={area === 'all'} onClick={() => setArea('all')}>All · {active.length}</button>
            {RULE_AREA_ORDER.filter(a => counts.get(a)).map(a => (
              <button key={a} className="mo-chip" aria-pressed={area === a} onClick={() => setArea(a)}>
                {RULE_AREAS[a].label} · {counts.get(a)}
              </button>
            ))}
            {repeated.length > 0 && (
              <button className="mo-chip" aria-pressed={area === 'repeated'} onClick={() => setArea('repeated')}>Repeated · {repeated.length}</button>
            )}
          </div>
        )}

        {active.length === 0 && !adding ? (
          <p className="bp-empty">
            Nothing recorded yet. Add anything the client has said that should hold for every offer, page or ad: tone, banned words,
            imagery, discounts they will not run. You can also save a comment as a rule straight from a project&apos;s client feedback.
          </p>
        ) : (
          <ul className="cr-list">
            {shown.map(r => (
              <RuleItem key={r.id} rule={r} brandId={brandId} people={people} projects={projects} canEdit={canEdit} />
            ))}
          </ul>
        )}

        {retired.length > 0 && (
          <div>
            <button className="bp-link bp-link-muted" onClick={() => setShowRetired(v => !v)}>
              {showRetired ? 'Hide' : 'Show'} {retired.length} retired {retired.length === 1 ? 'rule' : 'rules'}
            </button>
            {showRetired && (
              <ul className="cr-list" style={{ marginTop: 8 }}>
                {retired.map(r => (
                  <RuleItem key={r.id} rule={r} brandId={brandId} people={people} projects={projects} canEdit={canEdit} />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

function RuleItem({ rule: r, brandId, people, projects, canEdit }: {
  rule: RuleWithMentions; brandId: string; people: Record<string, string>; projects: Projects; canEdit: boolean
}) {
  const router = useRouter()
  const [mode, setMode] = useState<'view' | 'edit' | 'retire'>('view')
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  const [pending, start] = useTransition()
  const n = timesTold(r)
  const retired = r.status === 'retired'
  const stale = !retired && isStale(r)

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => {
    setErr('')
    start(async () => {
      const res = await fn()
      if (!res.ok) { setErr(res.error ?? 'Could not save.'); return }
      after?.()
      router.refresh()
    })
  }

  if (mode === 'edit') {
    return (
      <li className="cr-item">
        <form
          className="bp-form"
          action={fd => run(() => updateClientRule(fd), () => setMode('view'))}
        >
          <input type="hidden" name="brand_id" value={brandId} />
          <input type="hidden" name="id" value={r.id} />
          <div>
            <label htmlFor={`rule-${r.id}`}>Rule</label>
            <textarea id={`rule-${r.id}`} name="rule" defaultValue={r.rule} rows={2} required />
          </div>
          <div className="bp-form-row">
            <div>
              <label htmlFor={`area-${r.id}`}>Applies to</label>
              <AreaSelect id={`area-${r.id}`} defaultValue={r.area} />
            </div>
            <div>
              <label htmlFor={`why-${r.id}`}>Their reason (optional)</label>
              <input id={`why-${r.id}`} name="why" defaultValue={r.why ?? ''} />
            </div>
          </div>
          {err && <p className="mo-error">{err}</p>}
          <div className="bp-actions">
            <button className="btn-primary" disabled={pending} style={{ fontSize: 14 }}>{pending ? 'Saving…' : 'Save'}</button>
            <button type="button" className="bp-link bp-link-muted" onClick={() => setMode('view')}>Cancel</button>
          </div>
        </form>
      </li>
    )
  }

  return (
    <li className={`cr-item${retired ? ' cr-retired' : ''}`}>
      <div className="cr-line">
        <span className="cr-area">{RULE_AREAS[r.area].label}</span>
        <span className="cr-rule">{r.rule}</span>
        {/* Only when they had to repeat it: "told us once" on every rule is noise. */}
        {n > 1 && (
          <span className="cr-told cr-told-again" title="They had to say this more than once">Told us {n}×</span>
        )}
      </div>
      {r.why && <p className="cr-why">Why: {r.why}</p>}
      {retired && <p className="cr-why">Retired {r.retired_at ? shortDate(r.retired_at) : ''}: {r.retired_reason}</p>}

      {stale && canEdit && (
        <div className="cr-stale">
          <span>Not checked since {shortDate(r.last_confirmed_at)}. Still true?</span>
          <button className="bp-link" disabled={pending} onClick={() => run(() => confirmClientRule(brandId, r.id))}>Yes, still true</button>
          <button className="bp-link bp-link-muted" onClick={() => setMode('retire')}>No longer applies</button>
        </div>
      )}

      {mode === 'retire' && (
        <form className="bp-actions" onSubmit={e => { e.preventDefault(); run(() => retireClientRule(brandId, r.id, reason), () => setMode('view')) }}>
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Why it no longer applies, e.g. client changed their mind on the Oct call" style={{ flex: '1 1 280px' }} autoFocus />
          <button className="btn-secondary" disabled={pending} style={{ fontSize: 14 }}>Retire</button>
          <button type="button" className="bp-link bp-link-muted" onClick={() => setMode('view')}>Cancel</button>
        </form>
      )}

      <div className="cr-meta">
        <span>Added {shortDate(r.created_at)}{r.created_by && people[r.created_by] ? ` by ${people[r.created_by]}` : ''}</span>
        {!retired && <span>Last confirmed {shortDate(r.last_confirmed_at)}</span>}
        {r.mentions.length > 0 && (
          <button className="bp-link bp-link-muted" style={{ fontSize: 13 }} onClick={() => setOpen(v => !v)}>
            {open ? 'Hide' : 'Show'} what they said
          </button>
        )}
        {canEdit && mode === 'view' && (
          retired ? (
            <button className="bp-link" style={{ fontSize: 13 }} disabled={pending} onClick={() => run(() => restoreClientRule(brandId, r.id))}>Restore</button>
          ) : (
            <>
              <button className="bp-link" style={{ fontSize: 13 }} onClick={() => setMode('edit')}>Edit</button>
              {!stale && <button className="bp-link bp-link-muted" style={{ fontSize: 13 }} onClick={() => setMode('retire')}>Retire</button>}
            </>
          )
        )}
      </div>
      {err && <p className="mo-error">{err}</p>}

      {open && (
        <ul className="cr-quotes">
          {r.mentions.map(m => (
            <li key={m.id}>
              {m.quote ? <q>{m.quote}</q> : <i>No quote recorded</i>}
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                {RULE_SOURCES[m.source]} · {shortDate(`${m.said_on}T12:00:00Z`)}
                {m.project_id && projects[m.project_id] && (
                  <> · <Link href={`/brands/${brandId}/projects/${m.project_id}`} className="bp-link" style={{ fontSize: 13 }}>{projects[m.project_id]}</Link></>
                )}
                {m.noted_by && people[m.noted_by] ? ` · noted by ${people[m.noted_by]}` : ''}
              </div>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

export function AreaSelect({ id, defaultValue = 'general' }: { id?: string; defaultValue?: RuleArea }) {
  return (
    <select id={id} name="area" defaultValue={defaultValue}>
      {RULE_AREA_ORDER.map(a => <option key={a} value={a}>{RULE_AREAS[a].label} · {RULE_AREAS[a].hint}</option>)}
    </select>
  )
}

/** New rule typed on the brand page, with where the client said it. */
function RuleForm({ brandId, onDone }: { brandId: string; onDone: () => void }) {
  const router = useRouter()
  const [err, setErr] = useState('')
  const [pending, start] = useTransition()
  const today = new Date().toISOString().slice(0, 10)
  return (
    <form
      className="bp-form cr-save-box"
      action={fd => {
        setErr('')
        start(async () => {
          const r = await addClientRule(fd)
          if (!r.ok) { setErr(r.error); return }
          onDone()
          router.refresh()
        })
      }}
    >
      <input type="hidden" name="brand_id" value={brandId} />
      <div>
        <label htmlFor="new-rule">Rule</label>
        <textarea id="new-rule" name="rule" rows={2} required autoFocus
          placeholder="Write it as an instruction for all future work, e.g. “Never show the bottle without its cap.”" />
      </div>
      <div className="bp-form-row">
        <div>
          <label htmlFor="new-area">Applies to</label>
          <AreaSelect id="new-area" />
        </div>
        <div>
          <label htmlFor="new-why">Their reason (optional)</label>
          <input id="new-why" name="why" placeholder="e.g. Retail partners complained" />
        </div>
      </div>
      <div className="bp-form-row">
        <div>
          <label htmlFor="new-source">Where they said it</label>
          <select id="new-source" name="source" defaultValue="call">
            {Object.entries(RULE_SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="new-date">When</label>
          <input id="new-date" type="date" name="said_on" defaultValue={today} max={today} />
        </div>
      </div>
      <div>
        <label htmlFor="new-quote">Their words (optional)</label>
        <textarea id="new-quote" name="quote" rows={2} placeholder="Paste or paraphrase what the client actually said." />
      </div>
      {err && <p className="mo-error">{err}</p>}
      <div className="bp-actions">
        <button className="btn-primary" disabled={pending} style={{ fontSize: 14 }}>{pending ? 'Saving…' : 'Save rule'}</button>
        <button type="button" className="bp-link bp-link-muted" onClick={onDone}>Cancel</button>
      </div>
    </form>
  )
}
