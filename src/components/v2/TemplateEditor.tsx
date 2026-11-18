'use client'
// Prometheus 2.0: the template editor. Everything is edited locally and saved
// in one go, so a half-edited template is never what new work gets made from.

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'
import { useConfirm } from '@/components/ConfirmDialog'
import { archiveTemplate, createTemplate, saveTemplate } from '@/lib/v2/template-actions'
import { DELIVERABLE_KINDS, POD_ROLES, deliverableLabel, type DeliverableKind, type PodRole } from '@/lib/v2/model'
import {
  addDays, dueDateFor, formatDay, newKey, parseTemplateBody,
  type TemplateDeliverable, type TemplateTask, type WorkTemplate,
} from '@/lib/v2/templates'
import { easternToday } from '@/lib/eastern'
import styles from './v2.module.css'

// ── create ─────────────────────────────────────────────────────────────────

export function CreateTemplateForm({ templates }: { templates: { id: string; name: string }[] }) {
  const [name, setName] = useState('')
  const [from, setFrom] = useState('')
  const [pending, start] = useTransition()
  const toast = useToast()
  const router = useRouter()
  return (
    <form
      className={styles.inline}
      onSubmit={e => {
        e.preventDefault()
        start(async () => {
          const res = await createTemplate(name, from || null)
          if (!res.ok) { toast.error(res.error); return }
          router.push(`/v2/templates/${res.id}`)
        })
      }}
    >
      <label htmlFor="new-template" className={styles.srOnly}>New template name</label>
      <input id="new-template" className={styles.input} value={name} onChange={e => setName(e.target.value)} placeholder="New template, e.g. Landing page refresh" maxLength={80} required />
      <label htmlFor="new-template-from" className={styles.srOnly}>Start from</label>
      <select id="new-template-from" className={styles.input} value={from} onChange={e => setFrom(e.target.value)}>
        <option value="">Start blank</option>
        {templates.map(t => <option key={t.id} value={t.id}>Copy of {t.name}</option>)}
      </select>
      <button type="submit" className="btn-primary" disabled={pending || !name.trim()}>{pending ? 'Creating…' : 'Create template'}</button>
    </form>
  )
}

// ── edit ───────────────────────────────────────────────────────────────────

/** Keeps the flat task list in the order it is shown: work-wide tasks first,
 *  then each deliverable's, each parent followed by its subtasks. */
function ordered(deliverables: TemplateDeliverable[], tasks: TemplateTask[]): TemplateTask[] {
  const out: TemplateTask[] = []
  for (const s of [null, ...deliverables.map(d => d.key)]) {
    for (const top of tasks.filter(t => t.parent === null && t.deliverable === s)) {
      out.push(top, ...tasks.filter(t => t.parent === top.key))
    }
  }
  return out
}

const sampleLaunch = () => addDays(easternToday(), 30)

