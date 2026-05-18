import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import Nav from '@/components/Nav'
import { canEdit } from '@/lib/permissions'
import { updateBrandDetails } from '@/lib/actions'
import type { Brand, Project } from '@/lib/types'
import { STAGE_LABELS } from '@/lib/types'

export default async function BrandPage({ params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const isAuthorized = canEdit(user.email)

  const { data: brand } = await supabase
    .from('brands')
    .select('*')
    .eq('id', brandId)
    .single()

  if (!brand) notFound()

  const { data: projects } = await supabase
    .from('projects')
    .select('*')
    .eq('brand_id', brandId)
    .order('due_date', { ascending: true })

  const allProjects = (projects ?? []) as Project[]
  const active = allProjects.filter(p => !p.is_complete)
  const done = allProjects.filter(p => p.is_complete)

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)' }}>
      <Nav email={user.email} />
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
          {isAuthorized && (
            <Link href={`/brands/${brandId}/projects/new`} className="btn-primary" style={{ flexShrink: 0 }}>
              + New Project
            </Link>
          )}
        </div>

        {/* Account Details */}
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
                  disabled={!isAuthorized}
                />
              </div>
              <div>
                <label>Start Date</label>
                <input
                  name="start_date"
                  type="date"
                  defaultValue={(brand as Brand).start_date ?? ''}
                  disabled={!isAuthorized}
                />
              </div>
              <div>
                <label>Growth Strategist</label>
                <input
                  name="growth_strategist"
                  type="text"
                  defaultValue={(brand as Brand).growth_strategist ?? ''}
                  placeholder="email@commonthreadglobal.com"
                  disabled={!isAuthorized}
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
            {isAuthorized && (
              <button type="submit" className="btn-secondary" style={{ fontSize: 13 }}>
                Save account details
              </button>
            )}
          </form>
        </div>

        {allProjects.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 24px' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
              No projects yet
            </h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 24, fontSize: 14 }}>
              Create a marketing moment to kick off the Prometheus workflow.
            </p>
            {isAuthorized && (
              <Link href={`/brands/${brandId}/projects/new`} className="btn-primary">
                + Create first project
              </Link>
            )}
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

function ProjectRow({ project, brandId }: { project: Project; brandId: string }) {
  const due = project.due_date ? new Date(project.due_date) : null
  const isOverdue = due && due < new Date() && !project.is_complete
  const dueStr = due ? due.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

  return (
    <Link href={`/brands/${brandId}/projects/${project.id}`} style={{ textDecoration: 'none' }}>
      <div className="card" style={{
        display: 'flex',
        alignItems: 'center',
        gap: 20,
        cursor: 'pointer',
        padding: '16px 20px',
        transition: 'border-color 0.15s',
      }}>
        {/* Project name + meta */}
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

        {/* LP track */}
        <TrackPill label="Landing Page" stage={project.lp_stage} />
        <TrackPill label="Creatives" stage={project.creatives_stage} />

        {/* Due date */}
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <span style={{ fontSize: 12, color: isOverdue ? 'var(--danger)' : 'var(--text-muted)', fontWeight: isOverdue ? 600 : 400 }}>
            {isOverdue ? '⚠ ' : ''}{dueStr}
          </span>
        </div>

        <span style={{ color: 'var(--text-muted)', fontSize: 16 }}>›</span>
      </div>
    </Link>
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
