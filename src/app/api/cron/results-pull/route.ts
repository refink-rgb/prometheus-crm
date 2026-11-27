import { NextResponse } from 'next/server'
import { runResultsPull } from '@/lib/meta/engine'
import { createServiceClient } from '@/lib/supabase/service'

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
    if (summary.errors.length > 0) await logEngineRun(summary.errors, summary.rows_posted)
    return NextResponse.json({ ok: true, ...summary })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[results-pull] run failed: ${msg}`)
    await logEngineRun([`run failed: ${msg}`], 0)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

// The ingest POST only writes its audit row when there is something to post.
// A run where EVERY Meta call fails (an expired token) posts nothing, so it
// left no trace but a Vercel log line — that is how the Nov 16 token expiry
// went unseen for 11 days. Engine errors get their own audit row, marked
// source='engine', which the /results banner reads. Best-effort: a logging
// failure never turns the run into an error.
async function logEngineRun(errors: string[], rowsPosted: number) {
  try {
    const { error } = await createServiceClient().from('campaign_result_ingests').insert({
      date_range: null,
      rows_received: 0,
      rows_upserted: 0,
      rows_rejected: 0,
      warnings: {
        source: 'engine',
        rows_posted: rowsPosted,
        error_count: errors.length,
        // Bounded: one bad token fails every entity with the same message.
        engine_errors: errors.slice(0, 25),
      },
    })
    if (error) console.error(`[results-pull] engine audit write failed: ${error.message}`)
  } catch (err) {
    console.error(`[results-pull] engine audit write failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}
