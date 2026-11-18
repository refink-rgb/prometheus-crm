'use server'
// Prometheus 2.0: creating work and moving its tasks along.

import { getCachedProfiles } from '@/lib/profiles'
import { cleanText, failure, manager, NOT_AUTHORIZED, refresh, type Result } from './guard'
import { TASK_STATUSES, WORK_STATUSES, isPodRole, isUuid, type PodRole } from './model'
import { isIsoDate, planWork, readTemplate } from './templates'

const NAME_LIMIT = 200

export type CreateWorkInput = {
  brandId: string
  templateId: string
  name: string
  launchDate: string
  /** Optional deliverables to include, by template key. */
  include: string[]
  /** Who fills each role. Missing or null = nobody yet. */
  assign: Partial<Record<string, string | null>>
}

export async function createWork(input: CreateWorkInput): Promise<Result<{ id: string }>> {
  const m = await manager()
  if (!m) return NOT_AUTHORIZED
  if (!isUuid(input?.brandId)) return { ok: false, error: 'Pick a client.' }
  if (!isUuid(input.templateId)) return { ok: false, error: 'Pick what kind of work this is.' }
  const name = cleanText(input.name)
  if (!name) return { ok: false, error: 'Give the work a name.' }
  if (name.length > NAME_LIMIT) return { ok: false, error: `Keep the name under ${NAME_LIMIT} characters.` }
  if (!isIsoDate(input.launchDate)) return { ok: false, error: 'Pick a launch date.' }
  const include = Array.isArray(input.include) ? input.include.filter((k): k is string => typeof k === 'string') : []

  const [brandRes, templateRes] = await Promise.all([
    m.supabase.from('brands').select('id, pod_id').eq('id', input.brandId).maybeSingle(),
    m.supabase.from('work_templates').select('*').eq('id', input.templateId).is('archived_at', null).maybeSingle(),
  ])
  if (brandRes.error || !brandRes.data) return failure(brandRes.error, 'That client no longer exists.')
  if (templateRes.error || !templateRes.data) return failure(templateRes.error, 'That template was archived. Pick another.')
  const template = readTemplate(templateRes.data)

  // Only people with access can own tasks. Anything else is dropped to "nobody yet".
  const people = new Set((await getCachedProfiles()).filter(p => p.can_edit).map(p => p.id))
  const assign: Partial<Record<PodRole, string | null>> = {}
  for (const [role, id] of Object.entries(input.assign ?? {})) {
    if (isPodRole(role)) assign[role] = isUuid(id) && people.has(id) ? id : null
  }

  const plan = planWork(template, { include, launch: input.launchDate, assign })
  if (plan.deliverables.length === 0) return { ok: false, error: 'Choose at least one deliverable.' }

  const { data, error } = await m.supabase.rpc('create_work', {
    p_work: {
      brand_id: input.brandId,
      template_id: template.id,
      service_line: template.name,
      name,
      launch_date: input.launchDate,
      pod_id: brandRes.data.pod_id,
      owner_id: assign.account_manager ?? null,
      created_by: m.meId,
    },
    p_deliverables: plan.deliverables.map(d => ({ key: d.key, kind: d.kind, label: d.label })),
    p_tasks: plan.tasks,
  })
  if (error || !data) return failure(error, 'Could not create the work.')
  refresh('/v2/work', `/v2/work/${data}`)
  return { ok: true, id: data as string }
}

export type TaskPatch = { status?: string; owner_id?: string | null; due_date?: string | null }

export async function updateTask(taskId: string, patch: TaskPatch): Promise<Result> {
  const m = await manager()
  if (!m) return NOT_AUTHORIZED
  if (!isUuid(taskId)) return { ok: false, error: 'That task no longer exists.' }
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (patch.status !== undefined) {
    if (!TASK_STATUSES.some(s => s.id === patch.status)) return { ok: false, error: 'Pick a status.' }
    const { data: before } = await m.supabase.from('work_tasks').select('status, started_at').eq('id', taskId).maybeSingle()
    update.status = patch.status
    if (patch.status === 'in_progress' && !before?.started_at) update.started_at = update.updated_at
    update.completed_at = patch.status === 'done' ? update.updated_at : null
  }
  if (patch.owner_id !== undefined) {
    if (patch.owner_id !== null) {
      const ok = isUuid(patch.owner_id) && (await getCachedProfiles()).some(p => p.id === patch.owner_id && p.can_edit)
      if (!ok) return { ok: false, error: 'That person doesn\'t have access to Prometheus.' }
    }
    update.owner_id = patch.owner_id
  }
  if (patch.due_date !== undefined) {
    if (patch.due_date !== null && !isIsoDate(patch.due_date)) return { ok: false, error: 'Pick a date.' }
    update.due_date = patch.due_date
  }

  const { data, error } = await m.supabase.from('work_tasks').update(update).eq('id', taskId).select('work_id').maybeSingle()
  if (error) return failure(error, 'Could not update the task.')
  if (!data) return { ok: false, error: 'That task no longer exists.' }
  refresh('/v2/work', `/v2/work/${data.work_id}`)
  return { ok: true }
}

export async function setWorkStatus(workId: string, status: string): Promise<Result> {
  const m = await manager()
  if (!m) return NOT_AUTHORIZED
  if (!isUuid(workId)) return { ok: false, error: 'That work no longer exists.' }
  if (!WORK_STATUSES.some(s => s.id === status)) return { ok: false, error: 'Pick a status.' }
  const { error } = await m.supabase.from('work').update({ status, updated_at: new Date().toISOString() }).eq('id', workId)
  if (error) return failure(error, 'Could not change the status.')
  refresh('/v2/work', `/v2/work/${workId}`)
  return { ok: true }
}
