'use server'

// Client satisfaction — saving a client's review. One row per client
// (client_satisfaction), upserted: a save replaces the previous review.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { canEdit, canViewDashboard } from '@/lib/permissions'
import { getCachedProfiles } from '@/lib/profiles'
import {
  REVIEW_COLUMNS,
  SATISFACTION_TOPICS,
  isValidGrade,
  satisfactionScore,
  type SatisfactionGrades,
  type SatisfactionReview,
  type SatisfactionTopic,
} from '@/lib/satisfaction'

export interface SaveReviewInput {
  brandId: string
  grades: Partial<Record<SatisfactionTopic, number | null>>
  notes: Partial<Record<SatisfactionTopic | 'general', string>>
  isNew: boolean
  isChurned: boolean
}

export type SaveReviewResult =
  | { ok: true; review: SatisfactionReview }
  | { ok: false; message: string }

const NOTE_LIMIT = 4000

const clean = (s: string | undefined): string | null => {
  const t = (s ?? '').trim()
  return t ? t.slice(0, NOTE_LIMIT) : null
}

export async function saveSatisfactionReview(input: SaveReviewInput): Promise<SaveReviewResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !(await canEdit(user.email))) return { ok: false, message: 'Not authorized.' }
  const profiles = await getCachedProfiles()
  const me = profiles.find(p => p.email === user.email?.toLowerCase()) ?? null
  if (!canViewDashboard(user.email, me)) return { ok: false, message: 'Not authorized.' }

  if (typeof input.brandId !== 'string' || !input.brandId) return { ok: false, message: 'Missing client.' }

  // Grades are optional (a client can be tagged before it's graded), but any
  // grade given must be 1-5.
  const grades = {} as SatisfactionGrades
  for (const t of SATISFACTION_TOPICS) {
    const g = input.grades?.[t.key]
    if (g === null || g === undefined) { grades[t.key] = null; continue }
    if (!isValidGrade(g)) return { ok: false, message: `${t.label} must be graded 1 to 5.` }
    grades[t.key] = g
  }
  const isNew = input.isNew === true
  const isChurned = input.isChurned === true

  const { data, error } = await supabase
    .from('client_satisfaction')
    .upsert({
      brand_id: input.brandId,
      ...grades,
      results_note: clean(input.notes?.results),
      timelines_note: clean(input.notes?.timelines),
      quality_note: clean(input.notes?.quality),
      communication_note: clean(input.notes?.communication),
      owner_feel_note: clean(input.notes?.owner_feel),
      general_note: clean(input.notes?.general),
      is_new: isNew,
      is_churned: isChurned,
      score: satisfactionScore(grades, { isNew }),
      updated_by: user.id,
      updated_by_email: user.email ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'brand_id' })
    .select(REVIEW_COLUMNS)
    .single()

  if (error || !data) {
    if (error?.code === '42P01' || error?.code === 'PGRST205') {
      return { ok: false, message: 'Satisfaction table not found. Run supabase/migrations/20261103c_client_satisfaction.sql in the Supabase SQL editor first.' }
    }
    return { ok: false, message: `Could not save: ${error?.message ?? 'unknown error'}` }
  }

  revalidatePath('/satisfaction')
  const row = data as unknown as SatisfactionReview
  return { ok: true, review: { ...row, score: row.score === null ? null : Number(row.score) } }
}
