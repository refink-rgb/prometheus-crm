// The strategist status board: where every project on a profit engineer's
// brands stands, and which client-approved files are ready to take.
//
// Pure and dependency-free (no Supabase, no crypto) so the pages, the download
// route and the tests all read one set of rules.

import { normalizeStage, type Stage } from '../types'

export type Bucket = 'ready' | 'working' | 'upcoming' | 'launched'

export const BUCKET_LABELS: Record<Bucket, string> = {
  ready: 'Ready to launch',
  working: 'In the works',
  upcoming: 'Coming up',
  launched: 'Launched',
}

/** A track's stage, or null when the project has no such track. */
const track = (s: string | null | undefined): Stage | null => (s ? normalizeStage(s) : null)

/**
 * Which section a project belongs in.
 *
 *   launched  archived, or every track is live
 *   ready     nothing is still being made: every track not yet live is Ready
 *   upcoming  nothing has started: every track is still at Brief
 *   working   everything else
 *
 * A project with one track live and the other still in review is "working":
 * the strategist's question is whether the whole thing can go, and it cannot.
 */
export function projectBucket(
  lpStage: string | null | undefined,
  creativesStage: string | null | undefined,
  isComplete: boolean,
): Bucket {
  if (isComplete) return 'launched'
  const stages = [track(lpStage), track(creativesStage)].filter((s): s is Stage => s !== null)
  if (stages.length === 0) return 'upcoming'
  const open = stages.filter(s => s !== 'live')
  if (open.length === 0) return 'launched'
  if (open.every(s => s === 'ready')) return 'ready'
  if (stages.every(s => s === 'brief')) return 'upcoming'
  return 'working'
}

/**
 * One plain line on what the project is waiting for. The client comes first:
 * a strategist can chase a client, they cannot speed up an editor.
 */
export function waitingOn(
  lpStage: string | null | undefined,
  creativesStage: string | null | undefined,
  isComplete: boolean,
): string {
  const bucket = projectBucket(lpStage, creativesStage, isComplete)
  if (bucket === 'launched') return 'Launched'
  if (bucket === 'ready') return 'Approved and ready to launch'
  const stages = [track(lpStage), track(creativesStage)]
  if (stages.includes('client_review')) return 'Waiting on client feedback'
  if (stages.includes('revisions')) return 'Team is making the client’s changes'
  if (stages.includes('internal_review')) return 'Being checked by our team'
  if (stages.includes('in_progress')) return 'Team is building it'
  return 'Brief being written'
}

/**
 * Days past the due date, or 0 when the project is on time, finished, or
 * undated. "Late" here means the team still owes work: a project that is
 * Ready has none left, so a missed date is the launch waiting, not us.
 */
export function daysLate(
  dueDate: string | null | undefined,
  bucket: Bucket,
  today: Date = new Date(),
): number {
  if (!dueDate || bucket === 'launched' || bucket === 'ready') return 0
  const due = new Date(dueDate.slice(0, 10) + 'T00:00:00')
  if (Number.isNaN(due.getTime())) return 0
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const diff = Math.round((start.getTime() - due.getTime()) / 86_400_000)
  return diff > 0 ? diff : 0
}

export interface AssetTally {
  /** Client-approved: the files a strategist can launch. */
  approved: number
  /** On the client's review link, no answer yet. */
  awaiting: number
  /** The client asked for changes. */
  changes: number
}

/** Count what the client has said about the creatives they can see. */
export function tallyAssets(statuses: (string | null | undefined)[]): AssetTally {
  const t: AssetTally = { approved: 0, awaiting: 0, changes: 0 }
  for (const s of statuses) {
    if (s === 'approved') t.approved++
    else if (s === 'needs_revision') t.changes++
    else if (s === 'pending' || s === 'revised') t.awaiting++
    // 'rejected' is dropped work: it is neither waiting nor usable.
  }
  return t
}

/** "8 approved · 4 awaiting client · 2 changes requested", skipping zeros. */
export function tallyLine(t: AssetTally): string {
  return [
    t.approved && `${t.approved} approved`,
    t.awaiting && `${t.awaiting} awaiting client`,
    t.changes && `${t.changes} changes requested`,
  ].filter(Boolean).join(' · ')
}

/** A file or folder name that is safe inside a .zip on every OS. */
export function safeName(s: string | null | undefined, fallback: string): string {
  const cleaned = (s ?? '').replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, ' ').trim().replace(/^[._]+|[._ ]+$/g, '')
  return cleaned || fallback
}
