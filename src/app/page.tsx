import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import Nav from '@/components/Nav'
import { canEdit } from '@/lib/permissions'
import type { Brand, Project, Stage } from '@/lib/types'
import { STAGE_LABELS } from '@/lib/types'

type BrandWithProjects = Brand & { projects: Project[] }
type PipelineProject = Project & { brands: { id: string; name: string } }

const STAGE_COLORS: Record<Stage, string> = {
  brief: 'var(--text-muted)',
  in_progress: 'var(--accent)',
  review: 'var(--warning)',
  done: 'var(--success)',
}

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

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [{ data: brands }, { data: pipelineRaw }] = await Promise.all([
    supabase
      .from('brands')
      .select('*, projects(*)')
      .order('created_at', { ascending: false }),
    supabase
      .from('projects')
      .select('*, brands(id, name)')
      .eq('is_complete', false)
      .order('due_date', { ascending: true }),
  ])

  const allBrands = (brands ?? []) as BrandWithProjects[]
  const pipeline = (pipelineRaw ?? []) as PipelineProject[]
  const active = allBrands.filter(b => b.projects.some(p => !p.is_complete))
  const completed = allBrands.filter(b => b.projects.every(p => p.is_complete) && b.projects.length > 0)
  const noprojects = allBrands.filter(b => b.projects.length === 0)
  const isAuthorized = canEdit(user?.email)

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

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)' }}>
      <Nav email={user?.email} />

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 40 }}>
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

        {/* ── Revenue Dashboard (Roberto + Lucas only) ── */}
        {isAuthorized && (
          <section style={{ marginBottom: 48 }}>
            <h2 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 16 }}>
              Revenue
            </h2>

            {/* Stat cards */}
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

            {/* Per-client breakdown */}
            {billableClients.length > 0 ? (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 200px 110px 120px 140px', gap: 16, padding: '10px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface-raised)' }}>
                  {['Brand', 'Growth Strategist', 'Started', 'Monthly', 'To Date'].map(col => (
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
                          {brand.growth_strategist ?? '—'}
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

        {/* Active Pipeline — Roberto + Lucas only */}
        {isAuthorized && pipeline.length > 0 && (
          <section style={{ marginBottom: 48 }}>
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

        {/* Active brands */}
        {active.length > 0 && (
          <section style={{ marginBottom: 48 }}>
            <h2 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 16 }}>
              Brands with Active Projects
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
              {active.map(brand => <BrandCard key={brand.id} brand={brand} />)}
            </div>
          </section>
        )}

        {noprojects.length > 0 && (
          <section style={{ marginBottom: 48 }}>
            <h2 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 16 }}>
              Brands — No Active Projects
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
              {noprojects.map(brand => <BrandCard key={brand.id} brand={brand} />)}
            </div>
          </section>
        )}

        {completed.length > 0 && (
          <section>
            <h2 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 16 }}>
              Completed
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16, opacity: 0.6 }}>
              {completed.map(brand => <BrandCard key={brand.id} brand={brand} />)}
            </div>
          </section>
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
  const stages: Stage[] = ['brief', 'in_progress', 'review', 'done']
  const idx = stages.indexOf(stage)
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 600, color: STAGE_COLORS[stage], marginBottom: 5, letterSpacing: '0.04em' }}>
        {STAGE_LABELS[stage]}
      </div>
      <div style={{ display: 'flex', gap: 3 }}>
        {stages.map((s, i) => {
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
