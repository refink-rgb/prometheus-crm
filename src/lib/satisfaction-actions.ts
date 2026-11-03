'use server'

// Client satisfaction — saving a review. Every save inserts a new row; the
// newest row per brand is the current rating, so nothing is ever overwritten.

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
  grades: Record<SatisfactionTopic, number>
  notes: Partial<Record<SatisfactionTopic | 'general', string>>
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

  const grades = {} as SatisfactionGrades
  for (const t of SATISFACTION_TOPICS) {
    const g = input.grades?.[t.key]
    if (!isValidGrade(g)) return { ok: false, message: `Give ${t.label} a grade from 1 to 5.` }
    grades[t.key] = g
  }

  const { data, error } = await supabase
    .from('client_satisfaction_reviews')
    .insert({
      brand_id: input.brandId,
      ...grades,
      results_note: clean(input.notes?.results),
      timelines_note: clean(input.notes?.timelines),
      quality_note: clean(input.notes?.quality),
      communication_note: clean(input.notes?.communication),
      owner_feel_note: clean(input.notes?.owner_feel),
      general_note: clean(input.notes?.general),
      score: satisfactionScore(grades),
      reviewed_by: user.id,
      reviewed_by_email: user.email ?? null,
    })
    .select(REVIEW_COLUMNS)
    .single()

  if (error || !data) {
    if (error?.code === '42P01' || error?.code === 'PGRST205') {
      return { ok: false, message: 'Satisfaction table not found. Run supabase/migrations/20261103b_client_satisfaction.sql in the Supabase SQL editor first.' }
    }
    return { ok: false, message: `Could not save: ${error?.message ?? 'unknown error'}` }
  }

  revalidatePath('/satisfaction')
  const row = data as unknown as SatisfactionReview
  return { ok: true, review: { ...row, score: Number(row.score) } }
}
