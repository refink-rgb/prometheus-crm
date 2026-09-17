import { NextResponse } from 'next/server'
import { runResultsPull } from '@/lib/meta/engine'

// Nightly results ingestion — the in-app replacement for the scheduled Claude
// agent (dead since Aug 18 and retired for good; see RESULTS_AGENT_PROMPT.md).
// Scheduled in vercel.json; also callable on demand with either secret:
//
//   curl -H "Authorization: Bearer $CRON_SECRET_or_RESULTS_INGEST_SECRET" \
//     https://<host>/api/cron/results-pull[?brand_id=<uuid>]
//
// Everything it writes goes through POST /api/results/ingest, so validation,
// manual-row protection, and the audit log apply unchanged.

export const runtime = 'nodejs'
export const maxDuration = 300

function authorized(request: Request): boolean {
  const auth = request.headers.get('authorization')
  return [process.env.CRON_SECRET, process.env.RESULTS_INGEST_SECRET]
    .some(secret => secret && auth === `Bearer ${secret}`)
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  const params = new URL(request.url).searchParams
  const brandId = params.get('brand_id') ?? undefined
  const brand = params.get('brand') ?? undefined

  try {
    const summary = await runResultsPull({ brandId, brand })
    // Errors inside the summary are per-entity and non-fatal; a run that
    // pulled 19 of 20 brands is a success with one loud line, not a failure.
    for (const e of summary.errors) console.error(`[results-pull] ${e}`)
    return NextResponse.json({ ok: true, ...summary })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[results-pull] run failed: ${msg}`)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
