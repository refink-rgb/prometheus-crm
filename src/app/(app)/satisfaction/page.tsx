import { redirect } from 'next/navigation'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { getCachedProfiles } from '@/lib/profiles'
import { canViewDashboard } from '@/lib/permissions'
import { easternToday } from '@/lib/eastern'
import { loadDashboard } from '@/lib/dashboard/load'
import { REVIEW_COLUMNS, type SatisfactionReview } from '@/lib/satisfaction'
import SatisfactionBoard, { type SatisfactionClient } from '@/components/satisfaction/SatisfactionBoard'

// Reads the Dashboard's data too, for the CRM signals shown next to each rating.
export const maxDuration = 60

const MISSING_TABLE = new Set(['42P01', 'PGRST205'])

export default async function SatisfactionPage() {
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) redirect('/login')
  const profiles = await getCachedProfiles()
  const me = profiles.find(p => p.email === user.email?.toLowerCase()) ?? null
  if (!canViewDashboard(user.email, me)) redirect('/')

  const today = easternToday()

  const [{ data: brandRows }, reviewsRes, dashboard] = await Promise.all([
    supabase.from('brands').select('id, name, is_active').order('name'),
    // One row per client, so a few hundred at most: one request is enough.
    supabase.from('client_satisfaction').select(REVIEW_COLUMNS),
    loadDashboard(supabase, today),
  ])

  const tableMissing = MISSING_TABLE.has(reviewsRes.error?.code ?? '')
  const byBrand = new Map<string, SatisfactionReview>()
  for (const r of (reviewsRes.data ?? []) as unknown as SatisfactionReview[]) {
    byBrand.set(r.brand_id, { ...r, score: r.score === null ? null : Number(r.score) })
  }

  const signals = new Map<string, string[]>()
  for (const c of dashboard.concerns) {
    if (!c.brandId || c.flags.length === 0) continue
    signals.set(c.brandId, c.flags.map(f => f.label))
  }

  // Active clients, plus any inactive brand that was rated or tagged before
  // (so a churned client doesn't vanish once its brand is deactivated).
  const clients: SatisfactionClient[] = ((brandRows ?? []) as Array<{ id: string; name: string; is_active: boolean }>)
    .filter(b => b.is_active || byBrand.has(b.id))
    .map(b => ({
      brandId: b.id,
      name: b.name,
      isActive: b.is_active,
      review: byBrand.get(b.id) ?? null,
      signals: signals.get(b.id) ?? [],
    }))

  return (
    <div className="dashboard-page" style={{ padding: 'var(--space-6) 32px 40px' }}>
      <div style={{ marginBottom: 'var(--space-5)' }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: 4 }}>
          Client Satisfaction
        </h1>
        <p style={{ fontSize: 'var(--text-base)', color: 'var(--text-muted)' }}>
          Grade each client 1–5 on five topics. Click a client to add or update its review.
        </p>
      </div>

      {tableMissing && (
        <div style={{
          padding: 'var(--space-4) var(--space-5)', marginBottom: 'var(--space-6)', borderRadius: 10, lineHeight: 1.6,
          background: 'color-mix(in srgb, var(--warning) 10%, var(--surface-1))',
          border: '1px solid color-mix(in srgb, var(--warning) 35%, var(--border))', fontSize: 'var(--text-base)',
        }}>
          <strong>Satisfaction table not found.</strong> Run{' '}
          <code>supabase/migrations/20261103c_client_satisfaction.sql</code> in the Supabase SQL editor, then reload.
        </div>
      )}

      <SatisfactionBoard clients={clients} today={today} />
    </div>
  )
}
