import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'
import { getCachedUser } from '@/lib/supabase/server'
import { getCachedProfiles } from '@/lib/profiles'
import { canEdit } from '@/lib/permissions'
import { CALIBRATION_TRACKS, buildTaskTree, type Person, type ProductionStep, type TaskNode } from './production'
import { CALIBRATION_BUCKET } from './calibration-drive'

const STEP_COLUMNS = 'id,plan_slug,parent_id,sort_order,kind,title,plan_key,due_date,status'

export type BfcmComment = { id: string; step_id: string | null; author_id: string | null; author_name: string; body: string; created_at: string }
export type CalibrationItem = { id: string; track: string; name: string; media_type: 'image' | 'video'; url: string; sort_order: number; client_status: string; client_visible: boolean; created_at: string }
export type CalibrationFeedback = { id: string; item_id: string; author_name: string; body: string; pin_x: number | null; pin_y: number | null; created_at: string }
export type Calibration = { plan_slug: string; share_token: string; drive_folder_url: string | null }
export type CalibrationTrackState = { track: string; status: string; sent_at: string | null; submitted_at: string | null; submitted_by_name: string | null; client_note: string | null }
export type BrandContract = { id: string; brand_id: string; document_id: string | null; file_name: string | null; title: string; signed_on: string | null; deliverables: string; revisions: string; special_terms: string; updated_by_name: string | null; updated_at: string }

/** Teammates who can be assigned or @mentioned: everyone with CRM access. */
export async function loadPeople(): Promise<Person[]> {
  return (await getCachedProfiles()).filter(p => p.can_edit).map(p => ({ id: p.id, name: p.full_name || p.email.split('@')[0] }))
}

/**
 * The signed-in editor's profile. Matched by email, like the rest of the app:
 * profiles.id is not guaranteed to be the auth uid.
 */
export async function requireStaffProfile(): Promise<{ id: string | null; name: string }> {
  const user = await getCachedUser()
  if (!user || !await canEdit(user.email)) throw new Error('Unauthorized access.')
  const email = (user.email ?? '').toLowerCase()
  const profile = (await getCachedProfiles()).find(p => p.email.toLowerCase() === email)
  return { id: profile?.id ?? null, name: profile?.full_name || email.split('@')[0] || 'Team' }
}

export function calibrationUrl(path: string): string {
  return createServiceClient().storage.from(CALIBRATION_BUCKET).getPublicUrl(path).data.publicUrl
}

/** Never throws: a missing table must not break the plan page. */
export async function loadProduction(slug: string): Promise<{ ok: true; tasks: TaskNode[]; comments: BfcmComment[] } | { ok: false }> {
  const db = createServiceClient()
  const [steps, comments] = await Promise.all([
    db.from('bfcm_production_steps').select(STEP_COLUMNS).eq('plan_slug', slug),
    db.from('bfcm_comments').select('id,step_id,author_id,author_name,body,created_at').eq('plan_slug', slug).order('created_at'),
  ])
  if (steps.error || comments.error) return { ok: false }
  const rows = (steps.data ?? []) as ProductionStep[]
  const assignees = rows.length ? await db.from('bfcm_step_assignees').select('step_id,profile_id').in('step_id', rows.map(r => r.id)) : { data: [], error: null }
  if (assignees.error) return { ok: false }
  const list = (comments.data ?? []) as BfcmComment[]
  const counts: Record<string, number> = {}
  for (const c of list) if (c.step_id) counts[c.step_id] = (counts[c.step_id] ?? 0) + 1
  return { ok: true, tasks: buildTaskTree(rows, assignees.data ?? [], counts), comments: list }
}

/** Every brand's tasks, grouped by plan, for the list page. Empty on any error. */
export async function loadAllProductionTrees(): Promise<Map<string, TaskNode[]>> {
  const { data, error } = await createServiceClient().from('bfcm_production_steps').select(STEP_COLUMNS)
  const bySlug = new Map<string, ProductionStep[]>()
  if (!error) for (const s of (data ?? []) as ProductionStep[]) bySlug.set(s.plan_slug, [...(bySlug.get(s.plan_slug) ?? []), s])
  return new Map([...bySlug].map(([slug, steps]) => [slug, buildTaskTree(steps, [], {})]))
}

const TRACK_COLUMNS = 'track,status,sent_at,submitted_at,submitted_by_name,client_note'

export async function loadCalibration(slug: string): Promise<{ calibration: Calibration | null; tracks: CalibrationTrackState[]; items: CalibrationItem[]; feedback: CalibrationFeedback[] } | null> {
  const db = createServiceClient()
  const cal = await db.from('bfcm_calibrations').select('plan_slug,share_token,drive_folder_url').eq('plan_slug', slug).maybeSingle()
  if (cal.error) return null
  if (!cal.data) return { calibration: null, tracks: [], items: [], feedback: [] }
  const tracks = await db.from('bfcm_calibration_tracks').select(TRACK_COLUMNS).eq('plan_slug', slug)
  if (tracks.error) return null
  return { calibration: cal.data as Calibration, tracks: (tracks.data ?? []) as CalibrationTrackState[], ...await loadCalibrationItems(slug) }
}

