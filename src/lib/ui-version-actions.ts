'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { UI_VERSION_COOKIE, type UiVersion } from '@/lib/ui-version'

// Flipping the interface generation. Deliberately NOT gated on canEdit: anyone
// who can reach the app should be able to switch back to the version they know,
// including mid-task. Being stuck in a redesign you don't understand is the
// failure mode this whole flag exists to prevent.
export async function setUiVersion(version: UiVersion): Promise<void> {
  const store = await cookies()
  store.set(UI_VERSION_COOKIE, version === 'v2' ? 'v2' : 'v1', {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    httpOnly: false,
  })
  // Every route renders from this flag, so the whole tree is stale.
  revalidatePath('/', 'layout')
}
