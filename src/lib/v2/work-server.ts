// Prometheus 2.0: reads for the templates and work screens. Server only.

import type { createClient } from '@/lib/supabase/server'
import { getCachedProfiles } from '@/lib/profiles'
import { profileName } from '@/lib/types'
import { easternToday } from '@/lib/eastern'
import { MISSING_TABLE, MISSING_COLUMN, isClosedTask } from './model'
import { readTemplate, type WorkTemplate } from './templates'

type Supabase = Awaited<ReturnType<typeof createClient>>
type DbError = { code?: string } | null

const missing = (...errors: DbError[]) =>
  errors.some(e => e && (MISSING_TABLE.has(e.code ?? '') || MISSING_COLUMN.has(e.code ?? '')))

export async function loadTemplates(supabase: Supabase): Promise<WorkTemplate[] | null> {
  const { data, error } = await supabase.from('work_templates').select('*').is('archived_at', null)
    .order('sort_order').order('name')
  if (missing(error)) return null
  return (data ?? []).map(readTemplate)
}

export async function loadTemplate(supabase: Supabase, id: string): Promise<{ missing: true } | { missing: false; template: WorkTemplate | null; archived: boolean }> {
  const { data, error } = await supabase.from('work_templates').select('*').eq('id', id).maybeSingle()
  if (missing(error)) return { missing: true }
  return { missing: false, template: data ? readTemplate(data) : null, archived: !!data?.archived_at }
}

/** Everyone who can be given a task, by name. */
export async function loadPeople(): Promise<{ id: string; name: string }[]> {
  return (await getCachedProfiles())
    .filter(p => p.can_edit)
    .map(p => ({ id: p.id, name: profileName(p) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// ── work ───────────────────────────────────────────────────────────────────

export type WorkRow = {
  id: string
  brand_id: string
  template_id: string | null
  service_line: string
  name: string
  status: string
  launch_date: string | null
  pod_id: string | null
  owner_id: string | null
  created_at: string
}

export type TaskRow = {
  id: string
  work_id: string
  deliverable_id: string | null
  parent_id: string | null
  key: string | null
  title: string
  role: string | null
  owner_id: string | null
  due_date: string | null
  status: string
  sort_order: number
  completed_at: string | null
}

export type DeliverableRow = { id: string; work_id: string; kind: string; label: string; review_state: string; sort_order: number }

export type WorkListItem = WorkRow & {
  brand: string
  pod: string | null
  owner: string | null
  done: number
  total: number
  /** The earliest open task, so the list says what's next. */
  next: { title: string; due_date: string | null; owner: string | null } | null
  overdue: number
  kinds: string[]
}

const WORK_COLUMNS = 'id, brand_id, template_id, service_line, name, status, launch_date, pod_id, owner_id, created_at'
const TASK_COLUMNS = 'id, work_id, deliverable_id, parent_id, key, title, role, owner_id, due_date, status, sort_order, completed_at'

// The team works in US Eastern; "overdue" follows their calendar day.
export const todayIso = easternToday

/** Open work (active and on hold), or finished work (done and cancelled). */
export async function loadWorkList(supabase: Supabase, show: 'open' | 'finished', podId?: string | null): Promise<WorkListItem[] | null> {
  let q = supabase.from('work').select(WORK_COLUMNS)
    .in('status', show === 'open' ? ['active', 'on_hold'] : ['done', 'cancelled'])
  if (podId) q = q.eq('pod_id', podId)
  const { data: work, error } = await q.order('launch_date', { ascending: show === 'open', nullsFirst: false }).limit(500)
  if (missing(error)) return null
  const rows = (work ?? []) as WorkRow[]
  if (!rows.length) return []
  const ids = rows.map(w => w.id)
  const [tasksRes, delRes, brandsRes, podsRes, people] = await Promise.all([
    supabase.from('work_tasks').select(TASK_COLUMNS).in('work_id', ids).order('sort_order'),
    supabase.from('work_deliverables').select('work_id, kind, sort_order').in('work_id', ids).order('sort_order'),
    supabase.from('brands').select('id, name').in('id', [...new Set(rows.map(w => w.brand_id))]),
    supabase.from('pods').select('id, name'),
    loadPeople(),
  ])
  const tasks = (tasksRes.data ?? []) as TaskRow[]
  const nameOf = (id: string | null) => (id ? people.find(p => p.id === id)?.name ?? null : null)
  const today = todayIso()
  return rows.map(w => {
    const mine = tasks.filter(t => t.work_id === w.id)
    const open = mine.filter(t => !isClosedTask(t.status))
      .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || a.sort_order - b.sort_order)
    return {
      ...w,
      brand: brandsRes.data?.find(b => b.id === w.brand_id)?.name ?? 'Unknown client',
      pod: podsRes.data?.find(p => p.id === w.pod_id)?.name ?? null,
      owner: nameOf(w.owner_id),
      done: mine.length - open.length,
      total: mine.length,
      next: open[0] ? { title: open[0].title, due_date: open[0].due_date, owner: nameOf(open[0].owner_id) } : null,
      overdue: open.filter(t => t.due_date && t.due_date < today).length,
      kinds: (delRes.data ?? []).filter(d => d.work_id === w.id).map(d => d.kind as string),
    }
  })
}

export type WorkDetail = {
  work: WorkRow
  brand: { id: string; name: string }
  pod: { id: string; name: string } | null
  deliverables: DeliverableRow[]
  tasks: TaskRow[]
}

export async function loadWork(supabase: Supabase, id: string): Promise<{ missing: true } | { missing: false; detail: WorkDetail | null }> {
  const { data: work, error } = await supabase.from('work').select(WORK_COLUMNS).eq('id', id).maybeSingle()
  if (missing(error)) return { missing: true }
  if (!work) return { missing: false, detail: null }
  const w = work as WorkRow
  const [brandRes, podRes, delRes, taskRes] = await Promise.all([
    supabase.from('brands').select('id, name').eq('id', w.brand_id).maybeSingle(),
    w.pod_id ? supabase.from('pods').select('id, name').eq('id', w.pod_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from('work_deliverables').select('id, work_id, kind, label, review_state, sort_order').eq('work_id', id).order('sort_order'),
    supabase.from('work_tasks').select(TASK_COLUMNS).eq('work_id', id).order('sort_order'),
  ])
  return {
    missing: false,
    detail: {
      work: w,
      brand: brandRes.data ?? { id: w.brand_id, name: 'Unknown client' },
      pod: podRes.data ?? null,
      deliverables: (delRes.data ?? []) as DeliverableRow[],
      tasks: (taskRes.data ?? []) as TaskRow[],
    },
  }
}