/** What a client link may show: only tracks the team published. Nothing else reaches the page. */
export async function loadClientCalibration(token: string) {
  const db = createServiceClient()
  const { data: cal } = await db.from('bfcm_calibrations').select('plan_slug').eq('share_token', token).maybeSingle()
  if (!cal) return null
  const { data } = await db.from('bfcm_calibration_tracks').select(TRACK_COLUMNS).eq('plan_slug', cal.plan_slug).in('status', ['sent', 'submitted'])
  const tracks = (data ?? []) as CalibrationTrackState[]
  // Hidden samples never leave the server: the client page can't show what it never received.
  const content = tracks.length ? await loadCalibrationItems(cal.plan_slug, tracks.map(t => t.track), true) : { items: [], feedback: [] }
  return { slug: cal.plan_slug as string, tracks, ...content }
}

export async function loadCalibrationItems(slug: string, onlyTracks?: string[], onlyVisible = false): Promise<{ items: CalibrationItem[]; feedback: CalibrationFeedback[] }> {
  const db = createServiceClient()
  let query = db.from('bfcm_calibration_items').select('id,track,name,media_type,storage_path,sort_order,client_status,client_visible,created_at').eq('plan_slug', slug)
  if (onlyTracks) query = query.in('track', onlyTracks)
  if (onlyVisible) query = query.eq('client_visible', true)
  const { data } = await query.order('sort_order').order('created_at')
  const items = ((data ?? []) as (Omit<CalibrationItem, 'url'> & { storage_path: string })[]).map(({ storage_path, ...item }) => ({ ...item, url: calibrationUrl(storage_path) }))
  const feedback = items.length
    ? ((await db.from('bfcm_calibration_feedback').select('id,item_id,author_name,body,pin_x,pin_y,created_at').in('item_id', items.map(i => i.id)).order('created_at')).data ?? []) as CalibrationFeedback[]
    : []
  return { items, feedback }
}

/** Gives the samples task its Statics and Motion subtasks if it doesn't have them. */
export async function ensureCalibrationSubtasks(slug: string) {
  const db = createServiceClient()
  const { data: parent } = await db.from('bfcm_production_steps').select('id,due_date').eq('plan_slug', slug).eq('kind', 'samples').is('parent_id', null).maybeSingle()
  if (!parent) return
  const { data: have } = await db.from('bfcm_production_steps').select('kind').eq('parent_id', parent.id)
  const rows = CALIBRATION_TRACKS.filter(t => !have?.some(h => h.kind === t.kind))
    .map(t => ({ plan_slug: slug, parent_id: parent.id, kind: t.kind, title: t.title, sort_order: t.sort_order, due_date: parent.due_date }))
  if (rows.length) await db.from('bfcm_production_steps').insert(rows)
}

export async function loadContracts(brandId: string | null): Promise<BrandContract[] | null> {
  if (!brandId) return []
  const { data, error } = await createServiceClient().from('brand_contracts')
    .select('id,brand_id,document_id,title,signed_on,deliverables,revisions,special_terms,updated_by_name,updated_at,brand_documents(file_name)')
    .eq('brand_id', brandId).order('created_at', { ascending: false })
  if (error) return null
  return (data ?? []).map(row => {
    const { brand_documents: doc, ...rest } = row as unknown as Omit<BrandContract, 'file_name'> & { brand_documents: { file_name: string } | null }
    return { ...rest, file_name: doc?.file_name ?? null }
  })
}

export type MyBfcmTask = { id: string; title: string; due_date: string | null; status: string; plan_slug: string; brand: string; parent_title: string | null }
/** Open BFCM tasks assigned to one person, for the dashboard's My Work. Empty on any error. */
export async function loadMyBfcmTasks(profileId: string): Promise<MyBfcmTask[]> {
  const db = createServiceClient()
  const mine = await db.from('bfcm_step_assignees').select('step_id').eq('profile_id', profileId)
  if (mine.error || !mine.data?.length) return []
  const steps = await db.from('bfcm_production_steps').select('id,title,due_date,status,plan_slug,parent_id').in('id', mine.data.map(r => r.step_id)).not('status', 'in', '(done,not_required)')
  if (steps.error || !steps.data?.length) return []
  const slugs = [...new Set(steps.data.map(s => s.plan_slug as string))]
  const parentIds = [...new Set(steps.data.map(s => s.parent_id as string | null).filter((id): id is string => !!id))]
  const [plans, parents] = await Promise.all([
    db.from('bfcm_plans').select('slug,config').in('slug', slugs),
    parentIds.length ? db.from('bfcm_production_steps').select('id,title').in('id', parentIds) : Promise.resolve({ data: [] as { id: string; title: string }[], error: null }),
  ])
  const brandOf = new Map((plans.data ?? []).map(p => [p.slug as string, ((p.config as { brand?: { name?: string } } | null)?.brand?.name) ?? (p.slug as string)]))
  const parentOf = new Map((parents.data ?? []).map(p => [p.id, p.title]))
  return steps.data.map(s => ({ id: s.id, title: s.title, due_date: s.due_date, status: s.status, plan_slug: s.plan_slug, brand: brandOf.get(s.plan_slug) ?? s.plan_slug, parent_title: s.parent_id ? parentOf.get(s.parent_id) ?? null : null }))
    .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))
}

/** The brand's documents a contract can point at (newest first). Empty on any error. */
export async function loadBrandDocuments(brandId: string | null): Promise<{ id: string; file_name: string }[]> {
  if (!brandId) return []
  const { data } = await createServiceClient().from('brand_documents').select('id,file_name').eq('brand_id', brandId).order('created_at', { ascending: false })
  return (data ?? []) as { id: string; file_name: string }[]
}
