import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import Nav from '@/components/Nav'
import { canEdit } from '@/lib/permissions'
import type { Brand, Project } from '@/lib/types'
import DashboardTabs from '@/components/DashboardTabs'
import PipelineView from '@/components/PipelineView'
import BrandsView from '@/components/BrandsView'
import ActiveProjectsPanel from '@/components/ActiveProjectsPanel'
import BDPipelineKanban from '@/components/BDPipelineKanban'
import { calcDaysUntil } from '@/lib/stageColors'

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

  const billableClients = allBrands
    .filter(b => (b.monthly_retainer ?? 0) > 0)
    .sort((a, b) => (b.monthly_retainer ?? 0) - (a.monthly_retainer ?? 0))
  const activeClients = billableClients.filter(b => b.is_active)
  const mrr = activeClients.reduce((sum, b) => sum + (b.monthly_retainer ?? 0), 0)
  const revenueToDate = activeClients.reduce((sum, b) => {
    if (!b.start_date) return sum
    return sum + calcMonths(b.start_date) * (b.monthly_retainer ?? 0)
  }, 0)

  // KPI counts (using unified calcDaysUntil — no more inconsistencies)
  const activeProjectsCount = pipeline.length
  const inClientReview = pipeline.filter(
    p => p.lp_stage === 'client_review' || p.creatives_stage === 'client_review'
  ).length
  const overdue = pipeline.filter(p => {
    const d = calcDaysUntil(p.due_date)
    return d !== null && d < 0 && !p.is_complete
  }).length

  // Prepare projects with brand_name for the ActiveProjectsPanel
  const projectsWithBrand = pipeline.map(p => ({
    ...p,
    brand_name: p.brands.name,
  }))

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)' }}>
      <Nav email={user?.email} />

      <main style={{ maxWidth: 1280, margin: '0 auto', padding: '28px 24px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.03em', marginBottom: 4 }}>
              Prometheus Studio
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              {allBrands.length} brand{allBrands.length !== 1 ? 's' : ''} · {activeProjectsCount} active project{activeProjectsCount !== 1 ? 's' : ''}
            </p>
          </div>
          <Link href="/brands/new" className="btn-primary">+ New Brand</Link>
        </div>

        <DashboardTabs active={tab} />

        {/* ── Tab 1: Dashboard ── */}
        {tab === 'dashboard' && (
          <>
            {/* KPI strip */}
            <div className="kpi-strip" style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 12,
              marginBottom: 24,
            }}>
              {isAuthorized && (
                <KPICard label="MRR" value={fmtCurrency(mrr)} tone="accent" />
              )}
              {!isAuthorized && (
                <KPICard label="Brands" value={String(allBrands.length)} />
              )}
              <KPICard label="Active Projects" value={String(activeProjectsCount)} />
              <KPICard
                label="In Client Review"
                value={String(inClientReview)}
                tone={inClientReview > 0 ? 'amber' : 'default'}
              />
              <KPICard
                label="Overdue"
                value={String(overdue)}
                tone={overdue > 0 ? 'red' : 'default'}
              />
            </div>

            {/* Main grid: 60/40 */}
            <div className="dashboard-grid" style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)',
              gap: 24,
              marginBottom: 32,
            }}>
              <section>
                <h2 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 16 }}>
                  Active Projects
                </h2>
                <ActiveProjectsPanel projects={projectsWithBrand} />
              </section>

              <section>
                <h2 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 16 }}>
                  BD Pipeline
                </h2>
                <BDPipelineKanban brands={allBrands} canEdit={isAuthorized} />
              </section>
            </div>

            {/* Revenue table — moved below main grid, staff only */}
            {isAuthorized && (
              <section style={{ marginBottom: 32 }}>
                <h2 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 16 }}>
                  Revenue
                </h2>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
                  <KPICard label="Monthly Recurring Revenue" value={fmtCurrency(mrr)} sub={`${activeClients.length} active client${activeClients.length !== 1 ? 's' : ''}`} tone="accent" />
                  <KPICard label="Revenue to Date" value={fmtCurrency(revenueToDate)} sub={revenueToDate > 0 ? 'based on retainer start dates' : 'set start dates on each brand'} />
                  <KPICard label="Next Month Forecast" value={fmtCurrency(mrr)} sub="based on current retainers" />
                </div>

                {billableClients.length > 0 ? (
                  <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
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
                            padding: '12px 20px',
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
            You don&apos;t have access to the pipeline view.
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

// ─── KPICard ─────────────────────────────────────────────────────────────────

function KPICard({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string
  value: string
  sub?: string
  tone?: 'default' | 'accent' | 'amber' | 'red'
}) {
  const toneStyles: Record<string, { bg: string; border: string; color: string }> = {
    default: {
      bg: 'var(--surface-1)',
      border: 'var(--border)',
      color: 'var(--text-primary)',
    },
    accent: {
      bg: 'color-mix(in srgb, var(--accent) 8%, var(--surface-1))',
      border: 'color-mix(in srgb, var(--accent) 30%, var(--border))',
      color: 'var(--accent)',
    },
    amber: {
      bg: 'var(--stage-client-bg)',
      border: 'color-mix(in srgb, #F59E0B 35%, transparent)',
      color: 'var(--stage-client-text)',
    },
    red: {
      bg: 'var(--urgent-overdue-bg)',
      border: 'color-mix(in srgb, #EF4444 35%, transparent)',
      color: 'var(--urgent-overdue)',
    },
  }
  const s = toneStyles[tone]
  return (
    <div style={{
      background: s.bg,
      border: `1px solid ${s.border}`,
      borderRadius: 8,
      padding: '14px 18px',
    }}>
      <div style={{
        fontSize: 12,
        fontWeight: 600,
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.07em',
        marginBottom: 6,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 22,
        fontWeight: 700,
        color: s.color,
        letterSpacing: '-0.02em',
        lineHeight: 1.1,
      }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{sub}</div>
      )}
    </div>
  )
}
