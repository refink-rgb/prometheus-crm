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
// role is 'admin' for two people and gates nothing anywhere in the app today,
// so promoting someone into it to unlock one page would hand them a permission
// that means something different tomorrow. This list says exactly who, and why.
const MANAGEMENT = [
  'roberto@commonthreadglobal.com',
  'lucas@commonthreadglobal.com',
  'giovane@commonthreadglobal.com',
]

const isManagement = (email: string | undefined | null): boolean =>
  !!email && MANAGEMENT.includes(email.toLowerCase())

/** Team-capacity counters in the sidebar. */
export function canViewCapacity(email: string | undefined | null): boolean {
  return isManagement(email)
}

/** The moment-code index at /codes — the master list of every project's
 *  searchable ad-account code. Same three people. */
export function canViewMomentCodes(email: string | undefined | null): boolean {
  return isManagement(email)
}
