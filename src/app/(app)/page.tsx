import { createClient, getCachedUser } from '@/lib/supabase/server'
import { getCachedProfiles } from '@/lib/profiles'
import type { Project } from '@/lib/types'
import { canViewDashboard } from '@/lib/permissions'
import { easternToday } from '@/lib/eastern'
import { loadDashboard } from '@/lib/dashboard/load'
import { computeInsights } from '@/lib/insights'
import { loadMyBfcmTasks } from '@/lib/bfcm/production-server'
import { loadMyEvergreenAds } from '@/lib/evergreen-server'
import MyAssignmentsPanel from '@/components/MyAssignmentsPanel'
import InsightsCharts from '@/components/InsightsCharts'
import DashboardTabs, { type DashboardTab } from '@/components/dashboard/DashboardTabs'
import FinancialTab from '@/components/dashboard/FinancialTab'
import ManagementTab from '@/components/dashboard/ManagementTab'
import ConcernsTab from '@/components/dashboard/ConcernsTab'

// One pass over projects, stage events, offers, results and the revenue sheet,
// plus the 60-day event window on the Management tab. Give it headroom.
export const maxDuration = 60

type PipelineProject = Project & { brands: { id: string; name: string } }

const TABS: DashboardTab[] = ['financial', 'management', 'concerns']

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const supabase = await createClient()
  const user = await getCachedUser()
  const profiles = await getCachedProfiles()
  const myProfile = profiles.find(p => p.email === user?.email?.toLowerCase()) ?? null

  // LP / Creative editors never see money or client health: their home is
  // just their own work. The management roster sees everything regardless.
  if (!canViewDashboard(user?.email, myProfile) && myProfile) {
    return <EditorHome profileId={myProfile.id} />
  }

  const { tab: rawTab } = await searchParams
  const tab: DashboardTab = TABS.includes(rawTab as DashboardTab) ? (rawTab as DashboardTab) : 'financial'
  const today = easternToday()

  const [data, insights] = await Promise.all([
    loadDashboard(supabase, today),
    tab === 'management' ? computeInsights(supabase, profiles) : Promise.resolve(null),
  ])
  const concernCount = data.concerns.filter(c => c.flags.length > 0).length

  return (
    <div className="dashboard-page" style={{ padding: 'var(--space-6) 32px 40px' }}>
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: 4 }}>
          Dashboard
        </h1>
        <p style={{ fontSize: 'var(--text-base)', color: 'var(--text-muted)' }}>
          {new Date(`${today}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })}
          {data.revenue?.current ? ` · ${data.revenue.current.activeClients} billing clients` : ''}
          {` · ${data.management.activeClients} active brands`}
        </p>
      </div>

      <DashboardTabs active={tab} tabs={TABS} concernCount={concernCount} />

      {tab === 'financial' && <FinancialTab data={data} />}
      {tab === 'management' && (
        <ManagementTab data={data}>
          {insights && <InsightsCharts data={insights} />}
        </ManagementTab>
      )}
      {tab === 'concerns' && <ConcernsTab concerns={data.concerns} showMoney />}
    </div>
  )
}

async function EditorHome({ profileId }: { profileId: string }) {
  const supabase = await createClient()
  const [{ data: pipelineRaw }, bfcmTasks, evergreenAds] = await Promise.all([
    supabase
      .from('projects')
      .select('id, name, brand_id, due_date, is_complete, lp_stage, creatives_stage, lp_approved, creatives_approved, lp_editor_id, creative_editor_id, brands(id, name), moment_code')
      .eq('is_complete', false)
      .order('due_date', { ascending: true }),
    loadMyBfcmTasks(profileId),
    loadMyEvergreenAds(profileId),
  ])
  const pipeline = (pipelineRaw ?? []) as unknown as PipelineProject[]
  return (
    <div className="dashboard-page" style={{ padding: 'var(--space-6) 32px 40px', maxWidth: 900 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: 'var(--space-5)' }}>
        Dashboard
      </h1>
      <MyAssignmentsPanel projects={pipeline} profileId={profileId} bfcmTasks={bfcmTasks} evergreenAds={evergreenAds} />
    </div>
  )
}
