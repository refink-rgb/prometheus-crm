import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import ThemeToggle from '@/components/ThemeToggle'
import type { Brand, Project, Journey } from '@/lib/types'
import { isProjectOverdue, parseDueDate } from '@/lib/stageColors'

export default async function ClientPortalPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const supabase = await createClient()

  const { data: brandRaw } = await supabase
    .from('brands')
    .select('id, name')
    .eq('client_token', token)
    .single()

  if (!brandRaw) notFound()

  const brand = brandRaw as Brand

  const [{ data: projectsRaw }, { data: journeysRaw }] = await Promise.all([
    supabase.from('projects').select('id, name, brand_id, due_date, is_complete, journey_id, marketing_moment, lp_stage, creatives_stage, page_type, share_token, offer_locked').eq('brand_id', brand.id).order('due_date', { ascending: false }),
    supabase.from('journeys').select('id, name').eq('brand_id', brand.id).order('created_at', { ascending: false }),
  ])

  const projects = (projectsRaw ?? []) as Project[]
  const journeys = (journeysRaw ?? []) as Journey[]

  const journeyMap = new Map<string, Journey>()
  journeys.forEach(j => journeyMap.set(j.id, j))

  // Group projects by journey, then by marketing moment
  const active = projects.filter(p => !p.is_complete)
  const completed = projects.filter(p => p.is_complete)

  // Build journey groups (most recent first)
  const seen = new Set<string>()
  const journeyGroups: Array<{ journey: Journey | null; projects: Project[] }> = []

  journeys.forEach(j => {
    const ps = active.filter(p => p.journey_id === j.id)
    if (ps.length > 0) {
      journeyGroups.push({ journey: j, projects: ps.sort((a, b) => (a.marketing_moment ?? 0) - (b.marketing_moment ?? 0)) })
      ps.forEach(p => seen.add(p.id))
    }
  })

  const ungrouped = active.filter(p => !seen.has(p.id))
  if (ungrouped.length > 0) journeyGroups.push({ journey: null, projects: ungrouped })

  const initials = brand.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
  const brandColor = `hsl(${brand.name.charCodeAt(0) * 7 % 360}, 60%, 25%)`

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)' }}>
      {/* Header — 56px sticky bar matching Nav and the review page. */}
      <div style={{
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        padding: '0 var(--space-6)',
        height: 56,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <div style={{
            width: 28, height: 28, borderRadius: 6,
            background: brandColor,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 'var(--text-base)', fontWeight: 700, color: 'white', flexShrink: 0,
          }}>
            {initials}
          </div>
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
            {brand.name}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>Client Portal</span>
          <ThemeToggle />
        </div>
      </div>

      <main style={{ maxWidth: 780, margin: '0 auto', padding: 'var(--space-10) var(--space-6) 80px' }}>

        {/* Welcome */}
        <div style={{ marginBottom: 'var(--space-10)' }}>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.03em', marginBottom: 'var(--space-2)' }}>
            Your Projects
          </h1>
          <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>
            All active and past campaigns — click into any project to review deliverables and leave feedback.
          </p>
        </div>

        {/* Active projects */}
        {journeyGroups.length === 0 && (
          <div className="card" style={{ textAlign: 'center', padding: 'var(--space-10) var(--space-6)' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>No active projects yet. Check back soon.</p>
          </div>
        )}

        {journeyGroups.map(({ journey, projects: jProjects }) => (
          <div key={journey?.id ?? 'ungrouped'} style={{ marginBottom: 36 }}>
            {journey && (
              <div style={{ marginBottom: 14 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {journey.name}
                </span>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {jProjects.map(p => (
                <ProjectCard key={p.id} project={p} />
              ))}
            </div>
          </div>
        ))}

        {/* Completed projects */}
        {completed.length > 0 && (
          <div style={{ marginTop: 48 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>
              Completed ({completed.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {completed.map(p => (
                <ProjectCard key={p.id} project={p} compact />
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

function ProjectCard({ project: p, compact = false }: { project: Project; compact?: boolean }) {
  const due = parseDueDate(p.due_date)
  const dueStr = due?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const isOverdue = isProjectOverdue(p.due_date, p.is_complete, p.lp_stage, p.creatives_stage)

  const overallStage = p.is_complete
    ? 'Complete'
    : p.lp_stage === 'client_review' || p.creatives_stage === 'client_review'
    ? 'Needs Your Review'
    : p.lp_stage === 'in_progress' || p.creatives_stage === 'in_progress'
    ? 'In Production'
    : 'Brief Received'

  const stageColor = p.is_complete
    ? 'var(--success)'
    : overallStage === 'Needs Your Review'
    ? 'var(--accent)'
    : 'var(--text-muted)'

  return (
    <div className="card brand-card" style={{ padding: compact ? 'var(--space-3) var(--space-4)' : 'var(--space-5) var(--space-6)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: compact ? 2 : 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: compact ? 14 : 15, fontWeight: 700, color: 'var(--text-primary)' }}>
              {p.name}
            </span>
            {p.marketing_moment && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 5, padding: '1px 6px' }}>
                Moment {p.marketing_moment}
              </span>
            )}
            {p.page_type && !compact && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 5, padding: '1px 6px' }}>
                {p.page_type}
              </span>
            )}
          </div>
          {!compact && (
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: stageColor }}>
                ● {overallStage}
              </span>
              {dueStr && (
                <span style={{ fontSize: 12, color: isOverdue ? 'var(--danger)' : 'var(--text-muted)' }}>
                  Due {dueStr}
                </span>
              )}
              {p.offer_locked && (
                <span style={{ fontSize: 11, color: 'var(--success)', fontWeight: 600 }}>
                  🔒 Offer Confirmed
                </span>
              )}
            </div>
          )}
        </div>
        {p.share_token && (
          <Link
            href={`/review/${p.share_token}`}
            className="btn-secondary btn-sm"
            style={{
              color: 'var(--accent)',
              borderColor: 'var(--accent)',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            Review →
          </Link>
        )}
        {!p.share_token && (
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            Coming soon
          </span>
        )}
      </div>
    </div>
  )
}
