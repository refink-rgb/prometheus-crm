'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Avatar from '@/components/Avatar'
import { DEFAULT_STEPS, KIND_CATEGORIES, STEP_STATUSES, effectiveStatus, isClosed, planKeyCount, productionCounts, stepStatusLabel, type Person, type TaskNode } from '@/lib/bfcm/production'
import type { Allocation } from '@/lib/bfcm/model'
import type { BfcmComment, BrandContract, Calibration, CalibrationFeedback, CalibrationItem, CalibrationTrackState } from '@/lib/bfcm/production-server'
import { addTask, deleteTask, setTaskAssignees, setupProductionSteps, splitTaskByPlan, updateTask } from '@/lib/bfcm/production-actions'
import BfcmComments from './BfcmComments'
import BfcmCalibrationStaff from './BfcmCalibrationStaff'
import BfcmContract from './BfcmContract'
import s from './BfcmProduction.module.css'

type Plan = { allocation: Allocation; prePercent: number; noPreBf: boolean; locked: boolean }
type CalibrationData = { calibration: Calibration | null; tracks: CalibrationTrackState[]; items: CalibrationItem[]; feedback: CalibrationFeedback[] } | null
type Props = {
  slug: string; brandName: string; tasks: TaskNode[] | null; comments: BfcmComment[]; people: Person[]; meId: string | null; plan: Plan; today: string
  calibration: CalibrationData; brandId: string | null; contracts: BrandContract[] | null; documents: { id: string; file_name: string }[]
}
type Ctx = Omit<Props, 'tasks' | 'brandId' | 'contracts' | 'documents'> & {
  expanded: Set<string>; toggle: (id: string) => void; run: (action: () => Promise<{ ok: boolean; error?: string }>) => Promise<boolean>; busy: boolean; revisions: string | null
}

/** Staff-only: the work after the plan. Each change saves on its own. */
export default function BfcmProduction(props: Props) {
  const { slug, tasks, comments, people, meId, plan, brandId, contracts, documents } = props
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [newTask, setNewTask] = useState('')

  // A notification links to #task-<id>, #calibration or #team-thread: open that task and scroll to it.
  useEffect(() => {
    const hash = window.location.hash.slice(1)
    if (!hash || !tasks) return
    const all = tasks.flatMap(t => [t, ...t.children])
    const target = hash === 'calibration' ? tasks.find(t => t.kind === 'samples') : all.find(t => `task-${t.id}` === hash)
    if (target) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the URL hash once after hydration
      setExpanded(new Set([target.id, ...(target.parent_id ? [target.parent_id] : [])]))
    }
    requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView({ block: 'center' }))
  }, [tasks])

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true); setError('')
    const result = await action()
    if (!result.ok) setError(result.error ?? 'Unable to save.')
    router.refresh()
    setBusy(false)
    return result.ok
  }
  const toggle = (id: string) => setExpanded(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })

  if (tasks === null) return <section className={s.section}><div className={s.header}><h2 className={s.title}>Production</h2></div><p className={s.hint}>Production is unavailable right now. The plan below is unaffected.</p></section>

  const revisions = contracts?.find(c => c.revisions.trim())?.revisions ?? null
  const ctx: Ctx = { ...props, expanded, toggle, run, busy, revisions }
  const done = tasks.filter(t => isClosed(effectiveStatus(t))).length
  const missing = DEFAULT_STEPS.filter(d => !tasks.some(t => t.kind === d.kind))
  const teamComments = comments.filter(c => !c.step_id)

  return <section className={s.section} aria-label="Production">
    <div className={s.header}>
      <h2 className={s.title}>Production</h2>
      {tasks.length > 0 && <span className={s.muted}>{done} of {tasks.length} done</span>}
    </div>
    {!plan.locked && tasks.length > 0 && <p className={s.hint}>The plan isn’t locked yet, so the counts below can still change.</p>}
    <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
      <BfcmContract brandId={brandId} contracts={contracts} documents={documents} />
    </div>
    <div className={s.list} role="list">
      {tasks.map(task => <TaskBlock key={task.id} node={task} ctx={ctx} />)}
    </div>
    <div className={s.footer}>
      {missing.length > 0 && <button className={tasks.length ? 'btn-secondary btn-sm' : 'btn-primary btn-sm'} disabled={busy} onClick={() => void run(() => setupProductionSteps(slug))}>
        {tasks.length === 0 ? 'Add production tasks' : `Add back: ${missing.map(m => m.title).join(', ')}`}
      </button>}
      <form className={s.inline} style={{ flex: 1 }} onSubmit={e => { e.preventDefault(); if (newTask.trim()) void run(() => addTask(slug, null, newTask)).then(ok => { if (ok) setNewTask('') }) }}>
        <input className={s.input} value={newTask} onChange={e => setNewTask(e.target.value)} placeholder="Add a task for this brand…" aria-label="New task" disabled={busy} />
        <button className="btn-secondary btn-sm" disabled={busy || !newTask.trim()}>Add</button>
      </form>
    </div>
    <div id="team-thread" style={{ padding: '14px 18px', borderTop: '1px solid var(--border)' }}>
      <p className={s.panelTitle}>Team thread</p>
      <BfcmComments slug={slug} stepId={null} comments={teamComments} people={people} meId={meId} placeholder="Message the team about this brand. Type @ to mention someone." />
    </div>
    {error && <p role="alert" className={s.error}>{error}</p>}
  </section>
}

