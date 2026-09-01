import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { bearerToken, validateEditorToken } from '@/lib/editor-auth'
import { readProducts, readCompetitors, readTopPerformers, readCopyApprovals } from '@/lib/products'

export const runtime = 'nodejs'

interface ProjectRow {
  id: string
  name: string | null
  brand_id: string
  offer: string | null
  offer_description: string | null
  discount: string | null
  cta: string | null
  product_featured: string | null
  products: unknown
  competitors: unknown
  top_performers: unknown
  offer_summary: unknown
  copy_approvals: unknown
  product_description: string | null
  product_images_link: string | null
  retail_price: string | null
  ad_headlines: string[] | null
  ad_subcopies: string[] | null
  ad_eyebrows: string[] | null
  competitor_reference: string | null
  client_ad_inspiration: string | null
  marketing_moment: string | null
}

const PROJECT_COLS =
  'id, name, brand_id, offer, offer_description, discount, cta, product_featured, product_description, product_images_link, retail_price, ad_headlines, ad_subcopies, ad_eyebrows, competitor_reference, client_ad_inspiration, marketing_moment, products, competitors'

/**
 * GET /api/creative/project/[projectId]/bundle
 *
 * Token-authed (Authorization: Bearer <editor token>), read-only.
 * Returns everything the external creative skill needs for a run:
 * brand + active brand DNA + project copy/offer/product + resolved image URLs.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params
  const supabase = createServiceClient()

  const auth = await validateEditorToken(supabase, bearerToken(request))
  if (!auth) {
    return NextResponse.json({ error: 'Invalid or missing editor token.' }, { status: 401 })
  }

  const { data: projectData, error: pErr } = await supabase
    .from('projects')
    .select(PROJECT_COLS)
    .eq('id', projectId)
    .maybeSingle()
  const project = (projectData as unknown as ProjectRow | null) ?? null
  if (pErr || !project) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
  }

  // Enforce the token's brand scope.
  if (
    auth.allowed_brand_ids &&
    auth.allowed_brand_ids.length &&
    !auth.allowed_brand_ids.includes(project.brand_id)
  ) {
    return NextResponse.json({ error: 'Project not in token scope.' }, { status: 403 })
  }

  const [brandRes, dnaRes, imagesRes] = await Promise.all([
    supabase.from('brands').select('id, name, website, brand_notes, ai_sensitivity, brand_guidelines').eq('id', project.brand_id).maybeSingle(),
    supabase
      .from('brand_dna')
      .select('*')
      .eq('brand_id', project.brand_id)
      .eq('is_active', true)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from('project_images').select('storage_url').eq('project_id', project.id),
  ])

  const brand = brandRes.data as {
    id: string; name: string; website: string | null
    brand_notes: string | null; brand_guidelines: string | null; ai_sensitivity: number | null
  } | null
  const dna = dnaRes.data as (Record<string, unknown> & { version?: number }) | null
  const images = (imagesRes.data as Array<{ storage_url: string | null }> | null) ?? []

  const product_images = images
    .map((im) => ({ url: im.storage_url }))
    .filter((im): im is { url: string } => Boolean(im.url))

  return NextResponse.json({
    brand: brand ? {
      id: brand.id, name: brand.name, website: brand.website,
      // What the team knows about this client, and how much AI it tolerates.
      // A creative run that does not know Noble rejects AI-looking work is
      // going to produce AI-looking work for Noble.
      notes: brand.brand_notes ?? null,
      guidelines: brand.brand_guidelines ?? null,
      ai_sensitivity: brand.ai_sensitivity ?? null,
    } : null,
    brand_dna: dna,
    project: {
      id: project.id,
      name: project.name,
      offer: project.offer,
      offer_description: project.offer_description,
      discount: project.discount,
      cta: project.cta,
      product_featured: project.product_featured,
      // Structured lists, normalised server-side. product_featured stays for
      // existing consumers; these are additive.
      products: readProducts(project),
      competitors: readCompetitors(project),
      // A creative run should know which lines were signed off and which of the
      // client's own ads are working — both were invisible to it.
      top_performers: readTopPerformers(project),
      approved_copy: readCopyApprovals(project).lines.filter(l => l.status === 'approved').map(l => l.text),
      offer_summary: Array.isArray(project.offer_summary) ? project.offer_summary : null,
      product_description: project.product_description,
      product_images_link: project.product_images_link,
      retail_price: project.retail_price,
      ad_headlines: project.ad_headlines,
      ad_subcopies: project.ad_subcopies,
      ad_eyebrows: project.ad_eyebrows,
      competitor_reference: project.competitor_reference,
      client_ad_inspiration: project.client_ad_inspiration,
      marketing_moment: project.marketing_moment,
    },
    product_images,
    meta: {
      generated_at: new Date().toISOString(),
      dna_version: dna?.version ?? null,
    },
  })
}
