import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import Nav from '@/components/Nav'
import { canEdit } from '@/lib/permissions'
import type { Brand, Project, Stage } from '@/lib/types'
import DashboardTabs from '@/components/DashboardTabs'
import ProjectStatsCards from '@/components/ProjectStatsCards'
import ProjectsByStage from '@/components/ProjectsByStage'
import PipelineView from '@/components/PipelineView'
import BrandsView from '@/components/BrandsView'

type BrandWithProjects = Brand & { projects: Project[] }
type PipelineProject = Project & { brands: { id: string; name: string } }


function calcMonths(startDate: string): number {
  const start = new Date(startDate)
  const now = new Date()
  return Math.max(0,
    (now.getFullYear() - start.getFullYear()) * 12 +
    (now.getMonth() - start.getMonth()) + 1
  )
}

function fmtCurrency(n: number) {
  return '$' + n.toLocaleString('en-US')
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab: rawTab } = await searchParams
  const tab = rawTab ?? 'dashboard'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [{ data: brands }, { data: pipelineRaw }, { data: peRows }] = await Promise.all([
    supabase
      .from('brands')
      .select('*, projects(*)')
      .order('created_at', { ascending: false }),
    supabase
      .from('projects')
      .select('*, brands(id, name)')
      .eq('is_complete', false)
      .order('due_date', { ascending: true }),
    supabase
      .from('profit_engineers')
      .select('name')
      .order('name', { ascending: true }),
  ])

  const allPEs = (peRows ?? []).map((r: { name: string }) => r.name)
  const allBrands = (brands ?? []) as BrandWithProjects[]
  const pipeline = (pipelineRaw ?? []) as PipelineProject[]
  const isAuthorized = canEdit(user?.email)

  // Group brands by profit engineer, "Unassigned" last
  const peGroups: Array<{ pe: string; brands: BrandWithProjects[] }> = [
    ...allPEs.map(pe => ({
      pe,
      brands: allBrands.filter(b => b.profit_engineer === pe),
    })),
    {
      pe: 'Unassigned',
      brands: allBrands.filter(b => !b.profit_engineer || !allPEs.includes(b.profit_engineer)),
    },
  ].filter(g => g.brands.length > 0)

  // Revenue calculations (authorized users only)
  const billableClients = allBrands
    .filter(b => (b.monthly_retainer ?? 0) > 0)
    .sort((a, b) => (b.monthly_retainer ?? 0) - (a.monthly_retainer ?? 0))
  const activeClients = billableClients.filter(b => b.is_active)
  const mrr = activeClients.reduce((sum, b) => sum + (b.monthly_retainer ?? 0), 0)
  const revenueToDate = activeClients.reduce((sum, b) => {
    if (!b.start_date) return sum
    return sum + calcMonths(b.start_date) * (b.monthly_retainer ?? 0)
  }, 0)

  // Project stats for Tab 1
  const now = new Date()
  const inReview = pipeline.filter(p => p.lp_stage === 'review' || p.creatives_stage === 'review').length
  const overdue = pipeline.filter(p => p.due_date && new Date(p.due_date) < now).length

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  type ProjectWithUpdatedAt = Project & { updated_at?: string }
  const allProjects = allBrands.flatMap(b => b.projects as ProjectWithUpdatedAt[])
  const completedThisMonth = allProjects.filter(p =>
    p.is_complete &&
    p.updated_at &&
    new Date(p.updated_at) >= startOfMonth
  ).length

  // Stage breakdown counts
  const STAGES: Stage[] = ['brief', 'in_progress', 'review', 'done']
  const lpCounts = Object.fromEntries(
    STAGES.map(s => [s, pipeline.filter(p => p.lp_stage === s).length])
  ) as Record<Stage, number>
  const crCounts = Object.fromEntries(
    STAGES.map(s => [s, pipeline.filter(p => p.creatives_stage === s).length])
  ) as Record<Stage, number>

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)' }}>
      <Nav email={user?.email} />

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.03em', marginBottom: 6 }}>
              Prometheus Studio
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
              {allBrands.length} brand{allBrands.length !== 1 ? 's' : ''} · {pipeline.length} active project{pipeline.length !== 1 ? 's' : ''}
            </p>
          </div>
          <Link href="/brands/new" className="btn-primary">+ New Brand</Link>
        </div>

        {/* Tab navigation */}
        <DashboardTabs active={tab} />

        {/* ── Tab 1: Dashboard ── */}
        {tab === 'dashboard' && (
          <>
            <ProjectStatsCards
              totalActive={pipeline.length}
              inReview={inReview}
              overdue={overdue}
              completedThisMonth={completedThisMonth}
            />

            <ProjectsByStage lpCounts={lpCounts} crCounts={crCounts} />

            {isAuthorized && (
              <section>
                <h2 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 16 }}>
                  Revenue
                </h2>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 20 }}>
                  <StatCard
                    label="Monthly Recurring Revenue"
                    value={fmtCurrency(mrr)}
                    sub={`${activeClients.length} active client${activeClients.length !== 1 ? 's' : ''}`}
                    accent
                  />
                  <StatCard
                    label="Revenue to Date"
                    value={fmtCurrency(revenueToDate)}
                    sub={revenueToDate > 0 ? 'based on retainer start dates' : 'set start dates on each brand'}
                  />
                  <StatCard
                    label="Next Month Forecast"
                    value={fmtCurrency(mrr)}
                    sub="based on current retainers"
                  />
                </div>

                {billableClients.length > 0 ? (
                  <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 200px 110px 120px 140px', gap: 16, padding: '10px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface-raised)' }}>
                      {['Brand', 'Profit Engineer', 'Started', 'Monthly', 'To Date'].map(col => (
                        <span key={col} style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{col}</span>
                      ))}
                    </div>
                    {billableClients.map((brand, i) => {
                      const months = brand.start_date ? calcMonths(brand.start_date) : null
                      const toDate = months !== null ? months * (brand.monthly_retainer ?? 0) : null
                      return (
                        <Link key={brand.id} href={`/brands/${brand.id}`} style={{ textDecoration: 'none', display: 'block' }}>
                          <div className="pipeline-row" style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr 200px 110px 120px 140px',
                            gap: 16,
                            padding: '13px 20px',
                            borderBottom: i < billableClients.length - 1 ? '1px solid var(--border)' : 'none',
                            alignItems: 'center',
                            opacity: brand.is_active ? 1 : 0.45,
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {brand.name}
                              </span>
                              {!brand.is_active && (
                                <span className="badge badge-brief" style={{ flexShrink: 0 }}>Inactive</span>
                              )}
                            </div>
                            <span style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {brand.profit_engineer ?? '—'}
                            </span>
                            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                              {brand.start_date
                                ? new Date(brand.start_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
                                : '—'}
                            </span>
                            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                              {fmtCurrency(brand.monthly_retainer ?? 0)}
                            </span>
                            <span style={{ fontSize: 14, fontWeight: 700, color: toDate ? 'var(--success)' : 'var(--text-muted)' }}>
                              {toDate !== null ? fmtCurrency(toDate) : '—'}
                            </span>
                          </div>
                        </Link>
                      )
                    })}
                  </div>
                ) : (
                  <div style={{ padding: '24px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--text-muted)', fontSize: 14, textAlign: 'center' }}>
                    No retainers set yet — open a brand and fill in Monthly Retainer + Start Date.
                  </div>
                )}
              </section>
            )}

            {allBrands.length === 0 && (
              <div style={{ textAlign: 'center', padding: '80px 24px' }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>🚀</div>
                <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>No brands yet</h2>
                <p style={{ color: 'var(--text-secondary)', marginBottom: 24, fontSize: 14 }}>
                  Create your first brand to get started with the Prometheus workflow.
                </p>
                <Link href="/brands/new" className="btn-primary">+ Create your first brand</Link>
              </div>
            )}
          </>
        )}

        {/* ── Tab 2: Active Pipeline ── */}
        {tab === 'pipeline' && isAuthorized && (
          <PipelineView pipeline={pipeline} />
        )}

        {tab === 'pipeline' && !isAuthorized && (
          <div style={{ padding: '64px 24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
            You don't have access to the pipeline view.
          </div>
        )}

        {/* ── Tab 3: Brands ── */}
        {tab === 'brands' && (
          allBrands.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '80px 24px' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🚀</div>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>No brands yet</h2>
              <p style={{ color: 'var(--text-secondary)', marginBottom: 24, fontSize: 14 }}>
                Create your first brand to get started with the Prometheus workflow.
              </p>
              <Link href="/brands/new" className="btn-primary">+ Create your first brand</Link>
            </div>
          ) : (
            <BrandsView allBrands={allBrands} peGroups={peGroups} allPEs={allPEs} />
          )
        )}

      </main>
    </div>
  )
}

// ─── Components ──────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: boolean }) {
  return (
    <div style={{
      background: accent ? 'color-mix(in srgb, var(--accent) 8%, var(--surface))' : 'var(--surface)',
      border: `1px solid ${accent ? 'rgba(249,115,22,0.3)' : 'var(--border)'}`,
      borderRadius: 12,
      padding: '22px 24px',
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>
        {label}
      </div>
      <div style={{ fontSize: 30, fontWeight: 800, color: accent ? 'var(--accent)' : 'var(--text-primary)', letterSpacing: '-0.03em', marginBottom: 6 }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{sub}</div>
    </div>
  )
}


