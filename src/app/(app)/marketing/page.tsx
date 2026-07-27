import { createClient } from '@/lib/supabase/server'
import type { CaseStudy } from '@/data/case-studies/types'
import GenerateReportPanel from '@/components/marketing/GenerateReportPanel'

export const metadata = { title: 'Marketing · Prometheus' }

type MarketingReportRow = {
  project_id: string
  report_token: string
  updated_at: string
  data: CaseStudy
}

// Marketing tab: every completed project can be turned into an anonymized public
// "marketing moment report" we send prospects over Slack. Pick a project →
// Generate → fill the metrics form → get a shareable token URL + Slack message.
export default async function MarketingPage() {
  const supabase = await createClient()

  const { data: projectsRaw } = await supabase
    .from('projects')
    .select('id, name, brand_id, created_at')
    .eq('is_complete', true)
    .order('created_at', { ascending: false })

  const projects = (projectsRaw ?? []) as {
    id: string
    name: string
    brand_id: string | null
    created_at: string
  }[]

  const projectIds = projects.map((p) => p.id)
  const brandIds = [...new Set(projects.map((p) => p.brand_id).filter(Boolean))] as string[]

  const [{ data: brandsRaw }, { data: reportsRaw }, { data: assetsRaw }] = await Promise.all([
    brandIds.length
      ? supabase.from('brands').select('id, name').in('id', brandIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    projectIds.length
      ? supabase
          .from('marketing_reports')
          .select('project_id, report_token, updated_at, data')
          .in('project_id', projectIds)
      : Promise.resolve({ data: [] as MarketingReportRow[] }),
    projectIds.length
      ? supabase.from('creative_assets').select('project_id').in('project_id', projectIds)
      : Promise.resolve({ data: [] as { project_id: string }[] }),
  ])

  const brandName = new Map((brandsRaw ?? []).map((b) => [b.id, b.name]))
  const reportByProject = new Map((reportsRaw ?? []).map((r) => [r.project_id, r]))
  const creativeCount = new Map<string, number>()
  for (const a of assetsRaw ?? []) {
    creativeCount.set(a.project_id, (creativeCount.get(a.project_id) ?? 0) + 1)
  }

  // Group completed projects by brand (preserving the newest-first order).
  const groups = new Map<string, { brandLabel: string; projects: typeof projects }>()
  for (const p of projects) {
    const key = p.brand_id ?? '—'
    const brandLabel = (p.brand_id && brandName.get(p.brand_id)) || 'Unassigned'
    if (!groups.has(key)) groups.set(key, { brandLabel, projects: [] })
    groups.get(key)!.projects.push(p)
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 'var(--space-8) var(--space-6) 80px' }}>
      <header style={{ marginBottom: 'var(--space-8)' }}>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 800,
            color: 'var(--text-primary)',
            letterSpacing: '-0.03em',
            marginBottom: 'var(--space-2)',
          }}
        >
          Marketing
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.6, maxWidth: 640 }}>
          Turn a completed project into an anonymized <strong>marketing moment report</strong> — a
          public, shareable case study for Slack. Generating one mints an unguessable link and a
          ready-to-paste Slack message. The brand is never named on the public page.
        </p>
      </header>

      {projects.length === 0 ? (
        <div className="card" style={{ color: 'var(--text-muted)' }}>
          No completed projects yet. Mark a project done to generate a report from it.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
          {[...groups.values()].map((group) => (
            <section key={group.brandLabel}>
              <h2
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  marginBottom: 12,
                }}
              >
                {group.brandLabel}
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                {group.projects.map((p) => {
                  const report = reportByProject.get(p.id)
                  return (
                    <div key={p.id} className="card">
                      <GenerateReportPanel
                        projectId={p.id}
                        projectName={p.name}
                        creativeCount={creativeCount.get(p.id) ?? 0}
                        existingToken={report?.report_token ?? null}
                        existingUpdatedAt={report?.updated_at ?? null}
                        existingData={report?.data ?? null}
                      />
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
