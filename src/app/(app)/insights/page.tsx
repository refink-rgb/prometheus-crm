import { redirect } from 'next/navigation'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { getCachedProfiles } from '@/lib/profiles'
import { canEdit } from '@/lib/permissions'
import { computeInsights } from '@/lib/insights'
import InsightsCharts from '@/components/InsightsCharts'
import DashboardTabs from '@/components/DashboardTabs'

// Insights read the whole event window (up to 60 days) and aggregate in JS.
// Small data, but give it headroom over the default so a cold read never trips
// the function timeout.
export const maxDuration = 60

export default async function InsightsPage() {
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) redirect('/login')
  // Insights are an operational/management view — gate to editors, same bar as
  // the rest of the authed app.
  if (!canEdit(user.email)) redirect('/')

  const profiles = await getCachedProfiles()
  const data = await computeInsights(supabase, profiles)

  return (
    <div style={{ padding: 'var(--space-6) 32px 40px' }}>
      <DashboardTabs />
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <p style={{ fontSize: 'var(--text-base)', color: 'var(--text-muted)' }}>
          {data.events_since
            ? `${data.event_count.toLocaleString()} events since ${data.events_since} · read-only over the pipeline event stream`
            : 'Read-only analytics over the pipeline event stream'}
        </p>
      </div>

      <InsightsCharts data={data} />
    </div>
  )
}
