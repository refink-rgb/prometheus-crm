import { getCachedProfiles } from '@/lib/profiles'

// Source of truth is profiles.can_edit (see migration 20260715). Adding
// someone = create them in Supabase Auth (the trigger makes their profile
// row) + flip can_edit to TRUE — no deploy needed.
//
// getCachedProfiles() is React cache()-deduped per request, so calling this
// many times in one request (every gated page/action does) costs one query.
export async function canEdit(email: string | undefined | null): Promise<boolean> {
  if (!email) return false
  const profiles = await getCachedProfiles()
  const lower = email.toLowerCase()
  return profiles.some(p => p.email.toLowerCase() === lower && p.can_edit)
}

// Management-only views. Deliberately a list here rather than profiles.role:
// role is 'admin' for two of these four and gates nothing anywhere in the app
// today, so promoting someone into it to unlock one page would hand them a
// permission that means something different tomorrow. This list says exactly
// who, and why.
const MANAGEMENT = [
  'roberto@commonthreadglobal.com',
  'lucas@commonthreadglobal.com',
  'giovane@commonthreadglobal.com',
  'kstrydom@commonthreadglobal.com',
  'sdiop@commonthreadglobal.com',
]

const isManagement = (email: string | undefined | null): boolean =>
  !!email && MANAGEMENT.includes(email.toLowerCase())

// Who reviews the team's capacity: management, plus people who follow the
// weekly reports without being on the management roster. Kept separate so that
// adding someone here doesn't also put them in the offer assignee picker or /codes.
const CAPACITY_REVIEWERS = [
  ...MANAGEMENT,
  'omkar@commonthreadglobal.com',
]

/** Team-capacity counters in the sidebar, plus the team roll-up and
 *  assignments-by-editor pivot on /capacity. */
export function canViewCapacity(email: string | undefined | null): boolean {
  return !!email && CAPACITY_REVIEWERS.includes(email.toLowerCase())
}

/** Offers are strategist-owned: the assignee picker lists the management roster. */
export function isOfferAssignee(email: string | undefined | null): boolean {
  return isManagement(email)
}

/** The full Dashboard (revenue, management metrics, client concerns) and the
 *  revenue sheet upload. Everyone who isn't an LP/Creative editor, plus the
 *  management roster even when they also hold an editor flag — Lucas and Kaylin
 *  are in the editor pickers but run the business (Giovane, 2026-11-02). */
export function canViewDashboard(
  email: string | undefined | null,
  profile: { is_lp_editor: boolean; is_creative_editor: boolean } | null | undefined,
): boolean {
  if (isManagement(email)) return true
  return !(profile && (profile.is_lp_editor || profile.is_creative_editor))
}

/** The moment-code index at /codes — the master list of every project's
 *  searchable ad-account code. The management roster, nobody else. */
export function canViewMomentCodes(email: string | undefined | null): boolean {
  return isManagement(email)
}
