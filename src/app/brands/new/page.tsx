import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import Nav from '@/components/Nav'
import { createBrand } from '@/lib/actions'
import ProfitEngineerSelect from '@/components/ProfitEngineerSelect'

export default async function NewBrandPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: peRows } = await supabase
    .from('profit_engineers')
    .select('name')
    .order('name', { ascending: true })
  const engineerNames = (peRows ?? []).map((r: { name: string }) => r.name)

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)' }}>
      <Nav email={user?.email} />
      <main style={{ maxWidth: 600, margin: '0 auto', padding: '40px 24px' }}>
        <div style={{ marginBottom: 32 }}>
          <Link href="/" style={{ fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 20 }}>
            ← Dashboard
          </Link>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.03em', marginBottom: 6 }}>
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
              <input id="website" name="website" type="text" placeholder="eyemuse.my or https://eyemuse.my" required />
            </div>

            <div style={{ marginBottom: 28 }}>
              <label>Assigned Profit Engineer *</label>
              <ProfitEngineerSelect engineers={engineerNames} current={null} />
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <button type="submit" className="btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
                Create brand →
              </button>
              <Link href="/" className="btn-secondary" style={{ justifyContent: 'center', padding: '10px 20px' }}>
                Cancel
              </Link>
            </div>
          </form>
        </div>
      </main>
    </div>
  )
}
