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

// Team-capacity counters in the sidebar are management-only.
const CAPACITY_VIEWERS = [
  'roberto@commonthreadglobal.com',
  'lucas@commonthreadglobal.com',
  'giovane@commonthreadglobal.com',
]

export function canViewCapacity(email: string | undefined | null): boolean {
  return !!email && CAPACITY_VIEWERS.includes(email.toLowerCase())
}
