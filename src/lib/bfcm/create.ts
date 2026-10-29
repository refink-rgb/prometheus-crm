'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service'
import { requireBfcmEditor } from './server'
import { parsePlanConfig, type MotionReference, type PlanConfig } from './content'
import { createDraft, validateAllocation, type Brand } from './model'

export type CreateBfcmPlanInput = {
  brandId: string
  cap: number
  contract: 'flexible' | 'grouped'
  static?: number
  motion?: number
}
export type CreateBfcmPlanResult = { ok: true; slug: string; existing: boolean } | { ok: false; error: string }

function validInput(value: unknown): value is CreateBfcmPlanInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  if (Object.keys(v).some(key => !['brandId', 'cap', 'contract', 'static', 'motion'].includes(key))) return false
  if (typeof v.brandId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v.brandId)) return false
  if (!Number.isSafeInteger(v.cap) || (v.cap as number) < 1 || (v.cap as number) > 100_000) return false
  if (v.contract === 'flexible') return v.static === undefined && v.motion === undefined
  return v.contract === 'grouped' && Number.isSafeInteger(v.static) && Number.isSafeInteger(v.motion)
    && (v.static as number) >= 0 && (v.motion as number) >= 0 && (v.static as number) + (v.motion as number) === v.cap
}
function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null } catch { return null }
}
function reference(value: unknown): MotionReference | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (['id', 'title', 'category', 'format'].some(key => typeof v[key] !== 'string' || !(v[key] as string).trim() || (v[key] as string).length > 500)) return null
  const thumbnailUrl = httpsUrl(v.thumbnailUrl), videoUrl = httpsUrl(v.videoUrl)
  if (!thumbnailUrl || !videoUrl) return null
  // Copy catalog fields only, never another client's offers, copy, notes or files.
  return { id: v.id as string, title: v.title as string, category: v.category as string, format: v.format as string, thumbnailUrl, videoUrl }
}

/** Manual staff-only creation. Never overwrites a plan or generates a client capability. */
export async function createStaffBfcmPlan(input: CreateBfcmPlanInput): Promise<CreateBfcmPlanResult> {
  try {
    await requireBfcmEditor()
    if (!validInput(input)) return { ok: false, error: 'Choose a brand and valid whole-number quantities. Static and motion totals must match the creative total.' }
    const client = createServiceClient()
    const { data: crmBrand, error: brandError } = await client.from('brands').select('id,name,website').eq('id', input.brandId).single()
    if (brandError || !crmBrand || typeof crmBrand.name !== 'string' || !crmBrand.name.trim()) return { ok: false, error: 'Choose an existing CRM brand.' }
    const existingPlan = async () => client.from('bfcm_plans').select('slug').eq('brand_id', crmBrand.id).maybeSingle()
    const existing = await existingPlan()
    if (existing.error) return { ok: false, error: 'Unable to check existing plans. Try again.' }
    if (existing.data) return { ok: true, slug: existing.data.slug, existing: true }

    // Separate CRM records can represent the same brand. Compare only exact normalized
    // names, including unlinked legacy plans; do not inspect or transplant plan state.
    const normalizeName = (name: string) => name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
    const normalizedName = normalizeName(crmBrand.name)
    if (normalizedName) {
      const pageSize = 200
      for (let offset = 0; ; offset += pageSize) {
        const { data: names, error: namesError } = await client.from('bfcm_plans')
          .select('slug,name:config->brand->>name').order('slug', { ascending: true }).range(offset, offset + pageSize - 1)
        if (namesError) return { ok: false, error: 'Unable to check existing plans. Try again.' }
        const match = (names ?? []).find(plan => typeof plan.name === 'string' && normalizeName(plan.name) === normalizedName)
        if (match) return { ok: true, slug: match.slug, existing: true }
        if (!names || names.length < pageSize) break
      }
    }

    const { data: catalogs, error: catalogError } = await client.from('bfcm_plans')
      .select('references:config->motionReferences,pool:config->motionReferencePool').order('slug', { ascending: true }).limit(200)
    if (catalogError) return { ok: false, error: 'Unable to load the motion reference catalog. Try again.' }
    const refs = new Map<string, MotionReference>()
    for (const catalog of catalogs ?? []) {
      for (const raw of [...(Array.isArray(catalog.references) ? catalog.references : []), ...(Array.isArray(catalog.pool) ? catalog.pool : [])]) {
        const ref = reference(raw)
        if (ref && !refs.has(ref.id)) refs.set(ref.id, ref)
        if (refs.size >= 20) break
      }
      if (refs.size >= 20) break
    }
    if (refs.size < 10) return { ok: false, error: 'The motion reference catalog is not ready. No project was created.' }
    const name = crmBrand.name.trim()
    // Full CRM UUID makes identity stable and prevents collisions between similar names.
    const prefix = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'brand'
    const slug = `${prefix}-${String(crmBrand.id).toLowerCase()}`
    const brand: Brand = { slug, name, aliases: [], cap: input.cap, contract: input.contract === 'grouped' ? { kind: 'grouped', static: input.static!, motion: input.motion! } : { kind: 'flexible' } }
    const initial = createDraft(brand)
    const website = httpsUrl(crmBrand.website)
    const pool = [...refs.values()]
    const config: PlanConfig = {
      brand, initialCopies: initial.copies, motionReferences: pool.slice(0, 10), motionReferencePool: pool,
      websiteFacts: { sources: website ? [{ url: website, facts: [] }] : [], constraints: ['No website claims or historical advertising have been verified for this plan. Use only the client-entered planned offer; do not infer claims from the brand name or website URL.'] },
      sourceNotice: 'Ad history unavailable · Review required.',
    }
    if (!parsePlanConfig(config, slug) || validateAllocation(brand, initial.allocation).length) return { ok: false, error: 'Invalid plan configuration. No project was created.' }
    const { error: insertError } = await client.from('bfcm_plans').insert({ slug, brand_id: crmBrand.id, snapshot_key: `manual:${crmBrand.id}`, config })
    if (insertError) {
      // A repeated submit or concurrent creator must resolve the existing row, never upsert.
      if (insertError.code === '23505') {
        const raced = await existingPlan()
        if (!raced.error && raced.data) return { ok: true, slug: raced.data.slug, existing: true }
      }
      return { ok: false, error: 'Unable to create the project. Refresh the list before trying again.' }
    }
    revalidatePath('/bfcm-creatives')
    return { ok: true, slug, existing: false }
  } catch {
    return { ok: false, error: 'Unable to create the project. Check your access and try again.' }
  }
}
