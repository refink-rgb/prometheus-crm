// Evergreen Ads — shapes and rules shared by the board, the detail page and the
// client review link. Pure: no server or browser imports.
//
// Kept apart from the production pipeline on purpose (its own tables, stages
// and actions — see migration 20261106_add_evergreen_ads.sql), so nothing here
// changes how projects behave.
//
// An ad holds "creatives": statics (images) and motion (videos). They share one
// table, evergreen_ad_videos, told apart by media_type (20261110 migration).

import { STAGE_COLORS } from '@/lib/stageColors'
import { MAX_VIDEO_BYTES, VIDEO_TYPES, type MediaAsset } from '@/lib/creative-media'

export const EVERGREEN_STAGES = ['brief', 'doing', 'client_review', 'live'] as const
export type EvergreenStage = (typeof EVERGREEN_STAGES)[number]

export const EVERGREEN_STAGE_LABELS: Record<EvergreenStage, string> = {
  brief: 'Brief',
  doing: 'Doing',
  client_review: 'Client Review',
  live: 'Live',
}

// Same palette as the production board, so the two read as one system.
export const EVERGREEN_STAGE_COLORS: Record<EvergreenStage, { border: string; bg: string; text: string }> = {
  brief: STAGE_COLORS.brief,
  doing: STAGE_COLORS.in_progress,
  client_review: STAGE_COLORS.client_review,
  live: STAGE_COLORS.live,
}

export const isEvergreenStage = (s: unknown): s is EvergreenStage =>
  typeof s === 'string' && (EVERGREEN_STAGES as readonly string[]).includes(s)

// ── Creatives ───────────────────────────────────────────────────────────────

export type EvergreenMediaType = 'image' | 'video'

/** Statics the client page can show. Same list and limit as BFCM calibration samples. */
export const EVERGREEN_IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }
export const MAX_IMAGE_BYTES = 50 * 1024 * 1024
export { MAX_VIDEO_BYTES, VIDEO_TYPES }
export const UPLOAD_ACCEPT = [...Object.keys(EVERGREEN_IMAGE_TYPES), ...Object.keys(VIDEO_TYPES)].join(',')

/** 'image' or 'video' for a file type we accept, null for anything else. */
export function mediaTypeOf(mime: string): EvergreenMediaType | null {
  if (mime in EVERGREEN_IMAGE_TYPES) return 'image'
  if (mime in VIDEO_TYPES) return 'video'
  return null
}
export const extensionOf = (mime: string): string | null => EVERGREEN_IMAGE_TYPES[mime] ?? VIDEO_TYPES[mime] ?? null
export const maxBytesOf = (type: EvergreenMediaType) => (type === 'image' ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES)
/** Which kind a stored file is, read from the extension we gave it. */
export function mediaTypeOfPath(path: string): EvergreenMediaType | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  if (Object.values(EVERGREEN_IMAGE_TYPES).includes(ext)) return 'image'
  if (Object.values(VIDEO_TYPES).includes(ext)) return 'video'
  return null
}

export const MEDIA_LABELS: Record<EvergreenMediaType, { one: string; many: string; section: string }> = {
  image: { one: 'static', many: 'statics', section: 'Statics' },
  video: { one: 'video', many: 'videos', section: 'Motion' },
}
/** "3 statics", "1 video". */
export const countLabel = (n: number, type: EvergreenMediaType) => `${n} ${n === 1 ? MEDIA_LABELS[type].one : MEDIA_LABELS[type].many}`

export type EvergreenReviewStatus = 'pending' | 'approved' | 'needs_revision' | 'rejected'
export const REVIEW_STATUSES: EvergreenReviewStatus[] = ['pending', 'approved', 'needs_revision', 'rejected']
export const isReviewStatus = (s: unknown): s is EvergreenReviewStatus => REVIEW_STATUSES.includes(s as EvergreenReviewStatus)
export const isSentBack = (s: EvergreenReviewStatus) => s === 'needs_revision' || s === 'rejected'

/** How a creative's review status reads, on the detail page and the review link. */
export const REVIEW_STATUS_META: Record<EvergreenReviewStatus, { label: string; color: string; bg: string; border: string }> = {
  pending:        { label: 'Awaiting review',    color: 'var(--text-muted)', bg: 'var(--surface-raised)',   border: 'var(--border)' },
  approved:       { label: '✓ Approved',         color: 'var(--success)',    bg: 'rgba(34,197,94,0.12)',    border: 'rgba(34,197,94,0.3)' },
  needs_revision: { label: '↩ Changes requested', color: 'var(--danger)',    bg: 'rgba(239,68,68,0.1)',     border: 'rgba(239,68,68,0.3)' },
  rejected:       { label: '✕ Rejected',         color: '#fca5a5',           bg: 'rgba(127,29,29,0.18)',    border: 'rgba(127,29,29,0.5)' },
}

// ── Rows ────────────────────────────────────────────────────────────────────

