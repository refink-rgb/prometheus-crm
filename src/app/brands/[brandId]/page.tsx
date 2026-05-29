import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import Nav from '@/components/Nav'
import { canEdit } from '@/lib/permissions'
import { updateBrandDetails, deleteBrand } from '@/lib/actions'
import ConfirmDeleteForm from '@/components/ConfirmDeleteForm'
import ProfitEngineerSelect from '@/components/ProfitEngineerSelect'
import type { Brand, Project } from '@/lib/types'
import { STAGE_LABELS } from '@/lib/types'

export default async function BrandPage({ params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const isAuthorized = canEdit(user?.email)

  const { data: brand } = await supabase
    .from('brands')
    .select('*')
    .eq('id', brandId)
    .single()

  if (!brand) notFound()

  const [{ data: projects }, { data: peRows }] = await Promise.all([
    supabase.from('projects').select('*').eq('brand_id', brandId).order('due_date', { ascending: true }),
    supabase.from('profit_engineers').select('name').order('name', { ascending: true }),
  ])

  const allProjects = (projects ?? []) as Project[]
  const engineerNames = (peRows ?? []).map((r: { name: string }) => r.name)
  const active = allProjects.filter(p => !p.is_complete)
  const done = allProjects.filter(p => p.is_complete)

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)' }}>
      <Nav email={user?.email} />
      <main style={{ maxWidth: 1000, margin: '0 auto', padding: '40px 24px' }}>
        {/* Breadcrumb */}
        <Link href="/" style={{ fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 24 }}>
          ← Dashboard
        </Link>

        {/* Brand header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 40, gap: 16 }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <div style={{
              width: 52,
              height: 52,
              borderRadius: 12,
              background: `hsl(${(brand as Brand).name.charCodeAt(0) * 7 % 360}, 60%, 25%)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: 24,
              color: 'white',
              border: '1px solid var(--border)',
              flexShrink: 0,
            }}>
              {(brand as Brand).name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.03em', marginBottom: 4 }}>
                {(brand as Brand).name}
              </h1>
              <a
                href={(brand as Brand).website}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 13, color: 'var(--accent)', textDecoration: 'none' }}
              >
                {(brand as Brand).website} ↗
              </a>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
            {isAuthorized && (
              <ConfirmDeleteForm
                action={deleteBrand.bind(null, brandId)}
                message={`Delete "${(brand as Brand).name}" and all its projects? This cannot be undone.`}
              >
                <button type="submit" style={{
                  background: 'transparent',
                  color: 'var(--danger)',
                  border: '1px solid rgba(239,68,68,0.25)',
                  borderRadius: 8,
                  padding: '8px 14px',
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}>
                  Delete brand
                </button>
              </ConfirmDeleteForm>
            )}
            <Link href={`/brands/${brandId}/projects/new`} className="btn-primary">
              + New Project
            </Link>
          </div>
        </div>

        {/* Account Details — Roberto + Lucas only */}
        {isAuthorized && (
          <div className="card" style={{ marginBottom: 32 }}>
            <h2 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 20 }}>
              Account Details
            </h2>
            <form action={updateBrandDetails}>
              <input type="hidden" name="brand_id" value={brandId} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 20, marginBottom: 20 }}>
                <div>
                  <label>Monthly Retainer ($)</label>
                  <input
                    name="monthly_retainer"
                    type="number"
                    min="0"
                    step="1"
                    defaultValue={(brand as Brand).monthly_retainer ?? ''}
                    placeholder="e.g. 5000"
                  />
                </div>
                <div>
                  <label>Start Date</label>
                  <input
                    name="start_date"
                    type="date"
                    defaultValue={(brand as Brand).start_date ?? ''}
                  />
                </div>
                <div>
                  <label>Profit Engineer</label>
                  <ProfitEngineerSelect
                    engineers={engineerNames}
                    current={(brand as Brand).profit_engineer}
                  />
                </div>
                <div>
                  <label>Account Created</label>
                  <div style={{
                    background: 'var(--surface-raised)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '10px 14px',
                    fontSize: 14,
                    color: 'var(--text-muted)',
                  }}>
                    {new Date((brand as Brand).created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                  </div>
                </div>
              </div>

              {/* Client status — single 3-way toggle */}
              {(() => {
                const b = brand as Brand
                const currentStatus = b.is_trial ? 'trial' : b.is_active ? 'active' : 'inactive'
                const options = [
                  { value: 'active',   label: 'Active',    color: 'var(--success)' },
                  { value: 'inactive', label: 'Inactive',  color: 'var(--danger)'  },
                  { value: 'trial',    label: 'On Trial',  color: 'var(--warning)' },
                ]
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, padding: '10px 16px', background: 'var(--surface-raised)', borderRadius: 8, border: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 13, color: 'var(--text-secondary)', flex: 1 }}>Client status</span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {options.map(opt => (
                        <label key={opt.value} style={{
                          display: 'flex', alignItems: 'center', gap: 5,
                          cursor: 'pointer', textTransform: 'none', letterSpacing: 0,
                          fontSize: 12, fontWeight: 500, marginBottom: 0,
                          padding: '5px 10px', borderRadius: 6,
                          background: currentStatus === opt.value ? `color-mix(in srgb, ${opt.color} 15%, transparent)` : 'transparent',
                          border: `1px solid ${currentStatus === opt.value ? opt.color : 'transparent'}`,
                          color: currentStatus === opt.value ? opt.color : 'var(--text-muted)',
                        }}>
                          <input type="radio" name="client_status" value={opt.value} defaultChecked={currentStatus === opt.value} style={{ width: 'auto', padding: 0 }} />
                          {opt.label}
                        </label>
                      ))}
                    </div>
                  </div>
                )
              })()}

              <button type="submit" className="btn-secondary" style={{ fontSize: 13 }}>
                Save account details
              </button>
            </form>
          </div>
        )}

        {allProjects.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 24px' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
              No projects yet
            </h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 24, fontSize: 14 }}>
              Create a marketing moment to kick off the Prometheus workflow.
            </p>
            <Link href={`/brands/${brandId}/projects/new`} className="btn-primary">
              + Create first project
            </Link>
          </div>
        )}

        {active.length > 0 && (
          <section style={{ marginBottom: 40 }}>
            <h2 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 16 }}>
              Active Projects ({active.length})
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {active.map(p => <ProjectRow key={p.id} project={p} brandId={brandId} />)}
            </div>
          </section>
        )}

        {done.length > 0 && (
          <section>
            <h2 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 16 }}>
              Completed ({done.length})
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, opacity: 0.6 }}>
              {done.map(p => <ProjectRow key={p.id} project={p} brandId={brandId} />)}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

