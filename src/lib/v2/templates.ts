// Prometheus 2.0: what a template holds, how it is checked, and how it turns
// into dated, assigned tasks for one piece of work. Pure functions, safe for
// server and browser: the create-work form previews with planWork() and the
// server action runs the same function again before saving.

import { DELIVERABLE_KINDS, isPodRole, type DeliverableKind, type PodRole } from './model'

export type TemplateDeliverable = {
  key: string
  kind: DeliverableKind
  label: string
  /** Can be left out when creating work (a test that is landing page only). */
  optional: boolean
}

export type TemplateTask = {
  key: string
  title: string
  /** Which deliverable it belongs to; null for work-wide tasks. */
  deliverable: string | null
  /** The pod role that does it; null when nobody in particular. */
  role: PodRole | null
  /** Due this many days before launch (0 = launch day, negative = after). Null = no date. */
  days_before_launch: number | null
  /** Subtask of this task (one level only). */
  parent: string | null
}

export type TemplateBody = { deliverables: TemplateDeliverable[]; tasks: TemplateTask[] }

export type WorkTemplate = TemplateBody & {
  id: string
  name: string
  description: string | null
  sort_order: number
  updated_at: string
}

export const LIMITS = { deliverables: 10, tasks: 200, title: 200, label: 80, days: 365 }

const KEY = /^[a-z0-9_]{1,60}$/
const isKind = (v: unknown): v is DeliverableKind => DELIVERABLE_KINDS.some(k => k.id === v)
const text = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')

/** Checks a template body from the editor (or the database) and returns it
 *  cleaned, in canonical order: work-wide tasks first, then each
 *  deliverable's tasks, each parent followed by its subtasks. */
export function parseTemplateBody(raw: { deliverables?: unknown; tasks?: unknown }): { ok: true; body: TemplateBody } | { ok: false; error: string } {
  const rawD = Array.isArray(raw.deliverables) ? raw.deliverables : []
  const rawT = Array.isArray(raw.tasks) ? raw.tasks : []
  if (rawD.length > LIMITS.deliverables) return { ok: false, error: `A template can have up to ${LIMITS.deliverables} deliverables.` }
  if (rawT.length > LIMITS.tasks) return { ok: false, error: `A template can have up to ${LIMITS.tasks} tasks.` }

  const deliverables: TemplateDeliverable[] = []
  for (const d of rawD as Record<string, unknown>[]) {
    const key = text(d?.key), label = text(d?.label)
    if (!KEY.test(key) || deliverables.some(x => x.key === key)) return { ok: false, error: 'Two deliverables got mixed up. Reload and try again.' }
    if (!isKind(d.kind)) return { ok: false, error: 'Pick what each deliverable is.' }
    if (!label || label.length > LIMITS.label) return { ok: false, error: `Give every deliverable a name (up to ${LIMITS.label} characters).` }
    deliverables.push({ key, kind: d.kind, label, optional: d.optional === true })
  }

  const tasks: TemplateTask[] = []
  for (const t of rawT as Record<string, unknown>[]) {
    const key = text(t?.key), title = text(t?.title)
    if (!KEY.test(key) || tasks.some(x => x.key === key)) return { ok: false, error: 'Two tasks got mixed up. Reload and try again.' }
    if (!title) return { ok: false, error: 'Every task needs a name.' }
    if (title.length > LIMITS.title) return { ok: false, error: `Keep task names under ${LIMITS.title} characters.` }
    const deliverable = t.deliverable == null || t.deliverable === '' ? null : text(t.deliverable)
    if (deliverable !== null && !deliverables.some(d => d.key === deliverable)) return { ok: false, error: `"${title}" belongs to a deliverable that was removed.` }
    const role = t.role == null || t.role === '' ? null : t.role
    if (role !== null && !isPodRole(role)) return { ok: false, error: `Pick who does "${title}".` }
    const daysRaw = t.days_before_launch
    const days = daysRaw == null || daysRaw === '' ? null : Number(daysRaw)
    if (days !== null && (!Number.isInteger(days) || Math.abs(days) > LIMITS.days)) {
      return { ok: false, error: `"${title}": days before launch must be a whole number up to ${LIMITS.days}.` }
    }
    const parent = t.parent == null || t.parent === '' ? null : text(t.parent)
    tasks.push({ key, title, deliverable, role, days_before_launch: days, parent })
  }
  for (const t of tasks) {
    if (t.parent === null) continue
    const p = tasks.find(x => x.key === t.parent)
    if (!p || p.parent !== null) return { ok: false, error: `"${t.title}" is a subtask of a task that was removed.` }
    // A subtask always sits with its parent.
    t.deliverable = p.deliverable
  }

  // Canonical order. Relative order within each group is kept as given.
  const sections: (string | null)[] = [null, ...deliverables.map(d => d.key)]
  const ordered: TemplateTask[] = []
  for (const s of sections) {
    for (const top of tasks.filter(t => t.parent === null && t.deliverable === s)) {
      ordered.push(top, ...tasks.filter(t => t.parent === top.key))
    }
  }
  return { ok: true, body: { deliverables, tasks: ordered } }
}

