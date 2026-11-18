// Prometheus 2.0: shared types and labels for pods, templates, work,
// deliverables and tasks (20261117_work_2_0_foundations.sql). Safe for server
// and browser.
//
// Every list the database restricts (roles, statuses, kinds) gets a lookup
// helper with a fallback, so a value added by a newer migration shows as plain
// text instead of breaking the page.

export const MIGRATION_FILE = '20261117_work_2_0_foundations.sql'
/** Postgres / PostgREST codes for "that table isn't there yet". */
export const MISSING_TABLE = new Set(['42P01', 'PGRST205'])
export const MISSING_COLUMN = new Set(['42703', 'PGRST204'])

// ── pods ───────────────────────────────────────────────────────────────────
export type PodRole = 'account_manager' | 'designer' | 'lp_builder'

/** In the order a pod is read: the lead first. */
export const POD_ROLES: { id: PodRole; label: string; plural: string; hint: string }[] = [
  { id: 'account_manager', label: 'Account manager', plural: 'Account manager', hint: 'Leads the pod. One per pod.' },
  { id: 'designer', label: 'Designer', plural: 'Designers', hint: 'Makes the creatives.' },
  { id: 'lp_builder', label: 'Landing page builder', plural: 'Landing page builders', hint: 'Builds the landing pages.' },
]

export const isPodRole = (v: unknown): v is PodRole => POD_ROLES.some(r => r.id === v)

export function roleLabel(role: string): string {
  return POD_ROLES.find(r => r.id === role)?.label ?? role.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())
}

export interface Pod {
  id: string
  name: string
  archived_at: string | null
  created_at: string
}

export interface PodMember {
  pod_id: string
  profile_id: string
  role: string
}

// ── work ───────────────────────────────────────────────────────────────────
export type DeliverableKind = 'offer' | 'landing_page' | 'creative_set'
export const DELIVERABLE_KINDS: { id: DeliverableKind; label: string }[] = [
  { id: 'offer', label: 'Offer' },
  { id: 'landing_page', label: 'Landing page' },
  { id: 'creative_set', label: 'Creatives' },
]
export function deliverableLabel(kind: string): string {
  return DELIVERABLE_KINDS.find(k => k.id === kind)?.label ?? kind.replace(/_/g, ' ')
}

export const WORK_STATUSES: { id: 'active' | 'on_hold' | 'done' | 'cancelled'; label: string }[] = [
  { id: 'active', label: 'Active' },
  { id: 'on_hold', label: 'On hold' },
  { id: 'done', label: 'Done' },
  { id: 'cancelled', label: 'Cancelled' },
]
export function workStatusLabel(status: string): string {
  return WORK_STATUSES.find(s => s.id === status)?.label ?? status.replace(/_/g, ' ')
}

export type TaskStatus = 'todo' | 'in_progress' | 'waiting_client' | 'changes_requested' | 'blocked' | 'done' | 'not_required'
export const TASK_STATUSES: { id: TaskStatus; label: string; fg: string; bg: string }[] = [
  { id: 'todo', label: 'To do', fg: 'var(--text-secondary)', bg: 'var(--surface-raised)' },
  { id: 'in_progress', label: 'In progress', fg: '#3b82f6', bg: 'rgba(59, 130, 246, 0.14)' },
  { id: 'waiting_client', label: 'Waiting on client', fg: '#d97706', bg: 'rgba(245, 158, 11, 0.16)' },
  { id: 'changes_requested', label: 'Changes requested', fg: '#e11d48', bg: 'rgba(244, 63, 94, 0.14)' },
  { id: 'blocked', label: 'Blocked', fg: '#dc2626', bg: 'rgba(239, 68, 68, 0.14)' },
  { id: 'done', label: 'Done', fg: 'var(--success)', bg: 'rgba(34, 197, 94, 0.14)' },
  { id: 'not_required', label: 'Not required', fg: 'var(--text-muted)', bg: 'var(--surface-raised)' },
]
export function taskStatusStyle(status: string): { label: string; fg: string; bg: string } {
  const s = TASK_STATUSES.find(x => x.id === status)
  return s ?? { label: status.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()), fg: 'var(--text-secondary)', bg: 'var(--surface-raised)' }
}
/** Finished for progress: done, or not needed this time. */
export const isClosedTask = (status: string) => status === 'done' || status === 'not_required'

export const isUuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