/** A task, its subtasks when open, and its panel (subtask tools, comments, calibration). */
function TaskBlock({ node, ctx }: { node: TaskNode; ctx: Ctx }) {
  const open = ctx.expanded.has(node.id)
  return <>
    <TaskRow node={node} ctx={ctx} sub={false} />
    {open && node.children.map(child => <div key={child.id}>
      <TaskRow node={child} ctx={ctx} sub />
      {ctx.expanded.has(child.id) && <TaskPanel node={child} ctx={ctx} sub />}
    </div>)}
    {open && <TaskPanel node={node} ctx={ctx} sub={false} />}
  </>
}

function TaskRow({ node, ctx, sub }: { node: TaskNode; ctx: Ctx; sub: boolean }) {
  const { slug, people, plan, today, busy, run } = ctx
  const [renaming, setRenaming] = useState(false)
  const [menu, setMenu] = useState(false)
  const status = effectiveStatus(node)
  const derived = node.children.length > 0
  const late = !!node.due_date && !isClosed(status) && node.due_date < today
  const known = STEP_STATUSES.some(st => st.id === status)
  const counts = productionCounts(plan.allocation)
  const linked = planKeyCount(node.plan_key, plan)
  const meta = [
    !sub && node.kind === 'statics' ? `${counts.statics.total} statics · ${counts.statics.detail}` : null,
    !sub && node.kind === 'motion' ? `${counts.motion.total} motion · ${counts.motion.detail}` : null,
    linked !== null ? `${linked} ads${linked === 0 ? ' (the plan has none here now)' : ''}` : null,
    derived ? `${node.children.filter(c => isClosed(effectiveStatus(c))).length}/${node.children.length} subtasks` : null,
  ].filter(Boolean).join(' · ')
  const canSplit = !sub && !!KIND_CATEGORIES[node.kind]

  return <div id={`task-${node.id}`} role="listitem" className={`${s.row} ${sub ? s.sub : ''} ${isClosed(status) ? s.done : ''}`}>
    <button className={s.chev} aria-expanded={ctx.expanded.has(node.id)} aria-label={`Open ${node.title}`} onClick={() => ctx.toggle(node.id)}>▶</button>
    <div className={s.main}>
      <select className={`${s.status} ${s[`s-${status}`] ?? ''}`} value={status} disabled={busy || derived} title={derived ? 'Follows its subtasks' : undefined} aria-label={`Status: ${node.title}`}
        onChange={e => void run(() => updateTask(slug, node.id, { status: e.target.value }))}>
        {!known && <option value={status}>{stepStatusLabel(status)}</option>}
        {STEP_STATUSES.map(st => <option key={st.id} value={st.id}>{st.label}</option>)}
      </select>
      <div className={s.nameBlock}>
        {renaming
          ? <RenameInput initial={node.title} onDone={title => { setRenaming(false); if (title && title !== node.title) void run(() => updateTask(slug, node.id, { title })) }} />
          : <button className={s.name} onClick={() => ctx.toggle(node.id)} title={node.title}>{node.title}</button>}
        {meta && <span className={s.meta}>{meta}</span>}
      </div>
    </div>
    <AssigneePicker people={people} selected={node.assignees} disabled={busy} title={node.title} onChange={ids => void run(() => setTaskAssignees(slug, node.id, ids))} />
    <span className={s.dueCell}>
      <input type="date" className={`${s.due} ${late ? s.late : ''}`} value={node.due_date ?? ''} disabled={busy} aria-label={`Due: ${node.title}`} title={late ? 'Late' : 'Due date'}
        onChange={e => void run(() => updateTask(slug, node.id, { due_date: e.target.value || null }))} />
    </span>
    <button className={s.count} style={{ border: 0, background: 'none', cursor: 'pointer' }} onClick={() => ctx.toggle(node.id)} aria-label={`${node.commentCount} comments`} title="Comments">💬 {node.commentCount || ''}</button>
    <div className={s.menuWrap}>
      <button className={s.menuBtn} aria-label={`More for ${node.title}`} aria-expanded={menu} onClick={() => setMenu(m => !m)}>⋯</button>
      {menu && <div className={s.menu} role="menu" onMouseLeave={() => setMenu(false)}>
        <button role="menuitem" onClick={() => { setMenu(false); setRenaming(true) }}>Rename</button>
        {!sub && <button role="menuitem" onClick={() => { setMenu(false); if (!ctx.expanded.has(node.id)) ctx.toggle(node.id) }}>Add subtask</button>}
        {canSplit && <button role="menuitem" onClick={() => { setMenu(false); void run(() => splitTaskByPlan(slug, node.id)).then(ok => { if (ok && !ctx.expanded.has(node.id)) ctx.toggle(node.id) }) }}>Split by plan</button>}
        <button role="menuitem" className={s.danger} onClick={() => { setMenu(false); if (window.confirm(`Remove “${node.title}”${node.children.length ? ` and its ${node.children.length} subtasks` : ''}? Its comments go too.`)) void run(() => deleteTask(slug, node.id)) }}>Remove</button>
      </div>}
    </div>
  </div>
}

