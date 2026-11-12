import Link from 'next/link'
import JourneyHeader from '@/components/JourneyHeader'
import ProjectCard from '@/components/ProjectCard'
import type { Journey, Project } from '@/lib/types'

// All of a brand's projects: active ones first, grouped by journey.

export default function BrandProjects({ brandId, projects, journeys, isAuthorized }: { brandId: string; projects: Project[]; journeys: Journey[]; isAuthorized: boolean }) {
  const active = projects.filter(p => !p.is_complete)
  const done = projects.filter(p => p.is_complete)

  const projectsByJourney = new Map<string | null, Project[]>()
  active.forEach(p => {
    const key = p.journey_id ?? null
    if (!projectsByJourney.has(key)) projectsByJourney.set(key, [])
    projectsByJourney.get(key)!.push(p)
  })

  // Journeys with projects first (most recent at top), ungrouped last.
  const groups: Array<{ journey: Journey | null; projects: Project[] }> = []
  journeys.forEach(j => {
    const ps = projectsByJourney.get(j.id)
    if (ps?.length) groups.push({ journey: j, projects: ps })
  })
  const ungrouped = projectsByJourney.get(null)
  if (ungrouped?.length) groups.push({ journey: null, projects: ungrouped })

  if (projects.length === 0) {
    return (
      <section className="mo-panel mo-panel-pad" style={{ textAlign: 'center', padding: '48px 24px' }}>
        <h2 className="mo-h2" style={{ marginBottom: 8 }}>No projects yet</h2>
        <p className="mo-muted" style={{ marginBottom: 20 }}>Create a marketing moment to kick off the Prometheus workflow.</p>
        <Link href={`/brands/${brandId}/projects/new`} className="btn-primary">+ Create first project</Link>
      </section>
    )
  }

  return (
    <>
      {active.length > 0 && (
        <section className="mo-panel mo-panel-pad" aria-label="Active projects">
          <h2 className="mo-h2" style={{ marginBottom: 16 }}>Active <span className="mo-count">· {active.length}</span></h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {groups.map(({ journey, projects: jProjects }) => (
              <div key={journey?.id ?? 'ungrouped'}>
                {journey
                  ? <JourneyHeader journey={journey} brandId={brandId} projectCount={jProjects.length} isAuthorized={isAuthorized} />
                  : groups.length > 1 && <p className="bp-label">No journey</p>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {jProjects.map(p => (
                    <ProjectCard showMomentCode key={p.id} project={p} journeyName={journey?.name ?? null} href={`/brands/${brandId}/projects/${p.id}`} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      {done.length > 0 && (
        <section className="mo-panel mo-panel-pad" aria-label="Completed projects">
          <h2 className="mo-h2" style={{ marginBottom: 16 }}>Completed <span className="mo-count">· {done.length}</span></h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, opacity: 0.7 }}>
            {done.map(p => (
              <ProjectCard showMomentCode key={p.id} project={p} href={`/brands/${brandId}/projects/${p.id}`} />
            ))}
          </div>
        </section>
      )}
    </>
  )
}
