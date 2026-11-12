// Client check-in: the short survey a client answers on their intake link
// (/intake/<token>/check-in). See supabase/migrations/20261112_client_checkins.sql.

export type CheckIn = {
  id: string
  brand_id: string
  recommend: number
  recommend_why: string | null
  ease: number
  success_90d: string | null
  changed: boolean
  changed_note: string | null
  needs_follow_up: boolean
  followed_up_at: string | null
  followed_up_by: string | null
  created_at: string
}

/** Ask again once the last answer is this old. */
export const CHECKIN_EVERY_DAYS = 60

export const EASE_LABELS = ['Very hard', 'Hard', 'OK', 'Easy', 'Very easy'] as const

/** Someone should reach out: a detractor score, hard to work with, or a change on their side. */
export function needsFollowUp(a: { recommend: number; ease: number; changed: boolean }) {
  return a.recommend <= 6 || a.ease <= 2 || a.changed
}

/** NPS bands: 9-10 promoter, 7-8 passive, 0-6 detractor. */
export function recommendBand(n: number): 'promoter' | 'passive' | 'detractor' {
  return n >= 9 ? 'promoter' : n >= 7 ? 'passive' : 'detractor'
}

/** How long a team request keeps the card on the portal. */
export const CHECKIN_ASK_DAYS = 14

/** The team asked for a check-in, it hasn't been answered since, and it's under 14 days old. */
export function checkInAsked(requestedAt: string | null, latest: CheckIn | null, now = Date.now()) {
  if (!requestedAt) return false
  const t = new Date(requestedAt).getTime()
  if (latest && new Date(latest.created_at).getTime() >= t) return false
  return now - t < CHECKIN_ASK_DAYS * 86_400_000
}

/** Show the check-in card on the portal: due on the 60-day rhythm, or asked for. */
export function showCheckIn(latest: CheckIn | null, requestedAt: string | null, now = Date.now()) {
  return checkInDue(latest, now) || checkInAsked(requestedAt, latest, now)
}

export function checkInDue(latest: CheckIn | null, now = Date.now()) {
  if (!latest) return true
  return now - new Date(latest.created_at).getTime() > CHECKIN_EVERY_DAYS * 86_400_000
}

/** Validates what the client sent. Returns the clean row or an error to show them. */
export function parseCheckIn(raw: unknown): { ok: true; value: Omit<CheckIn, 'id' | 'brand_id' | 'followed_up_at' | 'followed_up_by' | 'created_at'> } | { ok: false; error: string } {
  const r = (raw ?? {}) as Record<string, unknown>
  const recommend = Number(r.recommend)
  const ease = Number(r.ease)
  if (!Number.isInteger(recommend) || recommend < 0 || recommend > 10) return { ok: false, error: 'Pick a number from 0 to 10 for the first question.' }
  if (!Number.isInteger(ease) || ease < 1 || ease > 5) return { ok: false, error: 'Pick how easy we are to work with.' }
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 4000) : null)
  const changed = r.changed === true
  return {
    ok: true,
    value: {
      recommend,
      recommend_why: text(r.recommend_why),
      ease,
      success_90d: text(r.success_90d),
      changed,
      changed_note: changed ? text(r.changed_note) : null,
      needs_follow_up: needsFollowUp({ recommend, ease, changed }),
    },
  }
}
