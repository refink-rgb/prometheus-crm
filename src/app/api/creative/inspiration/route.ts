import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { bearerToken, validateEditorToken } from '@/lib/editor-auth'

export const runtime = 'nodejs'

/**
 * GET /api/creative/inspiration — search the hosted reference-ad library.
 *
 * The library index is ONE 9MB JSON file in public Storage, served with
 * cache-control: no-cache and no compression. Everything that needed it paid
 * that 9MB every time: the CRM's Inspiration page on every visit, and an
 * editor's assistant on every run — where a file that size usually fails
 * outright, which is what stopped a colleague from getting any ads at all.
 *
 * So: read it once per warm instance here, filter on the server, and answer
 * with the few records asked for. Next compresses the response, so a filtered
 * page is kilobytes.
 *
 * Who may call it: an editor token (Authorization: Bearer …) or a signed-in
 * CRM user. The library is reference material, not client data, and its images
 * are already public — the check is only to keep it off the open internet.
 */

const INDEX_URL =
  'https://mhizyjlvqrhwzjqywiwz.supabase.co/storage/v1/object/public/ad-inspiration/_library/index.json'
const TTL_MS = 10 * 60_000
const MAX_LIMIT = 6000

interface AdRecord {
  id: string
  public_url?: string
  file_name?: string
  brand?: string
  industry?: string
  ad_archetype?: string
  layout_style?: string
  color_mood?: string
  mood?: string
  composition?: string
  setting?: string
  offer_type?: string
  has_person?: boolean
  has_text_overlay?: boolean
  text_overlay?: string
  text_overlay_purpose?: string
  tags?: string[]
  description?: string
  transferable_concept?: string
  why_it_works?: string
  color_palette?: string[]
}

/** The fields the grid, the facets and the search box need. */
const SLIM: (keyof AdRecord)[] = [
  'id', 'public_url', 'file_name', 'brand', 'industry', 'ad_archetype', 'layout_style',
  'color_mood', 'has_person', 'has_text_overlay', 'text_overlay', 'tags', 'description',
  'transferable_concept', 'why_it_works',
]

let cache: { at: number; ads: AdRecord[] } | null = null
let inFlight: Promise<AdRecord[]> | null = null

async function library(): Promise<AdRecord[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.ads
  // One fetch even when ten requests land on a cold instance together.
  if (!inFlight) {
    inFlight = (async () => {
      const res = await fetch(INDEX_URL, { cache: 'no-store' })
      if (!res.ok) throw new Error(`library index: HTTP ${res.status}`)
      const all = (await res.json()) as AdRecord[]
      // Only records whose image is actually hosted: the rest cannot be shown.
      const ads = all.filter(a => a && a.id && a.public_url)
      cache = { at: Date.now(), ads }
      return ads
    })().finally(() => { inFlight = null })
  }
  return inFlight
}

const lower = (v: unknown): string => (typeof v === 'string' ? v.toLowerCase() : '')
const list = (v: string | null): string[] =>
  (v ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)

const pick = (a: AdRecord, fields: (keyof AdRecord)[]): Partial<AdRecord> => {
  const out: Partial<AdRecord> = {}
  for (const f of fields) if (a[f] !== undefined && a[f] !== null && a[f] !== '') (out as Record<string, unknown>)[f] = a[f]
  return out
}

const countBy = (ads: AdRecord[], key: keyof AdRecord): { value: string; count: number }[] => {
  const counts = new Map<string, number>()
  for (const a of ads) {
    const v = typeof a[key] === 'string' ? (a[key] as string) : ''
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  return [...counts].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([value, count]) => ({ value, count }))
}

export async function GET(request: Request) {
  const service = createServiceClient()
  let allowed = !!(await validateEditorToken(service, bearerToken(request)))
  if (!allowed) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    allowed = !!user
  }
  if (!allowed) {
    return NextResponse.json({ error: 'Sign in, or send an editor token.' }, { status: 401 })
  }

  const p = new URL(request.url).searchParams
  let ads: AdRecord[]
  try {
    ads = await library()
  } catch (e) {
    return NextResponse.json(
      { error: `Could not read the inspiration library: ${e instanceof Error ? e.message : 'unknown error'}` },
      { status: 502 },
    )
  }

  // Exact ids first: this is how a hand-picked list from the CRM browser is
  // resolved, and it must never be cut short by the limit.
  const ids = list(p.get('ids'))
  if (ids.length) {
    const want = new Set(ids)
    const found = ads.filter(a => want.has(a.id.toLowerCase()))
    const missing = ids.filter(id => !found.some(a => a.id.toLowerCase() === id))
    return json({
      total: found.length,
      missing,
      ads: found.map(a => pick(a, p.get('fields') === 'full' ? (Object.keys(a) as (keyof AdRecord)[]) : SLIM)),
    })
  }

  const industry = list(p.get('industry'))
  const archetype = list(p.get('archetype'))
  const mood = list(p.get('mood'))
  const layout = list(p.get('layout'))
  const person = p.get('person')          // 'with' | 'no'
  const q = (p.get('q') ?? '').trim().toLowerCase()

  let hits = ads
  if (industry.length) hits = hits.filter(a => industry.includes(lower(a.industry)))
  if (archetype.length) hits = hits.filter(a => archetype.includes(lower(a.ad_archetype)))
  if (mood.length) hits = hits.filter(a => mood.includes(lower(a.color_mood)))
  if (layout.length) hits = hits.filter(a => layout.includes(lower(a.layout_style)))
  if (person === 'with' || person === 'no') hits = hits.filter(a => !!a.has_person === (person === 'with'))
  if (q) {
    hits = hits.filter(a =>
      lower(a.brand).includes(q) || lower(a.description).includes(q) ||
      lower(a.transferable_concept).includes(q) || lower(a.text_overlay).includes(q) ||
      lower(a.industry).includes(q) || lower(a.ad_archetype).includes(q) ||
      (a.tags ?? []).some(t => lower(t).includes(q)),
    )
  }

  // facets=1: just the filter lists with counts, for a picker's dropdowns.
  if (p.get('facets') === '1') {
    return json({
      total: hits.length,
      facets: {
        industry: countBy(hits, 'industry'),
        archetype: countBy(hits, 'ad_archetype'),
        mood: countBy(hits, 'color_mood'),
        layout: countBy(hits, 'layout_style'),
        with_person: hits.filter(a => a.has_person).length,
      },
    })
  }

  const limit = Math.min(Math.max(Number(p.get('limit') ?? 60) || 60, 1), MAX_LIMIT)
  const offset = Math.max(Number(p.get('offset') ?? 0) || 0, 0)
  const fields = p.get('fields') === 'full' ? null : SLIM
  const page = hits.slice(offset, offset + limit)
  return json({
    total: hits.length,
    count: page.length,
    offset,
    next_offset: offset + page.length < hits.length ? offset + page.length : null,
    ads: page.map(a => (fields ? pick(a, fields) : a)),
  })
}

/** Shared by every answer: the library changes rarely, so let the CDN hold it. */
function json(body: unknown) {
  return NextResponse.json(body, {
    headers: { 'Cache-Control': 'private, max-age=300, stale-while-revalidate=3600' },
  })
}
