import BfcmProjectsTable from '@/components/bfcm/BfcmProjectsTable'
import BfcmAddProject from '@/components/bfcm/BfcmAddProject'
import { parsePlanConfig } from '@/lib/bfcm/content'
import { listStaffPlans, listBfcmBrandOptions } from '@/lib/bfcm/server'
import { type TaskNode } from '@/lib/bfcm/production'
import { projectRow } from '@/lib/bfcm/project-list'
import { loadAllProductionTrees } from '@/lib/bfcm/production-server'
import { easternToday } from '@/lib/eastern'

const normalizedName = (name: string) => name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

export const dynamic = 'force-dynamic'
export default async function BfcmCreativesPage() {
  const [{ plans, unavailable }, options] = await Promise.all([listStaffPlans(), listBfcmBrandOptions()])
  const trees = unavailable ? new Map<string, TaskNode[]>() : await loadAllProductionTrees()
  const today = easternToday()
  const configured = plans.flatMap(plan => { const config = parsePlanConfig(plan.config, plan.slug); return config ? [{ plan, brand: config.brand }] : [] })
  return <main style={{ padding: '40px clamp(20px,4vw,64px)', maxWidth: 1400, margin: 'auto' }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', marginBottom: 32 }}><h1 style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-.03em', margin: 0 }}>BFCM Creatives</h1><BfcmAddProject unavailable={unavailable || options.unavailable} brands={options.brands.map(brand => ({ ...brand, existingSlug: plans.find(plan => plan.brand_id === brand.id)?.slug ?? configured.find(item => normalizedName(brand.name) && normalizedName(item.brand.name) === normalizedName(brand.name))?.plan.slug ?? null }))} /></div>
    {unavailable && <div role="alert" className="card" style={{ marginBottom: 24 }}>Unable to load plans. Try again.</div>}
    {!unavailable && options.unavailable && <p role="alert">Unable to load brand choices. Reload to add a project.</p>}
    {!unavailable && <BfcmProjectsTable projects={configured.map(({ brand, plan }) => projectRow(plan, brand.name, trees.get(plan.slug) ?? []))} today={today} />}
  </main>
}
