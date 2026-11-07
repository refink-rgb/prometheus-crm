// Evergreen Ads — shapes and rules shared by the board, the detail page and the
// client review link. Pure: no server or browser imports.
//
// Kept apart from the production pipeline on purpose (its own tables, stages
// and actions — see migration 20261106_add_evergreen_ads.sql), so nothing here
// changes how projects behave.

import { STAGE_COLORS } from '@/lib/stageColors'
import type { MediaAsset } from '@/lib/creative-media'

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

export type EvergreenVideoStatus = 'pending' | 'approved' | 'needs_revision' | 'rejected'
/** How a video's review status reads, on the detail page and the review link. */
export const VIDEO_STATUS_META: Record<EvergreenVideoStatus, { label: string; color: string; bg: string; border: string }> = {
  pending:        { label: 'Awaiting review',    color: 'var(--text-muted)', bg: 'var(--surface-raised)',   border: 'var(--border)' },
  approved:       { label: '✓ Approved',         color: 'var(--success)',    bg: 'rgba(34,197,94,0.12)',    border: 'rgba(34,197,94,0.3)' },
  needs_revision: { label: '↩ Changes requested', color: 'var(--danger)',    bg: 'rgba(239,68,68,0.1)',     border: 'rgba(239,68,68,0.3)' },
  rejected:       { label: '✕ Rejected',         color: '#fca5a5',           bg: 'rgba(127,29,29,0.18)',    border: 'rgba(127,29,29,0.5)' },
}


export const CLIENT_VIDEO_STATUSES: EvergreenVideoStatus[] = ['pending', 'approved', 'needs_revision', 'rejected']

export interface EvergreenAd {
  id: string
  brand_id: string
  name: string
  stage: EvergreenStage
  brief_url: string | null
  notes: string | null
  share_token: string
  client_approved: boolean
  client_approved_at: string | null
  is_archived: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface EvergreenVideo {
  id: string
  ad_id: string
  name: string
  video_url: string
  storage_path: string
  poster_url: string | null
  poster_path: string | null
  version: number
  status: EvergreenVideoStatus
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
  resolved_at: string | null
  created_at: string
}

/** A board card: the ad, its brand, and the counts the card shows. */
export type EvergreenCard = Pick<EvergreenAd, 'id' | 'brand_id' | 'name' | 'stage' | 'brief_url' | 'client_approved' | 'created_at'> & {
  brands: { id: string; name: string; is_priority?: boolean } | null
  videoCount: number
  changesCount: number
  approvedCount: number
}

export const AD_COLUMNS = 'id, brand_id, name, stage, brief_url, notes, share_token, client_approved, client_approved_at, is_archived, created_by, created_at, updated_at'
export const VIDEO_COLUMNS = 'id, ad_id, name, video_url, storage_path, poster_url, poster_path, version, status, client_visible, sort_order, uploaded_by, created_at, updated_at'
export const COMMENT_COLUMNS = 'id, ad_id, video_id, author_name, author_id, content, audience, resolved_at, created_at'

/** Postgres says 42P01 for a missing table; newer PostgREST says PGRST205. */
export const MISSING_TABLE = new Set(['42P01', 'PGRST205'])
export const MIGRATION_FILE = 'supabase/migrations/20261106_add_evergreen_ads.sql'

/** Review tokens are minted as 64 hex characters (see the migration default). */
export const isReviewToken = (t: unknown): t is string => typeof t === 'string' && /^[a-f0-9]{64}$/.test(t)

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
 * The shape CreativeTile / CreativePlayer read, so evergreen videos are drawn
 * by the same components as creative videos. There is no Drive original here:
 * the uploaded file is the current cut (revision_url) and what the client sees
 * (published_url), with the still captured at upload as its poster. Callers of
 * CreativePlayer pass `poster` explicitly, since there is no Drive poster.
 */
export function evergreenMediaAsset(v: Pick<EvergreenVideo, 'video_url' | 'poster_url'>): MediaAsset {
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
