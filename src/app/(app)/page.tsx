import { createClient, getCachedUser } from '@/lib/supabase/server'
import { getCachedProfiles } from '@/lib/profiles'
import { canEdit } from '@/lib/permissions'
import type { Project } from '@/lib/types'
import { isJobEditor } from '@/lib/types'
import { isProjectOverdue } from '@/lib/stageColors'
import StageDistributionChart from '@/components/LazyStageDistributionChart'
import PipelineTable from '@/components/PipelineTable'
import OverdueProjectsPanel from '@/components/OverdueProjectsPanel'
import MyAssignmentsPanel from '@/components/MyAssignmentsPanel'
import TeamCapacityPanel from '@/components/TeamCapacityPanel'
import DashboardTabs from '@/components/DashboardTabs'

type DashboardBrand = { id: string; monthly_retainer: number | null; is_active: boolean }
type PipelineProject = Project & { brands: { id: string; name: string } }

function fmtCurrency(n: number) {
  return '$' + n.toLocaleString('en-US')
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const user = await getCachedUser()

  // Dashboard only needs MRR + brand count from brands, and a narrow slice of
  // projects to render KPIs / pipeline table / overdue panel. Avoid `select('*')`
  // and the previously-nested projects(*) — both pulled huge JSON copy fields
  // that nothing on this page reads.
  const [{ data: brands }, { data: pipelineRaw }, profiles] = await Promise.all([
    supabase
      .from('brands')
      .select('id, monthly_retainer, is_active')
      .order('created_at', { ascending: false }),
    supabase
      .from('projects')
      // lp_editor_id / creative_editor_id feed the My Work panel.
      .select('id, name, brand_id, due_date, is_complete, lp_stage, creatives_stage, lp_approved, creatives_approved, lp_editor_id, creative_editor_id, brands(id, name)')
      .eq('is_complete', false)
      .order('due_date', { ascending: true }),
    getCachedProfiles(),
  ])

  const allBrands = (brands ?? []) as DashboardBrand[]
  const pipeline = (pipelineRaw ?? []) as unknown as PipelineProject[]
  const isAuthorized = canEdit(user?.email)
  const myProfile = profiles.find(p => p.email === user?.email?.toLowerCase()) ?? null
  const myProfileId = myProfile?.id ?? null
  const editorOnly = isJobEditor(myProfile)

  const activeClients = allBrands.filter(b => (b.monthly_retainer ?? 0) > 0 && b.is_active)
  const mrr = activeClients.reduce((sum, b) => sum + (b.monthly_retainer ?? 0), 0)

  const activeProjectsCount = pipeline.length
  const inClientReview = pipeline.filter(
    p => p.lp_stage === 'client_review' || p.creatives_stage === 'client_review'
  ).length
  const overdue = pipeline.filter(p =>
    isProjectOverdue(p.due_date, p.is_complete, p.lp_stage, p.creatives_stage)
  ).length
  const myAssignmentsCount = myProfileId
    ? pipeline.filter(p => p.lp_editor_id === myProfileId || p.creative_editor_id === myProfileId).length
    : 0

  const projectsWithBrand = pipeline.map(p => ({ ...p, brand_name: p.brands.name }))

  return (
    <div style={{ padding: 'var(--space-6) 32px 40px' }}>
      <DashboardTabs />
      <div style={{ marginBottom: 'var(--space-5)' }}>
        <p style={{ fontSize: 'var(--text-base)', color: 'var(--text-muted)' }}>
          {allBrands.length} brand{allBrands.length !== 1 ? 's' : ''} · {activeProjectsCount} active project{activeProjectsCount !== 1 ? 's' : ''}
        </p>
      </div>

      {/* KPI strip */}
      <div className="kpi-strip" style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${isAuthorized ? 4 : 3}, 1fr)`,
        gap: 'var(--space-3)',
        marginBottom: 'var(--space-6)',
      }}>
        {isAuthorized && (
          editorOnly
            ? <KPICard label="My Assignments" value={String(myAssignmentsCount)} tone="accent" />
            : <KPICard label="MRR" value={fmtCurrency(mrr)} tone="accent" />
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

      {/* Stage distribution chart */}
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <StageDistributionChart projects={pipeline} />
      </div>

      {/* Pipeline table + Overdue panel */}
      <div className="dashboard-grid" style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 65fr) minmax(0, 35fr)',
        gap: 'var(--space-5)',
      }}>
        <div>
          <PipelineTable pipeline={pipeline} />
        </div>
        {/* OverdueProjectsPanel stays at the top of this column: its 34px
            header spacer mirrors PipelineTable's filter bar so the two cards'
            rows line up. My Work goes underneath rather than above. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          <OverdueProjectsPanel projects={projectsWithBrand} />
          <TeamCapacityPanel profiles={profiles} projects={pipeline} />
          {myProfileId && (
            <MyAssignmentsPanel projects={pipeline} profileId={myProfileId} />
          )}
        </div>
      </div>
    </div>
  )
}

function KPICard({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string
  tone?: 'default' | 'accent' | 'amber' | 'red'
}) {
  const toneStyles: Record<string, { bg: string; border: string; color: string }> = {
    default: { bg: 'var(--surface-1)', border: 'var(--border)', color: 'var(--text-primary)' },
    accent:  { bg: 'color-mix(in srgb, var(--accent) 8%, var(--surface-1))', border: 'color-mix(in srgb, var(--accent) 30%, var(--border))', color: 'var(--accent)' },
    amber:   { bg: 'var(--stage-client-bg)', border: 'color-mix(in srgb, #F59E0B 35%, transparent)', color: 'var(--stage-client-text)' },
    red:     { bg: 'var(--urgent-overdue-bg)', border: 'color-mix(in srgb, #EF4444 35%, transparent)', color: 'var(--urgent-overdue)' },
  }
  const s = toneStyles[tone]
  return (
    <div style={{
      background: s.bg,
      border: `1px solid ${s.border}`,
      borderRadius: 10,
      padding: 'var(--space-3) var(--space-4)',
    }}>
      <div style={{
        fontSize: 'var(--text-sm)', fontWeight: 600,
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.07em',
        marginBottom: 'var(--space-1)',
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 'var(--text-2xl)', fontWeight: 700,
        color: s.color,
        letterSpacing: '-0.02em',
        lineHeight: 1.1,
      }}>
        {value}
      </div>
    </div>
  )
}