export default function TemplateEditor({ template, archived }: { template: WorkTemplate; archived: boolean }) {
  const [name, setName] = useState(template.name)
  const [description, setDescription] = useState(template.description ?? '')
  const [deliverables, setDeliverables] = useState<TemplateDeliverable[]>(template.deliverables)
  const [tasks, setTasks] = useState<TemplateTask[]>(template.tasks)
  const [updatedAt, setUpdatedAt] = useState(template.updated_at)
  const [launch, setLaunch] = useState(sampleLaunch)
  const [pending, start] = useTransition()
  const toast = useToast()
  const confirm = useConfirm()
  const router = useRouter()

  const saved = useMemo(() => JSON.stringify([template.name, template.description ?? '', template.deliverables, template.tasks]), [template])
  const dirty = JSON.stringify([name, description, deliverables, tasks]) !== saved

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const setTask = (key: string, patch: Partial<TemplateTask>) =>
    setTasks(ts => ts.map(t => (t.key === key ? { ...t, ...patch } : t)))

  const addTask = (deliverable: string | null, parent: string | null) => {
    const p = parent ? tasks.find(t => t.key === parent) : null
    const task: TemplateTask = {
      key: newKey('t'), title: '', deliverable, parent,
      role: p?.role ?? (deliverable ? defaultRole(deliverables.find(d => d.key === deliverable)?.kind) : 'account_manager'),
      days_before_launch: p?.days_before_launch ?? null,
    }
    setTasks(ts => {
      const next = [...ts]
      // New subtasks go after the parent's last subtask; new tasks at the end of their section.
      const at = parent
        ? Math.max(next.findIndex(t => t.key === parent), ...next.map((t, i) => (t.parent === parent ? i : -1))) + 1
        : next.length
      next.splice(at, 0, task)
      return ordered(deliverables, next)
    })
  }

  const removeTask = (key: string) => setTasks(ts => ts.filter(t => t.key !== key && t.parent !== key))

  const moveTask = (key: string, dir: -1 | 1) => setTasks(ts => {
    const t = ts.find(x => x.key === key)
    if (!t) return ts
    const siblings = ts.filter(x => x.parent === t.parent && x.deliverable === t.deliverable)
    const j = siblings.findIndex(x => x.key === key) + dir
    if (j < 0 || j >= siblings.length) return ts
    const a = ts.indexOf(t), b = ts.indexOf(siblings[j])
    const next = [...ts]
    ;[next[a], next[b]] = [next[b], next[a]]
    return ordered(deliverables, next)
  })

  const addDeliverable = () => {
    const kind: DeliverableKind = deliverables.some(d => d.kind === 'landing_page') ? 'creative_set' : 'landing_page'
    setDeliverables(ds => [...ds, { key: newKey('d'), kind, label: deliverableLabel(kind), optional: true }])
  }

  const removeDeliverable = async (d: TemplateDeliverable) => {
    const count = tasks.filter(t => t.deliverable === d.key).length
    if (count) {
      const ok = await confirm({
        title: `Remove ${d.label}?`,
        message: `Its ${count} task${count === 1 ? '' : 's'} go with it. Nothing changes until you save.`,
        confirmLabel: 'Remove',
        danger: true,
      })
      if (!ok) return
    }
    const ds = deliverables.filter(x => x.key !== d.key)
    setDeliverables(ds)
    setTasks(ts => ordered(ds, ts.filter(t => t.deliverable !== d.key)))
  }

  const moveDeliverable = (key: string, dir: -1 | 1) => {
    const i = deliverables.findIndex(d => d.key === key), j = i + dir
    if (j < 0 || j >= deliverables.length) return
    const ds = [...deliverables]
    ;[ds[i], ds[j]] = [ds[j], ds[i]]
    setDeliverables(ds)
    setTasks(ts => ordered(ds, ts))
  }

  const save = () => {
    const check = parseTemplateBody({ deliverables, tasks })
    if (!check.ok) { toast.error(check.error); return }
    start(async () => {
      const res = await saveTemplate(template.id, { name, description, deliverables, tasks, updatedAt })
      if (!res.ok) { toast.error(res.error); return }
      setUpdatedAt(res.updatedAt)
      toast.success('Template saved. New work uses it from now on.')
      router.refresh()
    })
  }

  const archive = async () => {
    const ok = await confirm({
      title: `Archive ${template.name}?`,
      message: 'It disappears from the template list and the create-work form. Work already made from it is not affected.',
      confirmLabel: 'Archive template',
      danger: true,
    })
    if (!ok) return
    start(async () => {
      const res = await archiveTemplate(template.id)
      if (!res.ok) { toast.error(res.error); return }
      toast.success(`${template.name} archived.`)
      router.push('/v2/templates')
    })
  }

  const sections: { key: string | null; deliverable: TemplateDeliverable | null }[] = [
    { key: null, deliverable: null },
    ...deliverables.map(d => ({ key: d.key, deliverable: d })),
  ]

  return (
    <>
      <div className={styles.saveBar}>
        <div className={styles.inline}>
          <label htmlFor="tpl-name" className={styles.srOnly}>Template name</label>
          <input id="tpl-name" className={`${styles.input} ${styles.titleInput}`} value={name} onChange={e => setName(e.target.value)} maxLength={80} disabled={archived} />
          {dirty && <span className={styles.warn}>Unsaved changes</span>}
        </div>
        {!archived && (
          <div className={styles.inline}>
            <button type="button" className="btn-danger btn-sm" onClick={archive} disabled={pending}>Archive</button>
            <button type="button" className="btn-primary" onClick={save} disabled={pending || !dirty}>{pending ? 'Saving…' : 'Save template'}</button>
          </div>
        )}
      </div>

      <label className={styles.stack}>
        <span className={styles.muted}>What it&apos;s for (shown when picking a template)</span>
        <textarea className={styles.input} rows={2} value={description} onChange={e => setDescription(e.target.value)} maxLength={2000} disabled={archived} />
      </label>

      <div className={`card ${styles.inline}`}>
        <label htmlFor="tpl-launch" className={styles.muted}>See the dates for a launch on</label>
        <input id="tpl-launch" type="date" className={styles.input} value={launch} onChange={e => setLaunch(e.target.value || sampleLaunch())} />
        <span className={styles.muted}>Weekends move to the Friday before.</span>
      </div>

      <fieldset disabled={archived} className={styles.fieldset}>
        {sections.map(({ key, deliverable: d }, si) => {
          const top = tasks.filter(t => t.parent === null && t.deliverable === key)
          if (!d && top.length === 0 && deliverables.length > 0) {
            return (
              <div key="general" className={styles.inline}>
                <button type="button" className="btn-secondary btn-sm" onClick={() => addTask(null, null)}>Add a task for the whole piece of work</button>
                <span className={styles.muted}>For steps that aren&apos;t part of one deliverable, like a kickoff call.</span>
              </div>
            )
          }
          return (
            <section key={key ?? 'general'} className={`card ${styles.panel}`} aria-label={d ? d.label : 'Whole piece of work'}>
              {d ? (
                <div className={styles.spread}>
                  <div className={styles.inline}>
                    <label className={styles.srOnly} htmlFor={`d-label-${d.key}`}>Deliverable name</label>
                    <input id={`d-label-${d.key}`} className={`${styles.input} ${styles.h2Input}`} value={d.label} maxLength={80}
                      onChange={e => setDeliverables(ds => ds.map(x => (x.key === d.key ? { ...x, label: e.target.value } : x)))} />
                    <label className={styles.srOnly} htmlFor={`d-kind-${d.key}`}>What it is</label>
                    <select id={`d-kind-${d.key}`} className={styles.input} value={d.kind}
                      onChange={e => setDeliverables(ds => ds.map(x => (x.key === d.key ? { ...x, kind: e.target.value as DeliverableKind } : x)))}>
                      {DELIVERABLE_KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
                    </select>
                    <label className={styles.check}>
                      <input type="checkbox" checked={d.optional}
                        onChange={e => setDeliverables(ds => ds.map(x => (x.key === d.key ? { ...x, optional: e.target.checked } : x)))} />
                      Optional: can be left out when creating work
                    </label>
                  </div>
                  <div className={styles.inline}>
                    <button type="button" className="btn-secondary btn-sm" aria-label={`Move ${d.label} up`} disabled={si <= 1} onClick={() => moveDeliverable(d.key, -1)}>↑</button>
                    <button type="button" className="btn-secondary btn-sm" aria-label={`Move ${d.label} down`} disabled={si === sections.length - 1} onClick={() => moveDeliverable(d.key, 1)}>↓</button>
                    <button type="button" className="btn-danger btn-sm" onClick={() => removeDeliverable(d)}>Remove</button>
                  </div>
                </div>
              ) : (
                <div>
                  <h2 className={styles.h2}>Whole piece of work</h2>
                  <p className={styles.muted}>Steps that aren&apos;t part of one deliverable.</p>
                </div>
              )}

              {top.length > 0 && (
                <div className={styles.taskTable} role="table" aria-label={`${d ? d.label : 'Work-wide'} tasks`}>
                  <div className={styles.taskHead} role="row">
                    <span role="columnheader">Task</span>
                    <span role="columnheader">Who</span>
                    <span role="columnheader">Days before launch</span>
                    <span role="columnheader">Due</span>
                    <span role="columnheader"><span className={styles.srOnly}>Actions</span></span>
                  </div>
                  {top.flatMap((t, ti) => [t, ...tasks.filter(s => s.parent === t.key)].map(row => {
                    const isSub = row.parent !== null
                    const sibs = isSub ? tasks.filter(s => s.parent === row.parent) : top
                    const pos = isSub ? sibs.indexOf(row) : ti
                    const due = dueDateFor(launch, row.days_before_launch)
                    return (
                      <div key={row.key} className={`${styles.taskRow} ${isSub ? styles.subRow : ''}`} role="row">
                        <span role="cell">
                          <label className={styles.srOnly} htmlFor={`t-${row.key}`}>{isSub ? 'Subtask' : 'Task'} name</label>
                          <input id={`t-${row.key}`} className={styles.input} value={row.title} maxLength={200}
                            placeholder={isSub ? 'Subtask, e.g. a check to tick off' : 'What needs doing'}
                            onChange={e => setTask(row.key, { title: e.target.value })} />
                        </span>
                        <span role="cell">
                          <label className={styles.srOnly} htmlFor={`r-${row.key}`}>Who does it</label>
                          <select id={`r-${row.key}`} className={styles.input} value={row.role ?? ''}
                            onChange={e => setTask(row.key, { role: (e.target.value || null) as PodRole | null })}>
                            {POD_ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                            <option value="">Nobody in particular</option>
                          </select>
                        </span>
                        <span role="cell">
                          <label className={styles.srOnly} htmlFor={`days-${row.key}`}>Days before launch</label>
                          <input id={`days-${row.key}`} type="number" inputMode="numeric" className={`${styles.input} ${styles.days}`} min={-365} max={365} step={1}
                            value={row.days_before_launch ?? ''} placeholder="—"
                            onChange={e => setTask(row.key, { days_before_launch: e.target.value === '' ? null : Math.trunc(Number(e.target.value)) })} />
                        </span>
                        <span role="cell" className={styles.muted}>{due ? formatDay(due) : 'No date'}</span>
                        <span role="cell" className={styles.rowActions}>
                          <button type="button" className="btn-secondary btn-sm" aria-label={`Move ${row.title || 'task'} up`} disabled={pos === 0} onClick={() => moveTask(row.key, -1)}>↑</button>
                          <button type="button" className="btn-secondary btn-sm" aria-label={`Move ${row.title || 'task'} down`} disabled={pos === sibs.length - 1} onClick={() => moveTask(row.key, 1)}>↓</button>
                          {!isSub && <button type="button" className="btn-secondary btn-sm" onClick={() => addTask(row.deliverable, row.key)}>+ Subtask</button>}
                          <button type="button" className="btn-danger btn-sm" aria-label={`Remove ${row.title || 'task'}`} onClick={() => removeTask(row.key)}>✕</button>
                        </span>
                      </div>
                    )
                  }))}
                </div>
              )}
              <div>
                <button type="button" className="btn-secondary btn-sm" onClick={() => addTask(key, null)}>Add a task{d ? ` to ${d.label}` : ''}</button>
              </div>
            </section>
          )
        })}
        <div>
          <button type="button" className="btn-secondary" onClick={addDeliverable} disabled={deliverables.length >= 10}>Add a deliverable</button>
        </div>
      </fieldset>
    </>
  )
}

function defaultRole(kind: DeliverableKind | undefined): PodRole {
  return kind === 'landing_page' ? 'lp_builder' : kind === 'creative_set' ? 'designer' : 'account_manager'
}
