// Client satisfaction scoring. Pure, shared by the page, the editor and the
// save action so all three compute the same number.
//
// Each topic is graded 1-5. The score is the weighted average grade as a share
// of 5, scaled so a perfect client reads 95%:
//
//     score = (Σ weight × grade) / 5 × 95
//
// 95% is the top on purpose (Giovane, 2026-11-03): there is always something
// to improve, so no client sits at 100%. A straight 4 everywhere is 76%,
// a straight 3 is 57%.
//
// Tags (Giovane, 2026-11-03):
//   New     — Results has no weight while the client is new; the other four
//             topics share it in proportion. Removing the tag puts the normal
//             weights back.
//   Churned — a label only. The score is computed the same way.

export const MAX_SATISFACTION = 95

export type SatisfactionTopic = 'results' | 'timelines' | 'quality' | 'communication' | 'owner_feel'

export interface TopicMeta {
  key: SatisfactionTopic
  label: string
  short: string
  /** Normal share of the score. All weights add up to 1. */
  weight: number
  question: string
  /** What each grade means, 1 → 5. */
  scale: [string, string, string, string, string]
}

export const SATISFACTION_TOPICS: TopicMeta[] = [
  {
    key: 'results', label: 'Results', short: 'Results', weight: 0.35,
    question: 'Were the results good, mid or bad?',
    scale: ['Losing money', 'Below target', 'Mid, around break-even', 'Good, above target', 'Great, clear wins'],
  },
  {
    key: 'timelines', label: 'Timelines', short: 'Timelines', weight: 0.2,
    question: 'Did we deliver on time, or were we delayed?',
    scale: ['Badly delayed, often', 'Delayed most moments', 'Some delays', 'Mostly on time', 'Always on time'],
  },
  {
    key: 'quality', label: 'Quality of work', short: 'Quality', weight: 0.2,
    question: 'How was the feedback? Did the client like the work?',
    scale: ['Rejects most work', 'Heavy revisions', 'Mixed feedback', 'Likes the work', 'Loves the work'],
  },
  {
    key: 'communication', label: 'Communication', short: 'Comms', weight: 0.15,
    question: 'Is communication good? Is the client engaged with the service?',
    scale: ['Unresponsive', 'Slow, disengaged', 'Responds when chased', 'Engaged, responsive', 'Very engaged partner'],
  },
  {
    key: 'owner_feel', label: "Owner's personal feel", short: 'Owner feel', weight: 0.1,
    question: 'How does the owner feel about the client? Do they value what we do?',
    scale: ['Likely to leave', 'Unhappy', 'Neutral', 'Happy', 'Champion of our work'],
  },
]

export type SatisfactionGrades = Record<SatisfactionTopic, number | null>

export interface SatisfactionTags {
  isNew: boolean
}

/** The weight each topic carries for this client: Results drops to 0 while New. */
export function topicWeights(tags: SatisfactionTags): Record<SatisfactionTopic, number> {
  const counted = SATISFACTION_TOPICS.filter(t => !(tags.isNew && t.key === 'results'))
  const total = counted.reduce((s, t) => s + t.weight, 0)
  const out = {} as Record<SatisfactionTopic, number>
  for (const t of SATISFACTION_TOPICS) out[t.key] = counted.includes(t) ? t.weight / total : 0
  return out
}

/** Topics that must be graded for a score: every topic with weight. */
export function countedTopics(tags: SatisfactionTags): SatisfactionTopic[] {
  const w = topicWeights(tags)
  return SATISFACTION_TOPICS.filter(t => w[t.key] > 0).map(t => t.key)
}

/** Null until every counted topic has a grade. */
export function satisfactionScore(grades: Partial<SatisfactionGrades>, tags: SatisfactionTags): number | null {
  const w = topicWeights(tags)
  let weighted = 0
  for (const k of countedTopics(tags)) {
    const g = grades[k]
    if (!isValidGrade(g)) return null
    weighted += w[k] * g
  }
  return Math.round((weighted / 5) * MAX_SATISFACTION * 10) / 10
}

export function isValidGrade(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 5
}

export type SatisfactionBand = 'great' | 'good' | 'watch' | 'at_risk'

/** 80+ great · 65+ good · 50+ watch · below 50 at risk. */
export function satisfactionBand(score: number): SatisfactionBand {
  return score >= 80 ? 'great' : score >= 65 ? 'good' : score >= 50 ? 'watch' : 'at_risk'
}

export const SATISFACTION_BAND_LABEL: Record<SatisfactionBand, string> = {
  great: 'Great',
  good: 'Good',
  watch: 'Watch',
  at_risk: 'At risk',
}

/** A review older than this is flagged as due for a fresh look. */
export const REVIEW_STALE_DAYS = 30

/** A row of client_satisfaction: one per client, its current review. */
export interface SatisfactionReview extends SatisfactionGrades {
  brand_id: string
  results_note: string | null
  timelines_note: string | null
  quality_note: string | null
  communication_note: string | null
  owner_feel_note: string | null
  general_note: string | null
  is_new: boolean
  is_churned: boolean
  score: number | null
  updated_by_email: string | null
  updated_at: string
}

export const REVIEW_COLUMNS =
  'brand_id, results, timelines, quality, communication, owner_feel, ' +
  'results_note, timelines_note, quality_note, communication_note, owner_feel_note, general_note, ' +
  'is_new, is_churned, score, updated_by_email, updated_at'
