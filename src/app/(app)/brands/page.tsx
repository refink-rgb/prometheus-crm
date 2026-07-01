import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { canEdit } from '@/lib/permissions'
import type { Brand, Project } from '@/lib/types'
import BrandsGrid from '@/components/BrandsGrid'

type BrandWithProjects = Brand & { projects: Project[] }

export default async function BrandsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const isEditor = canEdit(user?.email)

  const { data: brands } = await supabase
    .from('brands')
    .select('*, projects(*)')
    .order('name', { ascending: true })

  const allBrands = (brands ?? []) as BrandWithProjects[]

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

      <BrandsGrid brands={allBrands} canEdit={isEditor} />
    </div>
  )
}
