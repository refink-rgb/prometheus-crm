'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { canEdit } from '@/lib/permissions'
import type { CaseStudy } from '@/data/case-studies/types'
import { buildReportCaseStudy, type ReportInputs } from '@/data/case-studies/buildReport'
import {
  clearUnscannedRegions,
  listScanTargets,
  scanImageForBrandMarks,
  setScanRegions,
  type ScanTarget,
} from '@/lib/ai/brand-mark-scan'

/**
 * Result rather than a thrown error: Next.js replaces messages thrown from
 * server actions with a generic digest in production, which would hide the
 * anonymization-block message — the one message the author most needs to read.
 */
export type GenerateReportResult =
  | { ok: true; token: string; caseStudy: CaseStudy }
  | { ok: false; message: string }

export type SimpleResult = { ok: true } | { ok: false; message: string }

class ReportError extends Error {}

// Our own messages are safe and useful to show; anything else is logged so the
// real cause reaches the Vercel logs rather than vanishing into a digest.
function toMessage(e: unknown, fallback: string): string {
  if (e instanceof ReportError) return e.message
  const detail = e instanceof Error ? e.message : String(e)
  console.error('[marketing-report]', detail)
  return `${fallback} ${detail}`
}

async function requireEditor() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new ReportError('Not authenticated.')
  if (!canEdit(user.email)) throw new ReportError('Not authorized.')
  return supabase
}

// Hard anonymization guard for TEXT fields: the brand name must not appear in
// the report's text. We deliberately DON'T scan the LP/creative image URLs — the
// featured landing-page image is an explicit, intentional inclusion. We know the
// brand from the project, so a leak in copy is a blocking error, not a silent ship.
// The brand name burned INTO those images is handled separately, by the
// brand-mark scan below, which blurs it rather than blocking the report.
function assertNoBrandLeak(data: CaseStudy, brandName: string | null) {
  if (!brandName) return
  const needle = brandName.trim().toLowerCase()
  if (needle.length < 3) return // too short to match safely
  // Scan text only — strip image src URLs (uploaded assets) from the scan.
  const clone: CaseStudy = JSON.parse(JSON.stringify(data))
  clone.landing.image.src = null
  clone.creatives.forEach((c) => {
    c.media.poster.src = null
    c.media.video = null
  })
  if (JSON.stringify(clone).toLowerCase().includes(needle)) {
    throw new ReportError(
      `Anonymization blocked: the brand name "${brandName}" appears in the report text (copy, labels, captions). Remove it before generating.`,
    )
  }
}

// The brand behind a project — what both the text guard and the image scan
// need, and the one thing that must never reach the report itself.
async function brandNameFor(
  supabase: Awaited<ReturnType<typeof requireEditor>>,
  projectId: string,
): Promise<string | null> {
  const { data: project } = await supabase
    .from('projects')
    .select('id, brand_id')
    .eq('id', projectId)
    .single()
  if (!project) throw new ReportError('Project not found.')
  if (!project.brand_id) return null

  const { data: brand } = await supabase
    .from('brands')
    .select('name')
    .eq('id', project.brand_id)
    .single()
  return brand?.name ?? null
}

export async function generateMarketingReport(
  projectId: string,
  input: ReportInputs,
): Promise<GenerateReportResult> {
  try {
  const supabase = await requireEditor()
  const brandName = await brandNameFor(supabase, projectId)

  // Reuse this project's existing token so the public URL stays STABLE across
  // edits — a link already shared in Slack must keep working after a
  // regenerate. Only mint a token the first time a report is created.
  const { data: existing } = await supabase
    .from('marketing_reports')
    .select('report_token')
    .eq('project_id', projectId)
    .maybeSingle()

  let token = existing?.report_token as string | undefined
  if (!token) {
    const { randomBytes } = await import('crypto')
    token = randomBytes(20).toString('hex')
  }

  // Derive the full report from the simplified inputs (creative labels are
  // forced to "Creative NN" inside the builder — original ad names never enter).
  const data = buildReportCaseStudy(input, token)

  // Block the ship if the brand leaked into any TEXT field.
  assertNoBrandLeak(data, brandName)

  // The brand-mark scan deliberately does NOT run here. It is minutes of vision
  // calls over assets that can be 50 megapixels; putting it in this action once
  // cost the author their filled-in form when the function ran out of memory.
  // The report saves first, then the client scans one image at a time.

  // One report per project — regenerating overwrites the content but keeps the
  // token. onConflict targets the UNIQUE project_id constraint.
  const { error } = await supabase.from('marketing_reports').upsert(
    {
      project_id: projectId,
      report_token: token,
      data,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'project_id' },
  )
  if (error) throw new ReportError(`Could not save report: ${error.message}`)

  revalidatePath('/marketing')
  return { ok: true, token, caseStudy: data }
  } catch (e) {
    return { ok: false, message: toMessage(e, 'Could not generate the report.') }
  }
}

