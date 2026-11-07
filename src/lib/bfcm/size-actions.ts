'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service'
import { loadPlan, requireBfcmEditor } from './server'
import { parsePlanConfig } from './content'
import { suggestedAllocation, validateAllocation, type Brand } from './model'

export type PlanSizeInput = { cap: number; contract: 'flexible' | 'grouped'; static?: number; motion?: number }

// Same rules as creating a plan (create.ts): a whole-number total, and when
// Statics / Motion are set they must add up to it.
function validSize(v: unknown): v is PlanSizeInput {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const s = v as Record<string, unknown>
  if (Object.keys(s).some(key => !['cap', 'contract', 'static', 'motion'].includes(key))) return false
  if (!Number.isSafeInteger(s.cap) || (s.cap as number) < 1 || (s.cap as number) > 100_000) return false
  if (s.contract === 'flexible') return s.static === undefined && s.motion === undefined
  return s.contract === 'grouped' && Number.isSafeInteger(s.static) && Number.isSafeInteger(s.motion)
    && (s.static as number) >= 0 && (s.motion as number) >= 0 && (s.static as number) + (s.motion as number) === s.cap
}

/**
 * Changes how many creatives a BFCM plan has (and its Statics / Motion split).
 * The plan's category split resets to fit the new total; the team adjusts it on
 * step 1. A confirmed plan must be reopened first: the production board counts
 * from the confirmed version, so changing it underneath would leave the two
 * disagreeing.
 */
export async function updateBfcmPlanSize(slug: string, input: PlanSizeInput): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireBfcmEditor()
    if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug)) return { ok: false, error: 'Invalid plan.' }
    if (!validSize(input)) return { ok: false, error: 'Enter a whole-number total. Statics and Motion must add up to it.' }

    const client = createServiceClient()
    const { row, brand, config, draft } = await loadPlan(slug, client)
    if (draft.status === 'locked') return { ok: false, error: 'This plan is confirmed. Reopen it at the bottom of the plan first, then change the count.' }

    const next: Brand = {
      ...brand,
      cap: input.cap,
      contract: input.contract === 'grouped' ? { kind: 'grouped', static: input.static!, motion: input.motion! } : { kind: 'flexible' },
    }
    const allocation = suggestedAllocation(next)
    const nextConfig = { ...config, brand: next }
    if (!parsePlanConfig(nextConfig, slug) || validateAllocation(next, allocation).length) return { ok: false, error: 'That count does not make a valid plan.' }
    // A plan nobody has opened yet has no saved state: it is built from the brand on load.
    const nextState = row.state && typeof row.state === 'object'
      ? { ...(row.state as Record<string, unknown>), allocation, allocationLocks: [] }
      : row.state

    // Version bump: an open planner tab gets "reload" instead of saving the old count back.
    const { data, error } = await client.from('bfcm_plans')
      .update({ config: nextConfig, state: nextState, version: row.version + 1 })
      .eq('slug', slug).eq('version', row.version).select('slug')
    if (error) return { ok: false, error: 'Unable to save the new count.' }
    if (!data?.length) return { ok: false, error: 'This plan was changed in another session. Reload and try again.' }

    revalidatePath('/bfcm-creatives')
    revalidatePath(`/bfcm-creatives/${slug}`)
    return { ok: true }
  } catch {
    return { ok: false, error: 'Unable to change the count. Check your access and try again.' }
  }
}
