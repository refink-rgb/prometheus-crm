import 'server-only'
import { createHash } from 'node:crypto'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { canEdit } from '@/lib/permissions'
import { createDraft, parseStoredDraft, type Draft, type PlanSnapshot } from './model'
import { parsePlanConfig, planMotionReferences } from './content'

export type PlanRow = { slug: string; brand_id: string | null; state: unknown; config: unknown; version: number; updated_at: string }
export async function requireBfcmEditor() {
  const user = await getCachedUser()
  if (!user || !await canEdit(user.email)) throw new Error('Unauthorized access.')
  return user
}
export async function loadPlan(slug: string, client = createServiceClient()) {
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug)) throw new Error('Plan not found.')
  const { data, error } = await client.from('bfcm_plans').select('slug,brand_id,state,config,version,updated_at').eq('slug', slug).single()
  if (error || !data) throw new Error('The BFCM module is not available yet. No changes have been saved.')
  const row = data as PlanRow
  const config = parsePlanConfig(row.config, slug)
  if (!config) throw new Error('Private plan configuration is unavailable.')
  const brand = config.brand
  const { data: versions, error: versionsError } = await client.from('bfcm_plan_versions').select('version,snapshot,locked_at').eq('plan_slug', slug).order('version', { ascending: true })
  if (versionsError) throw new Error('Unable to load BFCM version history.')
  const history = (versions ?? []).map((v, i) => ({ version: i + 1, lockedAt: v.locked_at as string, snapshot: v.snapshot as PlanSnapshot }))
  const draft = row.state === null ? createDraft(brand, config.initialCopies) : parseStoredDraft(JSON.stringify({ ...(row.state as object), history }), slug)
  if (!draft) throw new Error('Invalid plan. Contact the team before continuing.')
  const allowed = new Set(planMotionReferences(config).map(ref => ref.id))
  if (draft.motionIds.some(id => !allowed.has(id))) throw new Error('A selected motion reference is unavailable. Contact the team.')
  const visible = draft.visibleMotionIds?.length ? draft.visibleMotionIds.filter(id => allowed.has(id)) : config.motionReferences.map(ref => ref.id)
  // Retain gallery order and every selected reference, including legacy drafts.
  const missingSelected = draft.motionIds.filter(id => !visible.includes(id))
  const retained = visible.filter(id => draft.motionIds.includes(id) || visible.filter(v => !draft.motionIds.includes(v)).indexOf(id) < 10 - draft.motionIds.length)
  draft.visibleMotionIds = [...new Set([...retained, ...missingSelected, ...config.motionReferences.map(ref => ref.id)])].slice(0, 10)
  return { row, brand, config, draft: draft as Draft }
}
export async function resolveClientPlan(token: string) {
  // Module-only capability. Raw tokens are never persisted or logged.
  if (!/^[a-f0-9]{64}$/.test(token)) return null
  const client = createServiceClient()
  const digest = createHash('sha256').update(token).digest('hex')
  const { data: plan, error } = await client.from('bfcm_plans').select('slug').eq('access_token_hash', digest).single()
  if (error || !plan) return null
  return { slug: plan.slug as string, client }
}

export async function listStaffPlans() {
  await requireBfcmEditor()
  const client = await createClient()
  const { data, error } = await client.from('bfcm_plans').select('slug,brand_id,state,config,version,updated_at')
  return { plans: (data ?? []) as PlanRow[], unavailable: !!error }
}

/** Minimal CRM choices for the staff-only creation modal. */
export async function listBfcmBrandOptions() {
  await requireBfcmEditor()
  const { data, error } = await createServiceClient().from('brands').select('id,name').order('name')
  return { brands: (data ?? []) as { id: string; name: string }[], unavailable: !!error }
}
