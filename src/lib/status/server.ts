// Server side of the strategist status board: the link, and the data behind it.
//
// THE LINK. A profit engineer already has one secret, approval_token, which
// lets its holder approve offers on /approvals. The status page is read-only
// and gets forwarded more freely, so it must not be that token. It is a
// one-way hash of it instead: the status link cannot be turned back into the
// approvals link, and there is no new column to migrate or keep in sync.
//
// Server only: never import this from a client component.

import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { daysLate, projectBucket, tallyAssets, waitingOn, type AssetTally, type Bucket } from './board'

/** The status-page token for a profit engineer's approval token. */
export function statusTokenFor(approvalToken: string): string {
  return createHash('sha256').update(`status-board:${approvalToken}`).digest('hex').slice(0, 40)
}

/** The profit engineer a status link belongs to, or null. */
export async function resolveStatusToken(service: SupabaseClient, token: string): Promise<string | null> {
  if (!/^[a-f0-9]{40}$/.test(token)) return null
  const { data } = await service.from('profit_engineers').select('name, approval_token')
  for (const e of (data ?? []) as { name: string; approval_token: string | null }[]) {
    if (e.approval_token && statusTokenFor(e.approval_token) === token) return e.name
  }
  return null
}

export interface BoardAsset {
  id: string
  name: string | null
  drive_file_id: string
  thumbnail_url: string | null
  published_url: string | null
  revision_url: string | null
  revision_poster_url: string | null
  media_type: 'image' | 'video' | null
  video_url: string | null
}

export interface BoardProject {
  id: string
  brandId: string
  name: string
  dueDate: string | null
  pageType: string | null
  lpStage: string | null
  creativesStage: string | null
  lpUrl: string | null
  shareToken: string | null
  bucket: Bucket
  waiting: string
  late: number
  tally: AssetTally
  /** Client-approved creatives, in the order the team arranged them. */
  approved: BoardAsset[]
}

export interface BoardBrand {
  id: string
  name: string
  /** The client's own site, as an absolute https URL, or null. */
  website: string | null
  projects: BoardProject[]
}

// Archived projects stay on the board this long after their due date, so a
// strategist can still pull last month's files.
const ARCHIVE_WINDOW_DAYS = 60
const PAGE = 1000

const ASSET_COLUMNS =
  'id, project_id, name, status, drive_file_id, thumbnail_url, published_url, revision_url, revision_poster_url, media_type, video_url, sort_order'

type ProjectRow = {
  id: string; brand_id: string; name: string; due_date: string | null; is_complete: boolean
  lp_stage: string | null; creatives_stage: string | null; page_type: string | null
  lp_url: string | null; share_token: string | null
}
type AssetRow = BoardAsset & { project_id: string; status: string | null; sort_order: number | null }

/**
 * Every active brand this engineer owns, with its projects and what the client
 * has approved. Pass brandId to load one brand (null if it is not theirs).
 *
 * Only what a client could already see is read: creatives that are on the
 * review link (client_visible) and not hidden. Internal notes, internal QC
 * status and unpublished revisions never leave the database here.
 */