const STAGES = ['brief', 'in_progress', 'review', 'done'] as const
const STAGE_COLORS: Record<string, string> = {
  brief: 'var(--text-muted)',
  in_progress: 'var(--accent)',
  review: 'var(--warning)',
  done: 'var(--success)',
}

function ProjectRow({ project, brandId }: { project: Project; brandId: string }) {
  const due = project.due_date ? new Date(project.due_date) : null
  const start = project.created_at ? new Date(project.created_at) : null
  const now = new Date()
  const daysLeft = due ? Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null
  const isOverdue = daysLeft !== null && daysLeft < 0 && !project.is_complete
  const startStr = start ? start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
  const dueStr = due ? due.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

  let daysLabel = '—'
  let daysColor = 'var(--text-muted)'
  if (daysLeft !== null && !project.is_complete) {
    if (daysLeft < 0) { daysLabel = `${Math.abs(daysLeft)}d overdue`; daysColor = 'var(--danger)' }
    else if (daysLeft === 0) { daysLabel = 'Due today'; daysColor = 'var(--danger)' }
    else if (daysLeft <= 3) { daysLabel = `${daysLeft}d left`; daysColor = 'var(--danger)' }
    else if (daysLeft <= 7) { daysLabel = `${daysLeft}d left`; daysColor = 'var(--warning)' }
    else { daysLabel = `${daysLeft}d left`; daysColor = 'var(--text-muted)' }
  } else if (project.is_complete) {
    daysLabel = 'Complete'; daysColor = 'var(--success)'
  }

  return (
    <Link href={`/brands/${brandId}/projects/${project.id}`} style={{ textDecoration: 'none' }}>
      <div className="card" style={{ cursor: 'pointer', padding: '16px 20px', transition: 'border-color 0.15s' }}>

        {/* Top row: name + dates */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20, marginBottom: 14 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)' }}>
                {project.name}
              </span>
              {project.is_complete && <span className="badge badge-done">Complete</span>}
            </div>
            <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-muted)' }}>
              {project.offer && <span>🎁 {project.offer}</span>}
              {project.discount && <span>💸 {project.discount}</span>}
            </div>
          </div>

          {/* Date meta */}
          <div style={{ display: 'flex', gap: 20, flexShrink: 0 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Started</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{startStr}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Due</div>
              <div style={{ fontSize: 12, color: isOverdue ? 'var(--danger)' : 'var(--text-secondary)', fontWeight: isOverdue ? 600 : 400 }}>{isOverdue ? '⚠ ' : ''}{dueStr}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Remaining</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: daysColor }}>{daysLabel}</div>
            </div>
          </div>

          <span style={{ color: 'var(--text-muted)', fontSize: 16, alignSelf: 'center' }}>›</span>
        </div>

        {/* Progress bars */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <TrackBar label="Landing Page" stage={project.lp_stage} />
          <TrackBar label="Creatives" stage={project.creatives_stage} />
        </div>
      </div>
    </Link>
  )
}

function TrackBar({ label, stage }: { label: string; stage: string }) {
  const idx = STAGES.indexOf(stage as typeof STAGES[number])
  const color = STAGE_COLORS[stage] ?? 'var(--text-muted)'
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color }}>{STAGE_LABELS[stage as keyof typeof STAGE_LABELS]}</span>
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        {STAGES.map((s, i) => {
          const bg = i < idx ? 'var(--success)' : i === idx ? color : 'var(--border)'
          return <div key={s} style={{ flex: 1, height: 5, borderRadius: 3, background: bg, transition: 'background 0.2s' }} />
        })}
      </div>
    </div>
  )
}

function TrackPill({ label, stage }: { label: string; stage: string }) {
  const color = stage === 'done' ? 'var(--success)' : stage === 'review' ? 'var(--warning)' : stage === 'in_progress' ? 'var(--accent)' : 'var(--text-muted)'
  return (
    <div style={{ flexShrink: 0, textAlign: 'center' }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>{label}</div>
      <span style={{
        fontSize: 11,
        fontWeight: 600,
        color,
        background: `color-mix(in srgb, ${color} 15%, transparent)`,
        padding: '3px 8px',
        borderRadius: 4,
      }}>
        {STAGE_LABELS[stage as keyof typeof STAGE_LABELS]}
      </span>
    </div>
  )
}
