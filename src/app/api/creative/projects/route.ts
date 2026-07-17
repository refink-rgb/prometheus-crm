import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { bearerToken, validateEditorToken } from '@/lib/editor-auth'

export const runtime = 'nodejs'

/**
 * GET /api/creative/projects?brand=<name|id>
 *
 * Token-authed (Authorization: Bearer <editor token>), read-only.
 * Lists projects the token may access, for the external creative skill's
 * pick step. Omit `brand` to list everything in the token's scope.
 */
export async function GET(request: Request) {
  const supabase = createServiceClient()
  const auth = await validateEditorToken(supabase, bearerToken(request))
  if (!auth) {
    return NextResponse.json({ error: 'Invalid or missing editor token.' }, { status: 401 })
  }

  const url = new URL(request.url)
  const brand = url.searchParams.get('brand')?.trim()

  // Start from the token's brand scope (null = all brands).
  let brandIds: string[] | null =
    auth.allowed_brand_ids && auth.allowed_brand_ids.length ? auth.allowed_brand_ids : null

  // Narrow by the requested brand (id or name), intersected with the scope.
  if (brand) {
    let bq = supabase.from('brands').select('id')
    if (/^[0-9a-f-]{36}$/i.test(brand)) bq = bq.eq('id', brand)
    else bq = bq.ilike('name', `%${brand}%`)
    const { data: matched } = await bq
    const matchedIds = (matched ?? []).map((b) => b.id as string)
    brandIds = brandIds ? brandIds.filter((id) => matchedIds.includes(id)) : matchedIds
    if (brandIds.length === 0) return NextResponse.json({ projects: [] })
  }

  let pq = supabase
    .from('projects')
    .select('id, name, brand_id, offer, discount, creatives_stage, is_complete, due_date')
    .order('due_date', { ascending: false })
  if (brandIds) pq = pq.in('brand_id', brandIds)

  const { data: projects, error } = await pq
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Resolve brand names in one query and map (avoids relying on FK embeds).
  const ids = Array.from(new Set((projects ?? []).map((p) => p.brand_id as string)))
  const nameById = new Map<string, string>()
  if (ids.length) {
    const { data: brands } = await supabase.from('brands').select('id, name').in('id', ids)
    for (const b of brands ?? []) nameById.set(b.id as string, b.name as string)
  }

  return NextResponse.json({
    projects: (projects ?? []).map((p) => ({
      project_id: p.id,
      brand: nameById.get(p.brand_id as string) ?? null,
      name: p.name,
      offer: p.offer,
      discount: p.discount,
      creatives_stage: p.creatives_stage,
      is_complete: p.is_complete,
    })),
  })
}