/** A template row from the database. A malformed body shows as empty rather
 *  than breaking the page. */
export function readTemplate(row: Record<string, unknown>): WorkTemplate {
  const parsed = parseTemplateBody({ deliverables: row.deliverables, tasks: row.tasks })
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    description: typeof row.description === 'string' ? row.description : null,
    sort_order: Number(row.sort_order ?? 0),
    updated_at: String(row.updated_at ?? ''),
    ...(parsed.ok ? parsed.body : { deliverables: [], tasks: [] }),
  }
}

// ── dates ──────────────────────────────────────────────────────────────────
// Work dates are calendar days ('YYYY-MM-DD'), computed in UTC so they never
// shift across timezones.

export const isIsoDate = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))

export function addDays(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

/** Saturday and Sunday move back to the Friday before. */
export function weekdayOnOrBefore(iso: string): string {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay()
  return day === 6 ? addDays(iso, -1) : day === 0 ? addDays(iso, -2) : iso
}

export function dueDateFor(launch: string, daysBefore: number | null): string | null {
  return daysBefore === null ? null : weekdayOnOrBefore(addDays(launch, -daysBefore))
}

export function formatDay(iso: string | null): string {
  if (!iso) return 'No date'
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${iso}T00:00:00Z`))
}

// ── planning ───────────────────────────────────────────────────────────────

export type PlannedTask = {
  key: string
  title: string
  deliverable: string | null
  parent: string | null
  role: PodRole | null
  owner_id: string | null
  due_date: string | null
}

export type WorkPlan = {
  deliverables: TemplateDeliverable[]
  tasks: PlannedTask[]
  /** Roles the included tasks need, in pod order. */
  roles: PodRole[]
}

/** The deliverables and tasks a piece of work starts with. `include` lists the
 *  optional deliverables to keep; required ones are always kept. `assign` says
 *  who fills each role (null = nobody yet). */
export function planWork(
  body: TemplateBody,
  opts: { include: string[]; launch: string; assign: Partial<Record<PodRole, string | null>> },
): WorkPlan {
  const deliverables = body.deliverables.filter(d => !d.optional || opts.include.includes(d.key))
  const kept = new Set(deliverables.map(d => d.key))
  const tasks = body.tasks
    .filter(t => t.deliverable === null || kept.has(t.deliverable))
    .map(t => ({
      key: t.key,
      title: t.title,
      deliverable: t.deliverable,
      parent: t.parent,
      role: t.role,
      owner_id: t.role ? opts.assign[t.role] ?? null : null,
      due_date: dueDateFor(opts.launch, t.days_before_launch),
    }))
  const order: PodRole[] = ['account_manager', 'designer', 'lp_builder']
  const roles = order.filter(r => tasks.some(t => t.role === r))
  return { deliverables, tasks, roles }
}

/** A fresh key for something added in the editor. */
export function newKey(prefix: 't' | 'd'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}
