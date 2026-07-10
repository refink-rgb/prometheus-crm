import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createBrand } from '@/lib/actions'
import ProfitEngineerSelect from '@/components/ProfitEngineerSelect'

export default async function NewBrandPage() {
  const supabase = await createClient()

  const { data: peRows } = await supabase
    .from('profit_engineers')
    .select('name')
    .order('name', { ascending: true })
  const engineerNames = (peRows ?? []).map((r: { name: string }) => r.name)

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)' }}>
      <main style={{ maxWidth: 600, margin: '0 auto', padding: '28px 32px 40px' }}>
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
            <Link href="/brands" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>← Brands</Link>
            <span style={{ opacity: 0.5 }}>/</span>
            <span style={{ color: 'var(--text-primary)' }}>New brand</span>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: 6 }}>
            Create a brand
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            Add a new Prometheus client to get started.
          </p>
        </div>

        <div className="card">
          <form action={createBrand}>
            <div style={{ marginBottom: 20 }}>
              <label htmlFor="name">Brand name *</label>
              <input id="name" name="name" type="text" placeholder="e.g. Aura Skincare" required autoFocus />
            </div>

            <div style={{ marginBottom: 20 }}>
              <label htmlFor="website">Website URL *</label>
              <input id="website" name="website" type="text" inputMode="url" autoComplete="url" placeholder="eyemuse.my or https://eyemuse.my" required />
            </div>

            <div style={{ marginBottom: 28 }}>
              <label>Assigned Profit Engineer *</label>
              <ProfitEngineerSelect engineers={engineerNames} current={null} />
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <button type="submit" className="btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
                Create brand →
              </button>
              <Link href="/brands" className="btn-secondary" style={{ justifyContent: 'center', padding: '10px 20px' }}>
                Cancel
              </Link>
            </div>
          </form>
        </div>
      </main>
    </div>
  )
}
