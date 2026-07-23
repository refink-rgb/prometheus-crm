// Phase 3 — in-app notification writer.
//
// Same two hard rules as the event logger (src/lib/events.ts):
//   1. Creating a notification must NEVER break the operation that triggered it
//      — assigning an editor or posting a note has to succeed even if the
//      notifications table is missing (migration not applied yet) or errors.
//      Every failure is caught and logged, never thrown.
//   2. All writes go through the service-role client: the notifications table
//      deliberately has no PostgREST insert policy, so a client can't forge a
//      notification for another user.
//
// Kill switch: PROMETHEUS_NOTIFICATIONS_DISABLED=1 silences all emission
// without a deploy revert.

import { createServiceClient } from './supabase/service'

export type NotificationType = 'assigned' | 'mentioned' | 'client_feedback'

export interface NotificationInput {
  recipient_id: string
  actor_id?: string | null
  actor_label: string
  type: NotificationType
  project_id?: string | null
  brand_id?: string | null
  comment_id?: string | null
  title: string
  body?: string | null
  link?: string | null
}

export function notificationsEnabled(): boolean {
  return process.env.PROMETHEUS_NOTIFICATIONS_DISABLED !== '1'
}

export async function createNotifications(items: NotificationInput[]): Promise<void> {
  if (!notificationsEnabled()) return
  // Never notify a null/blank recipient; de-dupe so one action can't double-ping.
  const seen = new Set<string>()
  const rows = items.filter(n => {
    if (!n.recipient_id || seen.has(n.recipient_id + n.type)) return false
    seen.add(n.recipient_id + n.type)
    return true
  })
  if (rows.length === 0) return

  try {
    const supabase = createServiceClient()
    const { error } = await supabase.from('notifications').insert(
      rows.map(n => ({
        recipient_id: n.recipient_id,
        actor_id: n.actor_id ?? null,
        actor_label: n.actor_label,
        type: n.type,
        project_id: n.project_id ?? null,
        brand_id: n.brand_id ?? null,
        comment_id: n.comment_id ?? null,
        title: n.title,
        body: n.body ?? null,
        link: n.link ?? null,
      })),
    )
    if (error) console.error('[notifications] insert failed:', error.message)
  } catch (err) {
    console.error('[notifications] writer threw:', err)
  }
}