export async function loadBoard(
  service: SupabaseClient,
  engineerName: string,
  brandId?: string,
): Promise<BoardBrand[] | null> {
  let brandQuery = service
    .from('brands')
    .select('id, name, website')
    .eq('profit_engineer', engineerName)
    .eq('is_active', true)
    .order('name')
  if (brandId) brandQuery = brandQuery.eq('id', brandId)
  const { data: brandsRaw } = await brandQuery
  const brands = (brandsRaw ?? []) as { id: string; name: string; website: string | null }[]
  if (brandId && brands.length === 0) return null
  if (brands.length === 0) return []

  const { data: projectsRaw } = await service
    .from('projects')
    .select('id, brand_id, name, due_date, is_complete, lp_stage, creatives_stage, page_type, lp_url, share_token')
    .in('brand_id', brands.map(b => b.id))
    .order('due_date', { ascending: true })
  const cutoff = Date.now() - ARCHIVE_WINDOW_DAYS * 86_400_000
  const projects = ((projectsRaw ?? []) as ProjectRow[]).filter(p => {
    if (!p.is_complete) return true
    const due = p.due_date ? Date.parse(p.due_date) : NaN
    return !Number.isNaN(due) && due >= cutoff
  })

  // Supabase caps a response at 1000 rows and a busy engineer has several
  // thousand creatives, so read in pages, a slice of projects at a time.
  const assetsByProject = new Map<string, AssetRow[]>()
  const ids = projects.map(p => p.id)
  for (let i = 0; i < ids.length; i += 60) {
    const slice = ids.slice(i, i + 60)
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await service
        .from('creative_assets')
        .select(ASSET_COLUMNS)
        .in('project_id', slice)
        .eq('is_hidden', false)
        .eq('client_visible', true)
        .order('id')
        .range(from, from + PAGE - 1)
      if (error) { console.error('[status] failed to load creatives:', error); break }
      const rows = (data ?? []) as unknown as AssetRow[]
      for (const a of rows) {
        const list = assetsByProject.get(a.project_id)
        if (list) list.push(a)
        else assetsByProject.set(a.project_id, [a])
      }
      if (rows.length < PAGE) break
    }
  }

  const byBrand = new Map<string, BoardProject[]>(brands.map(b => [b.id, []]))
  for (const p of projects) {
    const assets = assetsByProject.get(p.id) ?? []
    const bucket = projectBucket(p.lp_stage, p.creatives_stage, p.is_complete)
    byBrand.get(p.brand_id)?.push({
      id: p.id,
      brandId: p.brand_id,
      name: p.name,
      dueDate: p.due_date,
      pageType: p.page_type,
      lpStage: p.lp_stage,
      creativesStage: p.creatives_stage,
      lpUrl: webUrl(p.lp_url),
      shareToken: p.share_token,
      bucket,
      waiting: waitingOn(p.lp_stage, p.creatives_stage, p.is_complete),
      late: daysLate(p.due_date, bucket),
      tally: tallyAssets(assets.map(a => a.status)),
      approved: assets
        .filter(a => a.status === 'approved')
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map(a => ({
          id: a.id,
          name: a.name,
          drive_file_id: a.drive_file_id,
          thumbnail_url: a.thumbnail_url,
          published_url: a.published_url,
          revision_url: a.revision_url,
          revision_poster_url: a.revision_poster_url,
          media_type: a.media_type,
          video_url: a.video_url,
        })),
    })
  }

  return brands.map(b => ({ id: b.id, name: b.name, website: webUrl(b.website), projects: byBrand.get(b.id) ?? [] }))
}

/**
 * A typed-in address as an absolute http(s) URL, or null. People enter
 * "brand.com" as often as "https://brand.com"; anything that is not a web
 * address (a note, "tbd", a javascript: link) is dropped rather than linked.
 */
export function webUrl(raw: string | null | undefined): string | null {
  const v = raw?.trim()
  if (!v || /\s/.test(v)) return null
  const withScheme = /^https?:\/\//i.test(v) ? v : /^[a-z][a-z0-9+.-]*:/i.test(v) ? null : `https://${v}`
  if (!withScheme) return null
  try {
    const u = new URL(withScheme)
    return u.hostname.includes('.') ? u.toString() : null
  } catch {
    return null
  }
}

/**
 * One project on this engineer's board, with its brand, or null when the
 * project is not theirs (or is archived past the window).
 */
export async function loadBoardProject(
  service: SupabaseClient,
  engineerName: string,
  projectId: string,
): Promise<{ brand: BoardBrand; project: BoardProject } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) return null
  const { data } = await service.from('projects').select('brand_id').eq('id', projectId).maybeSingle()
  if (!data) return null
  const board = await loadBoard(service, engineerName, data.brand_id as string)
  const brand = board?.[0]
  const project = brand?.projects.find(p => p.id === projectId)
  return brand && project ? { brand, project } : null
}

/** Counts for the tiles and brand cards. */
export function countBoard(projects: BoardProject[]) {
  return {
    ready: projects.filter(p => p.bucket === 'ready').length,
    working: projects.filter(p => p.bucket === 'working').length,
    upcoming: projects.filter(p => p.bucket === 'upcoming').length,
    launched: projects.filter(p => p.bucket === 'launched').length,
    late: projects.filter(p => p.late > 0).length,
    approvedFiles: projects.reduce((n, p) => n + p.approved.length, 0),
  }
}
