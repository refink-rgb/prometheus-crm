import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import Nav from '@/components/Nav'
import { canEdit } from '@/lib/permissions'
import type { Brand, Project, Stage } from '@/lib/types'
import { STAGE_LABELS } from '@/lib/types'
import DashboardTabs from '@/components/DashboardTabs'
import ProjectStatsCards from '@/components/ProjectStatsCards'
import ProjectsByStage from '@/components/ProjectsByStage'

type BrandWithProjects = Brand & { projects: Project[] }
type PipelineProject = Project & { brands: { id: string; name: string } }

const STAGE_COLORS: Record<Stage, string> = {
  brief: 'var(--text-muted)',
  in_progress: 'var(--accent)',
  review: 'var(--warning)',
  done: 'var(--success)',
}

const STAGES: Stage[] = ['brief', 'in_progress', 'review', 'done']

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
        {tab === 'pipeline' && isAuthorized && pipeline.length > 0 && (
          <section>
            <h2 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 16 }}>
              Active Pipeline — {pipeline.length} project{pipeline.length !== 1 ? 's' : ''}
            </h2>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr 88px 150px 150px', gap: 16, padding: '10px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface-raised)' }}>
                {['Brand', 'Project', 'Due', 'Landing Page', 'Creatives'].map(col => (
                  <span key={col} style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{col}</span>
                ))}
              </div>
              {pipeline.map((p, i) => (
                <Link key={p.id} href={`/brands/${p.brands.id}/projects/${p.id}`} style={{ textDecoration: 'none', display: 'block' }}>
                  <div className="pipeline-row" style={{
                    display: 'grid',
                    gridTemplateColumns: '150px 1fr 88px 150px 150px',
                    gap: 16,
                    padding: '14px 20px',
                    borderBottom: i < pipeline.length - 1 ? '1px solid var(--border)' : 'none',
                    alignItems: 'center',
                  }}>
                    <span style={{ fontSize: 13, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.brands.name}
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.name}
                    </span>
                    <DueBadge dueDate={p.due_date} isComplete={p.is_complete} />
                    <TrackProgress stage={p.lp_stage} />
                    <TrackProgress stage={p.creatives_stage} />
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {tab === 'pipeline' && isAuthorized && pipeline.length === 0 && (
          <div style={{ padding: '64px 24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
            No active projects in the pipeline.
          </div>
        )}

        {tab === 'pipeline' && !isAuthorized && (
          <div style={{ padding: '64px 24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
            You don't have access to the pipeline view.
          </div>
        )}

        {/* ── Tab 3: Brands ── */}
        {tab === 'brands' && (
          <>
            {allBrands.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '80px 24px' }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>🚀</div>
                <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>No brands yet</h2>
                <p style={{ color: 'var(--text-secondary)', marginBottom: 24, fontSize: 14 }}>
                  Create your first brand to get started with the Prometheus workflow.
                </p>
                <Link href="/brands/new" className="btn-primary">+ Create your first brand</Link>
              </div>
            ) : (
              peGroups.map((group, gi) => (
                <section key={group.pe} style={{ marginBottom: gi < peGroups.length - 1 ? 48 : 0 }}>
                  <h2 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 16 }}>
                    {group.pe === 'Unassigned' ? 'Unassigned' : `${group.pe}'s Brands`} — {group.brands.length} brand{group.brands.length !== 1 ? 's' : ''}
                  </h2>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
                    {group.brands.map(brand => <BrandCard key={brand.id} brand={brand} />)}
                  </div>
                </section>
              ))
            )}
          </>
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

function DueBadge({ dueDate, isComplete }: { dueDate: string | null; isComplete: boolean }) {
  if (!dueDate) return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
  const due = new Date(dueDate)
  const now = new Date()
  const daysUntil = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  const isOverdue = daysUntil < 0 && !isComplete
  const isUrgent = daysUntil >= 0 && daysUntil <= 7 && !isComplete
  const color = isOverdue ? 'var(--danger)' : isUrgent ? 'var(--warning)' : 'var(--text-muted)'
  const dueStr = due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return (
    <span style={{
      fontSize: 12, fontWeight: isOverdue || isUrgent ? 600 : 400, color,
      background: isOverdue ? 'rgba(239,68,68,0.1)' : isUrgent ? 'rgba(234,179,8,0.1)' : 'transparent',
      padding: isOverdue || isUrgent ? '2px 6px' : '0', borderRadius: 4, whiteSpace: 'nowrap',
    }}>
      {isOverdue ? '⚠ ' : ''}{dueStr}
    </span>
  )
}

function TrackProgress({ stage }: { stage: Stage }) {
  const idx = STAGES.indexOf(stage)
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 600, color: STAGE_COLORS[stage], marginBottom: 5, letterSpacing: '0.04em' }}>
        {STAGE_LABELS[stage]}
      </div>
      <div style={{ display: 'flex', gap: 3 }}>
        {STAGES.map((s, i) => {
          const bg = i < idx ? 'var(--success)' : i === idx ? STAGE_COLORS[stage] : 'var(--border)'
          return <div key={s} style={{ width: 26, height: 5, borderRadius: 3, background: bg, transition: 'background 0.2s' }} />
        })}
      </div>
    </div>
  )
}

function BrandCard({ brand }: { brand: BrandWithProjects }) {
  const activeProjects = brand.projects.filter(p => !p.is_complete)
  const totalProjects = brand.projects.length
  return (
    <Link href={`/brands/${brand.id}`} style={{ textDecoration: 'none' }}>
      <div className="card brand-card" style={{ cursor: 'pointer' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: `hsl(${brand.name.charCodeAt(0) * 7 % 360}, 60%, 25%)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: 18, color: 'white', border: '1px solid var(--border)',
          }}>
            {brand.name.charAt(0).toUpperCase()}
          </div>
          {activeProjects.length > 0 && <span className="badge badge-in_progress">{activeProjects.length} active</span>}
          {activeProjects.length === 0 && totalProjects > 0 && <span className="badge badge-done">all done</span>}
        </div>
        <h3 style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)', marginBottom: 4, letterSpacing: '-0.01em' }}>
          {brand.name}
        </h3>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {brand.website}
        </p>
        {activeProjects.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {activeProjects.slice(0, 2).map(project => <MiniProjectRow key={project.id} project={project} />)}
            {activeProjects.length > 2 && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>+{activeProjects.length - 2} more</p>}
          </div>
        )}
        {totalProjects === 0 && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No projects yet — click to add one</p>}
      </div>
    </Link>
  )
}

function MiniProjectRow({ project }: { project: Project }) {
  const due = project.due_date ? new Date(project.due_date) : null
  const isOverdue = due && due < new Date() && !project.is_complete
  return (
    <div style={{ background: 'var(--surface-raised)', borderRadius: 8, padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
        {project.name}
      </span>
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        <MiniDot label="LP" stage={project.lp_stage} />
        <MiniDot label="CR" stage={project.creatives_stage} />
        {isOverdue && <span style={{ fontSize: 10, color: 'var(--danger)', fontWeight: 600 }}>LATE</span>}
      </div>
    </div>
  )
}

function MiniDot({ label, stage }: { label: string; stage: string }) {
  const color = stage === 'done' ? 'var(--success)' : stage === 'review' ? 'var(--warning)' : stage === 'in_progress' ? 'var(--accent)' : 'var(--text-muted)'
  return (
    <span style={{ fontSize: 10, fontWeight: 600, color, background: `color-mix(in srgb, ${color} 15%, transparent)`, padding: '2px 5px', borderRadius: 4 }}>
      {label}
    </span>
  )
}
