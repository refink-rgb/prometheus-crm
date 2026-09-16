// Minimal Meta Marketing API client for the in-app results engine.
//
// Server-side ONLY: reads META_ACCESS_TOKEN (the Business Manager system-user
// token with ads_read, set in Vercel) and never lets it reach a response, a
// log line, or an error message — errors are re-thrown with the token
// stripped from any URL Meta echoes back.

const GRAPH = 'https://graph.facebook.com/v23.0'

export class MetaApiError extends Error {
  constructor(
    message: string,
    public readonly code: number | null,
    public readonly httpStatus: number,
  ) {
    super(message)
    this.name = 'MetaApiError'
  }
}

function token(): string {
  const t = (process.env.META_ACCESS_TOKEN ?? '').trim().replace(/^["']|["']$/g, '')
  if (!t) throw new MetaApiError('META_ACCESS_TOKEN is not set.', null, 0)
  return t
}

function scrub(s: string): string {
  return s.replaceAll(token(), '<token>')
}

/** One GET against the Graph API. `params` values are serialized as-is
 *  (arrays/objects JSON-encoded, the way the Marketing API expects). */
export async function metaGet<T = Record<string, unknown>>(
  path: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const url = new URL(`${GRAPH}/${path.replace(/^\//, '')}`)
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue
    url.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v))
  }
  url.searchParams.set('access_token', token())

  const res = await fetch(url)
  const body = (await res.json().catch(() => ({}))) as T & {
    error?: { message?: string; code?: number }
  }
  if (!res.ok || body.error) {
    throw new MetaApiError(
      scrub(body.error?.message ?? `HTTP ${res.status}`),
      body.error?.code ?? null,
      res.status,
    )
  }
  return body
}

/** Follows `paging.next` and concatenates `data` pages. `maxPages` bounds a
 *  runaway listing; hitting the bound returns what was collected (the daily
 *  trailing re-pull self-heals any tail that got cut). */
export async function metaGetAll<Row>(
  path: string,
  params: Record<string, unknown>,
  maxPages = 20,
): Promise<Row[]> {
  const rows: Row[] = []
  let body = await metaGet<{ data?: Row[]; paging?: { next?: string } }>(path, params)
  for (let page = 0; page < maxPages; page++) {
    rows.push(...(body.data ?? []))
    const next = body.paging?.next
    if (!next) break
    const res = await fetch(next) // paging.next already carries every param
    const parsed = (await res.json().catch(() => ({}))) as typeof body & {
      error?: { message?: string; code?: number }
    }
    if (!res.ok || parsed.error) {
      throw new MetaApiError(
        scrub(parsed.error?.message ?? `HTTP ${res.status}`),
        parsed.error?.code ?? null,
        res.status,
      )
    }
    body = parsed
  }
  return rows
}

// ---------------------------------------------------------------------------
// Insights row helpers
// ---------------------------------------------------------------------------

export interface InsightsRow {
  date_start: string
  spend?: string
  impressions?: string
  ad_id?: string
  actions?: Array<{ action_type: string; value?: string; '7d_click'?: string }>
  action_values?: Array<{ action_type: string; value?: string; '7d_click'?: string }>
}

// Reads one action_type from an actions/action_values array, preferring the
// 7d_click-window value (we request action_attribution_windows=['7d_click'])
// and falling back to the account-default 'value'.
export function actionNumber(
  list: InsightsRow['actions'],
  ...types: string[]
): number | null {
  for (const t of types) {
    const entry = (list ?? []).find(e => e.action_type === t)
    if (entry) {
      const raw = entry['7d_click'] ?? entry.value
      if (raw !== undefined) return Number(raw)
    }
  }
  return null
}

export const INSIGHTS_FIELDS = 'spend,impressions,actions,action_values'
export const ATTRIBUTION = ['7d_click']
