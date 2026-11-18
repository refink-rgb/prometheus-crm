'use server'
// Prometheus 2.0: editing templates. A template is copied into each piece of
// work when it is created, so saving one never changes work already running.

import { cleanText, failure, manager, NOT_AUTHORIZED, refresh, type Result } from './guard'
import { isUuid } from './model'
import { parseTemplateBody, readTemplate, type TemplateBody } from './templates'

const NAME_LIMIT = 80
const DESCRIPTION_LIMIT = 2000

function checkName(raw: unknown): { ok: true; name: string } | { ok: false; error: string } {
  const name = cleanText(raw)
  if (!name) return { ok: false, error: 'Give the template a name.' }
  if (name.length > NAME_LIMIT) return { ok: false, error: `Keep the name under ${NAME_LIMIT} characters.` }
  return { ok: true, name }
}

const duplicateName = (name: string) => `There's already a template called "${name}".`

/** A new template: blank, or a copy of `fromId`. */
export async function createTemplate(rawName: string, fromId?: string | null): Promise<Result<{ id: string }>> {
  const m = await manager()
  if (!m) return NOT_AUTHORIZED
  const n = checkName(rawName)
  if (!n.ok) return n
  let body: TemplateBody = { deliverables: [], tasks: [] }
  let description: string | null = null
  if (fromId) {
    if (!isUuid(fromId)) return { ok: false, error: 'That template no longer exists.' }
    const { data, error } = await m.supabase.from('work_templates').select('*').eq('id', fromId).maybeSingle()
    if (error || !data) return failure(error, 'That template no longer exists.')
    const source = readTemplate(data)
    body = { deliverables: source.deliverables, tasks: source.tasks }
    description = source.description
  }
  const { data: last } = await m.supabase.from('work_templates').select('sort_order').order('sort_order', { ascending: false }).limit(1).maybeSingle()
  const { data, error } = await m.supabase.from('work_templates')
    .insert({ name: n.name, description, ...body, sort_order: ((last?.sort_order as number | undefined) ?? 0) + 1, updated_by: m.meId })
    .select('id').single()
  if (error || !data) return failure(error, 'Could not create the template.', duplicateName(n.name))
  refresh('/v2/templates')
  return { ok: true, id: data.id }
}

export async function saveTemplate(
  templateId: string,
  input: { name: string; description: string; deliverables: unknown; tasks: unknown; updatedAt: string },
): Promise<Result<{ updatedAt: string }>> {
  const m = await manager()
  if (!m) return NOT_AUTHORIZED
  if (!isUuid(templateId)) return { ok: false, error: 'That template no longer exists.' }
  const n = checkName(input.name)
  if (!n.ok) return n
  const description = typeof input.description === 'string' ? input.description.trim() : ''
  if (description.length > DESCRIPTION_LIMIT) return { ok: false, error: `Keep the description under ${DESCRIPTION_LIMIT} characters.` }
  const parsed = parseTemplateBody({ deliverables: input.deliverables, tasks: input.tasks })
  if (!parsed.ok) return parsed

  // Two people editing the same template: the second save is refused rather
  // than silently wiping the first.
  const { data: current, error: readErr } = await m.supabase.from('work_templates').select('updated_at').eq('id', templateId).maybeSingle()
  if (readErr || !current) return failure(readErr, 'That template no longer exists.')
  if (current.updated_at !== input.updatedAt) {
    return { ok: false, error: 'Someone else saved this template while you were editing. Reload to see their changes, then make yours again.' }
  }
  // Read the stamp back as the database writes it, so the next save compares like with like.
  const { data: saved, error } = await m.supabase.from('work_templates')
    .update({ name: n.name, description: description || null, ...parsed.body, updated_by: m.meId, updated_at: new Date().toISOString() })
    .eq('id', templateId).eq('updated_at', input.updatedAt)
    .select('updated_at').maybeSingle()
  if (error) return failure(error, 'Could not save the template.', duplicateName(n.name))
  if (!saved) return { ok: false, error: 'Someone else saved this template while you were editing. Reload to see their changes, then make yours again.' }
  refresh('/v2/templates', `/v2/templates/${templateId}`, '/v2/work/new')
  return { ok: true, updatedAt: saved.updated_at as string }
}

/** Hides it from the list and the create-work form. Work made from it keeps its name. */
export async function archiveTemplate(templateId: string): Promise<Result> {
  const m = await manager()
  if (!m) return NOT_AUTHORIZED
  if (!isUuid(templateId)) return { ok: false, error: 'That template no longer exists.' }
  const { error } = await m.supabase.from('work_templates').update({ archived_at: new Date().toISOString() }).eq('id', templateId)
  if (error) return failure(error, 'Could not archive the template.')
  refresh('/v2/templates', `/v2/templates/${templateId}`, '/v2/work/new')
  return { ok: true }
}
