import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

// Meta API health check — the first brick of the in-app ingestion engine
// (the replacement for the scheduled-agent pipeline; see RESULTS_AGENT_PROMPT.md
// for the contract it will fulfill).
//
// GET, authed with the same RESULTS_INGEST_SECRET bearer as /api/results/ingest.
// Reads META_ACCESS_TOKEN (a Business Manager SYSTEM USER token with ads_read),
// asks Meta which ad accounts the token can reach, and cross-checks that list
// against brands.meta_ad_account_id — so one call answers both "does the token
// work" and "which brands can the engine actually pull".
//
// The token NEVER appears in a response, a log line, or an error message.

export const runtime = 'nodejs'
export const maxDuration = 30

const GRAPH = 'https://graph.facebook.com/v23.0'

function authorized(request: Request): boolean {
  const secret = process.env.RESULTS_INGEST_SECRET
  if (!secret) return false
  return request.headers.get('authorization') === `Bearer ${secret}`
}

interface MetaAdAccount {
  account_id: string
  name: string
  account_status: number
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  const token = process.env.META_ACCESS_TOKEN
  if (!token) {
    return NextResponse.json({
      ok: false,
      token_present: false,
      error: 'META_ACCESS_TOKEN is not set in this environment.',
    }, { status: 500 })
  }

  // The token's own reach: every ad account the system user was assigned.
  // Paged defensively even though one page of 500 covers this portfolio.
  const accounts: MetaAdAccount[] = []
  let url =
    `${GRAPH}/me/adaccounts?fields=account_id,name,account_status&limit=500&access_token=${encodeURIComponent(token)}`
  for (let page = 0; page < 5 && url; page++) {
    const res = await fetch(url)
    const body = (await res.json()) as {
      data?: MetaAdAccount[]
      paging?: { next?: string }
      error?: { message?: string; type?: string; code?: number }
    }
    if (!res.ok || body.error) {
      // Meta error messages are safe to relay (they never echo the token).
      return NextResponse.json({
        ok: false,
        token_present: true,
        error: `Meta API error: ${body.error?.message ?? res.statusText}`,
        error_code: body.error?.code ?? res.status,
      }, { status: 502 })
    }
    accounts.push(...(body.data ?? []))
    url = body.paging?.next ?? ''
  }

  // Cross-check against the brands we wired up.
  const supabase = createServiceClient()
  const { data: brandsRaw, error: brandsErr } = await supabase
    .from('brands')
    .select('name, meta_ad_account_id')
    .not('meta_ad_account_id', 'is', null)
    .eq('is_active', true)
    .order('name')

  const reachable = new Set(accounts.map(a => `act_${a.account_id}`))
  const brands = (brandsRaw ?? []) as Array<{ name: string; meta_ad_account_id: string }>
  const covered = brands.filter(b => reachable.has(b.meta_ad_account_id)).map(b => b.name)
  const missing = brands
    .filter(b => !reachable.has(b.meta_ad_account_id))
    .map(b => ({ name: b.name, meta_ad_account_id: b.meta_ad_account_id }))

  return NextResponse.json({
    ok: true,
    token_present: true,
    token_reaches_accounts: accounts.length,
    brands_wired: brands.length,
    brands_covered: covered.length,
    covered,
    // Brands whose act_… id the token CANNOT see — assign those ad accounts
    // to the prometheus-crm system user in Business settings (the same token
    // picks them up automatically; no regeneration needed).
    missing,
    ...(brandsErr ? { brands_read_error: brandsErr.message } : {}),
  })
}
