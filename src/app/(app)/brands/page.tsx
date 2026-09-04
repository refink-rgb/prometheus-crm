import Link from 'next/link'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { canEdit } from '@/lib/permissions'
import type { Brand, Project } from '@/lib/types'
import { profileName } from '@/lib/types'
import { getCachedProfiles } from '@/lib/profiles'
import BrandsGrid from '@/components/BrandsGrid'

type BrandWithProjects = Brand & { projects: Project[] }

export default async function BrandsPage() {
  const supabase = await createClient()
  const user = await getCachedUser()
  const isEditor = await canEdit(user?.email)

  // Grid reads brand.name/website/profit_engineer/id, the Active/Trial/Inactive
  // pill (is_trial, is_active, monthly_retainer), and per-project
  // due_date/is_complete/lp_stage/creatives_stage. Fetching `*, projects(*)`
  // was pulling every ad-copy JSON field per project for no reason.
  const [{ data: brands }, profiles] = await Promise.all([
    supabase
      .from('brands')
      .select('id, name, website, profit_engineer, is_active, is_trial, monthly_retainer, projects(name, due_date, created_at, is_complete, lp_stage, creatives_stage, lp_editor_id, creative_editor_id)')
      .order('name', { ascending: true }),
    getCachedProfiles(),
  ])

  const allBrands = (brands ?? []) as unknown as BrandWithProjects[]

  // Who is on this brand, answered by the LATEST project rather than by every
  // project it has ever had. A brand three years old has had six editors, and a
  // union of all of them says nothing about who to ask today.
  //
  // Latest = furthest-out due date, created_at breaking ties. Not "most
  // recently created": a brief written today for a moment in March is not more
  // current than the one shipping next week.
  const nameById = new Map(profiles.map(pr => [pr.id, profileName(pr)]))
  const editorsByBrand = new Map<string, { names: string[]; from: string | null }>()
  for (const b of allBrands) {
    const latest = [...(b.projects ?? [])].sort((x, y) =>
      (y.due_date ?? '').localeCompare(x.due_date ?? '') ||
      (y.created_at ?? '').localeCompare(x.created_at ?? ''),
    )[0]
    if (!latest) continue
    // LP and creative editor are separate columns and are usually two people.
    // Deduped, because on smaller brands they are one.
    const names = [...new Set(
      [latest.lp_editor_id, latest.creative_editor_id]
        .map(id => (id ? nameById.get(id) : null))
        .filter((n): n is string => !!n),
    )]
    if (names.length) editorsByBrand.set(b.id, { names, from: latest.name ?? null })
  }

  const withEditors = allBrands.map(b => ({ ...b, editors: editorsByBrand.get(b.id) ?? null }))

  return (
    <div style={{ padding: '28px 32px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: 4 }}>
            Brands
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {allBrands.length} brand{allBrands.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Link href="/brands/new" className="btn-primary">+ New Brand</Link>
      </div>

      <BrandsGrid brands={withEditors} canEdit={isEditor} />
    </div>
  )
}
