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
 * Who has to move next.
 *
 *   client  something is on the client's review link, waiting for an answer
 *   team    the work is with us (brief, building, our check, client changes)
 *   none    nothing to wait for: ready to launch, or launched
 *
 * A project with one track at the client and one still with us counts as the
 * client's: that is the half a strategist can do something about.
 */
export type Holder = 'client' | 'team' | 'none'

export function holderOf(
  lpStage: string | null | undefined,
  creativesStage: string | null | undefined,
  isComplete: boolean,
): Holder {
  const bucket = projectBucket(lpStage, creativesStage, isComplete)
  if (bucket === 'launched' || bucket === 'ready') return 'none'
  return [track(lpStage), track(creativesStage)].includes('client_review') ? 'client' : 'team'
}

/** A stage in words a strategist uses, not the team's column names. */
export const STAGE_PLAIN: Record<Stage, string> = {
  brief: 'Not started',
  in_progress: 'In progress',
  internal_review: 'Our check',
  client_review: 'Client review',
  revisions: 'Client changes',
  ready: 'Ready',
  live: 'Live',
}

export type Tone = 'good' | 'warn' | 'bad' | 'plain' | 'muted'

/**
 * The one line under a project's name: where it is and whose move it is.
 * Red is kept for work the team owes late. A project the client is sitting on
 * is amber however old it is; when everything is red, nothing is.
 */
export function statusLine(p: {
  bucket: Bucket
  holder: Holder
  late: number
  /** Whole days the client has had it, when the stage change was logged. */
  waitingDays: number | null
}): { text: string; tone: Tone } {
  if (p.bucket === 'launched') return { text: 'Launched', tone: 'muted' }
  if (p.bucket === 'ready') return { text: 'Ready to launch', tone: 'good' }
  if (p.holder === 'client') {
    const d = p.waitingDays
    return {
      text: d === null ? 'Waiting on client' : d === 0 ? 'Waiting on client since today' : `Waiting on client for ${d} day${d === 1 ? '' : 's'}`,
      tone: 'warn',
    }
  }
  if (p.late > 0) return { text: `With our team · ${p.late} day${p.late === 1 ? '' : 's'} late`, tone: 'bad' }
  if (p.bucket === 'upcoming') return { text: 'Not started yet', tone: 'muted' }
  return { text: 'With our team', tone: 'plain' }
}

/** Whole days from an ISO timestamp to now (0 = today), or null. */
export function daysSince(iso: string | null | undefined, today: Date = new Date()): number | null {
  if (!iso) return null
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return null
  const a = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const b = new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime()
  return Math.max(0, Math.round((a - b) / 86_400_000))
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

/**
 * Who signed a project's files off.
 *   client  the client approved them on the review link
 *   team    the team approved them and has marked the creatives Ready or Live,
 *           but the client's approval was never recorded in the CRM
 */
export type ApprovedBy = 'client' | 'team'

export interface FinalFileFacts {
  status: string | null
  internal_status: string | null
  client_visible: boolean | null
}

/**
 * The files a strategist may take for a project, and on whose word.
 *
 * Client-approved files always win. In practice many clients approve by
 * message and never press the button, so a project can be Ready or Live with
 * nothing "client-approved" in the CRM. For those, and only those, fall back
 * to what the team approved: the stage itself is the team saying the work is
 * signed off. A file the client rejected or sent back is never offered, and
 * while a project is still in review only the client's own approvals count.
 */
export function pickFinalFiles<T extends FinalFileFacts>(
  assets: T[],
  creativesStage: string | null | undefined,
  isComplete: boolean,
): { files: T[]; approvedBy: ApprovedBy | null } {
  const byClient = assets.filter(a => a.status === 'approved' && a.client_visible === true)
  if (byClient.length > 0) return { files: byClient, approvedBy: 'client' }

  const stage = track(creativesStage)
  const signedOff = isComplete || stage === 'ready' || stage === 'live'
  if (!signedOff) return { files: [], approvedBy: null }

  const byTeam = assets.filter(a =>
    a.internal_status === 'approved' && a.status !== 'rejected' && a.status !== 'needs_revision')
  return byTeam.length > 0 ? { files: byTeam, approvedBy: 'team' } : { files: [], approvedBy: null }
}

/** A file or folder name that is safe inside a .zip on every OS. */
export function safeName(s: string | null | undefined, fallback: string): string {
  const cleaned = (s ?? '').replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, ' ').trim().replace(/^[._]+|[._ ]+$/g, '')
  return cleaned || fallback
}
