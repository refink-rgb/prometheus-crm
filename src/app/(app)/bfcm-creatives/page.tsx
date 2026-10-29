import Link from 'next/link'
import BfcmAddProject from '@/components/bfcm/BfcmAddProject'
import { parsePlanConfig } from '@/lib/bfcm/content'
import { listStaffPlans, listBfcmBrandOptions } from '@/lib/bfcm/server'
import { productionSummary } from '@/lib/bfcm/production'
import { loadAllProductionSteps } from '@/lib/bfcm/production-server'
import { easternToday } from '@/lib/eastern'

const normalizedName = (name: string) => name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

export const dynamic = 'force-dynamic'
export default async function BfcmCreativesPage() {
  const [{ plans, unavailable }, options] = await Promise.all([listStaffPlans(), listBfcmBrandOptions()])
  const allSteps = unavailable ? [] : await loadAllProductionSteps()
  const today = easternToday()
  const configured = plans.flatMap(plan => { const config = parsePlanConfig(plan.config, plan.slug); return config ? [{ plan, brand: config.brand }] : [] })
  return <main style={{ padding: '40px clamp(20px,4vw,64px)', maxWidth: 1400, margin: 'auto' }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', marginBottom: 32 }}><h1 style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-.03em', margin: 0 }}>BFCM Creatives</h1><BfcmAddProject unavailable={unavailable || options.unavailable} brands={options.brands.map(brand => ({ ...brand, existingSlug: plans.find(plan => plan.brand_id === brand.id)?.slug ?? configured.find(item => normalizedName(brand.name) && normalizedName(item.brand.name) === normalizedName(brand.name))?.plan.slug ?? null }))} /></div>
    {unavailable && <div role="alert" className="card" style={{ marginBottom: 24 }}>Unable to load plans. Try again.</div>}
    {!unavailable && options.unavailable && <p role="alert">Unable to load brand choices. Reload to add a project.</p>}
    {!unavailable && configured.length === 0 && <p>No plans.</p>}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 20 }}>
      {configured.map(({ brand, plan }) => {
        const locked = (plan?.state as { status?: string } | null)?.status === 'locked'
        const production = productionSummary(allSteps.filter(s => s.plan_slug === plan.slug))
        return <Link key={brand.slug} href={`/bfcm-creatives/${brand.slug}`} className="card" style={{ display: 'block', padding: 26, textDecoration: 'none', color: 'var(--text-primary)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{locked ? 'Plan locked' : plan?.version ? 'In progress' : 'Onboarding not started yet'}</span><span aria-hidden="true">↗</span></div>
          <h2 style={{ fontSize: 22, fontWeight: 700, margin: '24px 0' }}>{brand.name}</h2>
          {production.total > 0 && <p style={{ fontSize: 13, margin: '-12px 0 20px', color: production.next?.due_date && production.next.due_date < today ? 'var(--danger, #c0392b)' : 'var(--text-secondary)' }}>{production.next ? `${production.done} of ${production.total} done · next: ${production.next.title}${production.next.due_date ? ` · due ${production.next.due_date}` : ''}` : 'Production done'}</p>}
          <span style={{ fontSize: 13, fontWeight: 600 }}>Open plan →</span>
        </Link>
      })}
    </div>
  </main>
}