function TaskPanel({ node, ctx, sub }: { node: TaskNode; ctx: Ctx; sub: boolean }) {
  const { slug, busy, run } = ctx
  const [title, setTitle] = useState('')
  const canSplit = !sub && !!KIND_CATEGORIES[node.kind]
  const split = node.children.some(c => c.plan_key)
  return <div className={`${s.panel} ${sub ? s.panelSub : ''}`}>
    {!sub && <div>
      <p className={s.panelTitle}>Subtasks</p>
      <form className={s.inline} onSubmit={e => { e.preventDefault(); if (title.trim()) void run(() => addTask(slug, node.id, title)).then(ok => { if (ok) setTitle('') }) }}>
        <input className={s.input} value={title} onChange={e => setTitle(e.target.value)} placeholder="Add a subtask…" aria-label={`New subtask for ${node.title}`} disabled={busy} />
        <button className="btn-secondary btn-sm" disabled={busy || !title.trim()}>Add</button>
        {canSplit && <button type="button" className="btn-secondary btn-sm" disabled={busy} title="One subtask per category and phase, with counts read from the plan" onClick={() => void run(() => splitTaskByPlan(slug, node.id))}>{split ? 'Add missing from plan' : 'Split by plan'}</button>}
      </form>
    </div>}
    {node.kind === 'samples' && !sub && <BfcmCalibrationStaff slug={slug} brandName={ctx.brandName} data={ctx.calibration} revisions={ctx.revisions} />}
    <div>
      <p className={s.panelTitle}>Comments</p>
      <BfcmComments slug={slug} stepId={node.id} comments={ctx.comments.filter(c => c.step_id === node.id)} people={ctx.people} meId={ctx.meId} placeholder="Comment for the team. Type @ to mention someone." />
    </div>
  </div>
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (title: string) => void }) {
  const [value, setValue] = useState(initial)
  return <input className={s.nameInput} autoFocus value={value} maxLength={120} aria-label="Task name" onChange={e => setValue(e.target.value)}
    onBlur={() => onDone(value.trim())} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') onDone(initial) }} />
}

/** Avatars of everyone on the task; click to add or remove people. */
function AssigneePicker({ people, selected, disabled, title, onChange }: { people: Person[]; selected: string[]; disabled: boolean; title: string; onChange: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const byId = useMemo(() => new Map(people.map(p => [p.id, p])), [people])
  const chosen = selected.map(id => byId.get(id)).filter((p): p is Person => !!p)
  const options = people.filter(p => p.name.toLowerCase().includes(query.toLowerCase()))
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  return <div className={s.people} ref={ref}>
    <button className={s.stack} disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-label={`People on ${title}: ${chosen.map(p => p.name).join(', ') || 'nobody'}`} onClick={() => setOpen(o => !o)}>
      {chosen.slice(0, 4).map(p => <Avatar key={p.id} name={p.name} size={24} title={p.name} />)}
      {chosen.length > 4 && <span className={s.meta} style={{ marginLeft: 4 }}>+{chosen.length - 4}</span>}
      {chosen.length === 0 && <span className={s.addPerson}>+</span>}
    </button>
    {open && <div className={s.popover} role="listbox" aria-multiselectable>
      <input className={s.search} autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a teammate" aria-label="Find a teammate" />
      {options.map(p => {
        const on = selected.includes(p.id)
        return <button key={p.id} role="option" aria-selected={on} className={s.option} disabled={disabled} onClick={() => onChange(on ? selected.filter(id => id !== p.id) : [...selected, p.id])}>
          <Avatar name={p.name} size={22} />{p.name}{on && <span className={s.check}>✓</span>}
        </button>
      })}
      {options.length === 0 && <p className={s.muted} style={{ margin: 8 }}>No one matches.</p>}
    </div>}
  </div>
}
