import Link from 'next/link'
import BfcmMissing from '@/components/bfcm/BfcmMissing'
import BfcmAddProject from '@/components/bfcm/BfcmAddProject'
import { parsePlanConfig } from '@/lib/bfcm/content'
import { listStaffPlans, listBfcmBrandOptions } from '@/lib/bfcm/server'
import { effectiveStatus, productionSummary, type TaskNode } from '@/lib/bfcm/production'
import { loadAllProductionTrees } from '@/lib/bfcm/production-server'
import { easternToday } from '@/lib/eastern'

/** One pill for where a brand is now, from its first unfinished step. No tasks yet counts as waiting. */
const PILL = {
  waiting: { label: 'Waiting', color: 'var(--text-secondary)', bg: 'var(--bg-tertiary, rgba(127,127,127,.15))' },
  client: { label: 'Waiting on client', color: '#f5b54a', bg: 'rgba(245,166,35,.16)' },
  review: { label: 'Reviewing plan', color: '#7fb0ff', bg: 'rgba(47,111,214,.14)' },
  calibration: { label: 'Making calibrations', color: '#b994ff', bg: 'rgba(123,79,214,.14)' },
  ads: { label: 'Making ads', color: '#ff8f57', bg: 'rgba(255,107,43,.14)' },
  check: { label: 'Internal review', color: '#4fd1d1', bg: 'rgba(14,138,138,.14)' },
  done: { label: 'Done', color: '#74d27a', bg: 'rgba(46,125,50,.14)' },
}
function currentPill(next: TaskNode | null, total: number) {
  if (!total) return PILL.waiting
  if (!next) return PILL.done
  if (effectiveStatus(next) === 'waiting_client') return PILL.client
  if (next.kind === 'review') return PILL.review
  if (next.kind === 'samples' || next.kind.startsWith('calibration')) return PILL.calibration
  if (next.kind === 'statics' || next.kind === 'motion') return PILL.ads
  if (next.kind === 'check') return PILL.check
  // A custom task: show its own name.
  return { ...PILL.waiting, label: next.title, color: 'var(--text-primary)' }
}

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
    {!unavailable && configured.length === 0 && <p>No plans.</p>}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 20 }}>
      {configured.map(({ brand, plan }) => {
        const locked = (plan?.state as { status?: string } | null)?.status === 'locked'
        const production = productionSummary(trees.get(plan.slug) ?? [])
        return <Link key={brand.slug} href={`/bfcm-creatives/${brand.slug}`} className="card" style={{ display: 'block', padding: 26, textDecoration: 'none', color: 'var(--text-primary)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{locked ? 'Plan locked' : plan?.version ? 'In progress' : 'Onboarding not started yet'}</span><span aria-hidden="true">↗</span></div>
          <h2 style={{ fontSize: 22, fontWeight: 700, margin: '24px 0' }}>{brand.name}</h2>
          {(() => {
            const pill = currentPill(production.next, production.total)
            const late = !!production.next?.due_date && production.next.due_date < today
            return <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '-8px 0 20px' }}>
              <span style={{ fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 999, color: pill.color, background: pill.bg }}>{pill.label}</span>
              {late && <span style={{ fontSize: 12, color: 'var(--danger, #c0392b)' }}>late · due {production.next?.due_date}</span>}
            </div>
          })()}
          <span style={{ fontSize: 13, fontWeight: 600 }}>Open plan →</span>
          <BfcmMissing value={(plan.state as { missing?: unknown } | null)?.missing} />
        </Link>
      })}
    </div>
  </main>
}