// ─── Brand-mark scan ─────────────────────────────────────────────────────────
//
// Driven from the client, one image per call. Splitting it this way is what
// keeps it inside the serverless time limit: a landing-page screenshot is a
// dozen vision calls on its own, and batching every asset into one request is
// what made the first version fail. Each call is independently retryable, and
// the report on screen is already saved and live before any of this runs.

export type ScanTargetsResult =
  | { ok: true; targets: { key: string; label: string }[] }
  | { ok: false; message: string }

export type ScanImageResult = { ok: true; regions: number } | { ok: false; message: string }

/** Load a project's stored report, or fail with a message the author can act on. */
async function loadReport(
  supabase: Awaited<ReturnType<typeof requireEditor>>,
  projectId: string,
): Promise<CaseStudy> {
  const { data: row } = await supabase
    .from('marketing_reports')
    .select('data')
    .eq('project_id', projectId)
    .maybeSingle()
  if (!row?.data) throw new ReportError('No report to scan — generate one first.')
  return row.data as CaseStudy
}

/** The assets in this project's report that can be scanned, in page order. */
export async function listReportScanTargets(projectId: string): Promise<ScanTargetsResult> {
  try {
    const supabase = await requireEditor()
    const brandName = await brandNameFor(supabase, projectId)
    if (!brandName) {
      throw new ReportError('This project has no brand on record, so there is nothing to scan for.')
    }
    const data = await loadReport(supabase, projectId)
    const targets: ScanTarget[] = listScanTargets(data)
    return { ok: true, targets: targets.map(({ key, label }) => ({ key, label })) }
  } catch (e) {
    return { ok: false, message: toMessage(e, 'Could not list the report images.') }
  }
}

/**
 * Scan ONE image and store its blur regions. Re-reads the report each call so
 * concurrent scans of different images cannot clobber each other's regions.
 */
export async function scanReportImage(projectId: string, key: string): Promise<ScanImageResult> {
  try {
    const supabase = await requireEditor()
    const brandName = await brandNameFor(supabase, projectId)
    if (!brandName) throw new ReportError('This project has no brand on record.')

    const data = await loadReport(supabase, projectId)
    const target = listScanTargets(data).find((t) => t.key === key)
    if (!target) throw new ReportError('That image is no longer part of the report.')

    const regions = await scanImageForBrandMarks(target.src, brandName)
    if (!setScanRegions(data, key, regions)) {
      throw new ReportError('That image is no longer part of the report.')
    }
    // Also strips blurs left on the creatives by earlier, wider scans.
    clearUnscannedRegions(data)

    const { error } = await supabase
      .from('marketing_reports')
      .update({ data, updated_at: new Date().toISOString() })
      .eq('project_id', projectId)
    if (error) throw new ReportError(`Could not save the blur regions: ${error.message}`)

    revalidatePath('/marketing')
    return { ok: true, regions: regions.length }
  } catch (e) {
    return { ok: false, message: toMessage(e, 'Could not scan that image.') }
  }
}

// Delete a generated report (unpublish). The public URL 404s afterwards.
export async function deleteMarketingReport(projectId: string): Promise<SimpleResult> {
  try {
    const supabase = await requireEditor()
    const { error } = await supabase.from('marketing_reports').delete().eq('project_id', projectId)
    if (error) throw new ReportError(`Could not delete report: ${error.message}`)
    revalidatePath('/marketing')
    return { ok: true }
  } catch (e) {
    return { ok: false, message: toMessage(e, 'Could not remove the report.') }
  }
}
