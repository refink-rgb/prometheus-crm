'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { canEdit } from '@/lib/permissions'
import type { CaseStudy, Creative } from '@/data/case-studies/types'

// Payload from the generate form — everything except the slug, which is the
// server-minted token.
export type MarketingReportInput = Omit<CaseStudy, 'slug'>

export interface GenerateReportResult {
  token: string
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

// Force neutral creative labels regardless of what the form submitted — the
// original ad names contain the brand and must never reach the payload.
function relabelCreatives(creatives: Creative[]): Creative[] {
  return creatives.map((c, i) => ({
    ...c,
    label: `Creative ${String(i + 1).padStart(2, '0')}`,
  }))
}

// Hard anonymization guard: the brand name must not appear anywhere in the
// serialized report. We know the brand from the project, so a leak is a blocking
// error rather than a silent ship.
function assertNoBrandLeak(data: CaseStudy, brandName: string | null) {
  if (!brandName) return
  const needle = brandName.trim().toLowerCase()
  if (needle.length < 3) return // too short to match safely
  if (JSON.stringify(data).toLowerCase().includes(needle)) {
    throw new Error(
      `Anonymization blocked: the brand name "${brandName}" appears in the report content. Remove every mention (copy, labels, captions) before generating.`,
    )
  }
}

export async function generateMarketingReport(
  projectId: string,
  input: MarketingReportInput,
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

  const { randomBytes } = await import('crypto')
  const token = randomBytes(20).toString('hex')

  const data: CaseStudy = {
    ...input,
    slug: token,
    creatives: relabelCreatives(input.creatives),
  }

  // Block the ship if the brand leaked into any field.
  assertNoBrandLeak(data, brandName)

  // One report per project — regenerating overwrites the row (keeps the token
  // fresh). onConflict targets the UNIQUE project_id constraint.
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
  return { token }
}

// Delete a generated report (unpublish). The public URL 404s afterwards.
export async function deleteMarketingReport(projectId: string): Promise<void> {
  const supabase = await requireEditor()
  const { error } = await supabase.from('marketing_reports').delete().eq('project_id', projectId)
  if (error) throw new Error(`Could not delete report: ${error.message}`)
  revalidatePath('/marketing')
}