export interface EvergreenAd {
  id: string
  brand_id: string
  name: string
  stage: EvergreenStage
  brief_url: string | null
  notes: string | null
  due_date: string | null
  share_token: string
  client_approved: boolean
  client_approved_at: string | null
  is_archived: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

/** A static or a video on an ad (a row of evergreen_ad_videos). */
export interface EvergreenCreative {
  id: string
  ad_id: string
  name: string
  media_type: EvergreenMediaType
  /** The file's public URL: the image itself, or the video. */
  video_url: string
  storage_path: string
  poster_url: string | null
  poster_path: string | null
  version: number
  status: EvergreenReviewStatus
  client_visible: boolean
  sort_order: number
  uploaded_by: string | null
  created_at: string
  updated_at: string
}

export interface EvergreenComment {
  id: string
  ad_id: string
  video_id: string | null
  author_name: string
  author_id: string | null
  content: string
  audience: 'client' | 'internal'
  pin_x: number | null
  pin_y: number | null
  resolved_at: string | null
  created_at: string
}

/** A board card: the ad, its brand, its people and the counts the card shows. */
export type EvergreenCard = Pick<EvergreenAd, 'id' | 'brand_id' | 'name' | 'stage' | 'brief_url' | 'due_date' | 'client_approved' | 'created_at'> & {
  brands: { id: string; name: string; is_priority?: boolean } | null
  assignees: string[]
  staticCount: number
  videoCount: number
  changesCount: number
}

// Rows are read with select('*') and passed through these, so the pages keep
// working before the 20261110 migration adds media_type, due_date and pins.
type Row = Record<string, unknown>
export const toAd = (r: Row): EvergreenAd => ({ ...(r as unknown as EvergreenAd), due_date: (r.due_date as string | null | undefined) ?? null })
export const toCreative = (r: Row): EvergreenCreative => ({ ...(r as unknown as EvergreenCreative), media_type: r.media_type === 'image' ? 'image' : 'video' })
export const toComment = (r: Row): EvergreenComment => ({
  ...(r as unknown as EvergreenComment),
  pin_x: typeof r.pin_x === 'number' ? r.pin_x : null,
  pin_y: typeof r.pin_y === 'number' ? r.pin_y : null,
})

/** Postgres says 42P01 for a missing table; newer PostgREST says PGRST205. */
export const MISSING_TABLE = new Set(['42P01', 'PGRST205'])
/** Postgres says 42703 for a missing column; PostgREST says PGRST204 on a write. */
export const MISSING_COLUMN = new Set(['42703', 'PGRST204'])
export const MIGRATION_FILE = 'supabase/migrations/20261106_add_evergreen_ads.sql'
/** People, due dates, statics, pins and the Drive columns. */
export const TEAM_MIGRATION_FILE = 'supabase/migrations/20261110_evergreen_ads_team_statics.sql'

/** Review tokens are minted as 64 hex characters (see the migration default). */
export const isReviewToken = (t: unknown): t is string => typeof t === 'string' && /^[a-f0-9]{64}$/.test(t)
export const isUuid = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
export const isIsoDate = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T12:00:00Z`))

/** A pin on a static, as a percentage of its width and height. */
export type Pin = { x: number; y: number }
export const isPin = (p: unknown): p is Pin => {
  if (!p || typeof p !== 'object') return false
  const { x, y } = p as Pin
  const ok = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100
  return ok(x) && ok(y)
}

/** "Nov 12" for a YYYY-MM-DD date, read at noon so no time zone moves it a day. */
export const shortDate = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
/** "Nov 12" for a timestamp, in the reader's time zone. */
export const stampDate = (ts: string) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

/** A brief link must be a plain web address. Adds https:// when it was left off. */
export function cleanBriefUrl(raw: string | null | undefined): { ok: true; url: string | null } | { ok: false; error: string } {
  const t = (raw ?? '').trim()
  if (!t) return { ok: true, url: null }
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`
  try {
    const u = new URL(withScheme)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, error: 'The brief link must start with https://' }
    return { ok: true, url: u.toString() }
  } catch {
    return { ok: false, error: 'That brief link is not a valid web address.' }
  }
}

/** A short label for a brief link: "Google Doc", "Google Drive", or the host. */
export function briefLinkLabel(url: string): string {
  try {
    const u = new URL(url)
    if (u.hostname === 'docs.google.com') {
      if (u.pathname.startsWith('/document')) return 'Google Doc'
      if (u.pathname.startsWith('/spreadsheets')) return 'Google Sheet'
      if (u.pathname.startsWith('/presentation')) return 'Google Slides'
      return 'Google Docs'
    }
    if (u.hostname === 'drive.google.com') return 'Google Drive'
    return u.hostname.replace(/^www\./, '')
  } catch {
    return 'Brief'
  }
}

/**
 * The shape CreativePlayer reads, so evergreen videos are drawn by the same
 * component as creative videos. There is no Drive original here: the uploaded
 * file is the current cut (revision_url) and what the client sees
 * (published_url). Callers pass `poster` explicitly.
 */
export function evergreenMediaAsset(v: Pick<EvergreenCreative, 'video_url' | 'poster_url'>): MediaAsset {
  return {
    drive_file_id: '',
    media_type: 'video',
    video_url: v.video_url,
    revision_url: v.video_url,
    revision_poster_url: v.poster_url,
    published_url: v.video_url,
    video_status: 'ready',
  }
}
