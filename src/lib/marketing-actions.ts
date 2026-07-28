'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { canEdit } from '@/lib/permissions'
import type { CaseStudy } from '@/data/case-studies/types'
import { buildReportCaseStudy, type ReportInputs } from '@/data/case-studies/buildReport'

export interface GenerateReportResult {
  token: string
  caseStudy: CaseStudy
}

async function requireEditor() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated.')
  if (!canEdit(user.email)) throw new Error('Not authorized.')
  return supabase
}

// Hard anonymization guard for TEXT fields: the brand name must not appear in
// the report's text. We deliberately DON'T scan the LP/creative image URLs — the
// featured landing-page image is an explicit, intentional inclusion. We know the
// brand from the project, so a leak in copy is a blocking error, not a silent ship.
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
    throw new Error(
      `Anonymization blocked: the brand name "${brandName}" appears in the report text (copy, labels, captions). Remove it before generating.`,
    )
  }
}

export async function generateMarketingReport(
  projectId: string,
  input: ReportInputs,
): Promise<GenerateReportResult> {
  const supabase = await requireEditor()

  // Look up the project + its brand name (for the leak guard).
  const { data: project } = await supabase
    .from('projects')
    .select('id, brand_id')
    .eq('id', projectId)
    .single()
  if (!project) throw new Error('Project not found.')

  let brandName: string | null = null
  if (project.brand_id) {
    const { data: brand } = await supabase
      .from('brands')
      .select('name')
      .eq('id', project.brand_id)
      .single()
    brandName = brand?.name ?? null
  }

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
  if (error) throw new Error(`Could not save report: ${error.message}`)

  revalidatePath('/marketing')
  return { token, caseStudy: data }
}

// Delete a generated report (unpublish). The public URL 404s afterwards.
export async function deleteMarketingReport(projectId: string): Promise<void> {
  const supabase = await requireEditor()
  const { error } = await supabase.from('marketing_reports').delete().eq('project_id', projectId)
  if (error) throw new Error(`Could not delete report: ${error.message}`)
  revalidatePath('/marketing')
}
