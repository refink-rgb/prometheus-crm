import Link from 'next/link'
import { parsePlanConfig } from '@/lib/bfcm/content'
import { listStaffPlans } from '@/lib/bfcm/server'

export const dynamic = 'force-dynamic'
export default async function BfcmCreativesPage() {
  const { plans, unavailable } = await listStaffPlans()
  const configured = plans.flatMap(plan => { const config = parsePlanConfig(plan.config, plan.slug); return config ? [{ plan, brand: config.brand }] : [] })
  return <main style={{ padding: '40px clamp(20px,4vw,64px)', maxWidth: 1400, margin: 'auto' }}>
    <h1 style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-.03em', margin: '0 0 32px' }}>BFCM Creatives</h1>
    {unavailable && <div role="alert" className="card" style={{ marginBottom: 24 }}>Unable to load plans. Try again.</div>}
    {!unavailable && configured.length === 0 && <p>No plans.</p>}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 20 }}>
      {configured.map(({ brand, plan }) => {
        const locked = (plan?.state as { status?: string } | null)?.status === 'locked'
        return <Link key={brand.slug} href={`/bfcm-creatives/${brand.slug}`} className="card" style={{ display: 'block', padding: 26, textDecoration: 'none', color: 'var(--text-primary)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{locked ? 'Plan locked' : plan?.version ? 'In progress' : 'Ready to start'}</span><span aria-hidden="true">↗</span></div>
          <h2 style={{ fontSize: 22, fontWeight: 700, margin: '24px 0' }}>{brand.name}</h2>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Open plan →</span>
        </Link>
      })}
    </div>
  </main>
}
