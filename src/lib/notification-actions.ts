'use server'

// Reads + mark-as-read for the notification bell. These use the normal
// auth-scoped Supabase client, so RLS guarantees a user only ever sees or
// mutates their own rows (policies in 20260722_add_notifications.sql).
//
// All of these degrade gracefully: if the migration hasn't been applied yet
// the table is missing and every call returns an empty/no-op result instead of
// throwing, so the bell renders as "no notifications" rather than crashing the
// app shell.

import { createClient } from '@/lib/supabase/server'
import type { NotificationRow } from '@/lib/types'

const FETCH_LIMIT = 30

export async function getMyNotifications(): Promise<NotificationRow[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(FETCH_LIMIT)

  if (error) {
    console.error('[notifications] fetch failed:', error.message)
    return []
  }
  return (data ?? []) as NotificationRow[]
}

export async function markNotificationsRead(ids: string[]): Promise<void> {
  const clean = ids.filter(Boolean)
  if (clean.length === 0) return
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  // RLS already restricts to own rows; the explicit unread filter avoids
  // rewriting rows that are already read.
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .in('id', clean)
    .is('read_at', null)
  if (error) console.error('[notifications] mark-read failed:', error.message)
}

export async function markAllNotificationsRead(): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('recipient_id', user.id)
    .is('read_at', null)
  if (error) console.error('[notifications] mark-all-read failed:', error.message)
}
