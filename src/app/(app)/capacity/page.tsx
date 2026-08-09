import { redirect } from 'next/navigation'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { canEdit, canViewCapacity } from '@/lib/permissions'
import { getCachedProfiles } from '@/lib/profiles'
import { currentWeekStart, easternToday } from '@/lib/eastern'
import {
  capacityWeekLabel,
  rotatingQuestionFor,
  type CapacityReport,
  type CapacityReportEntry,
} from '@/lib/types'
import CapacityReportForm, { type MomentOption, type ExistingEntry } from '@/components/capacity/CapacityReportForm'
import TeamRollup, { type TeamSubmission } from '@/components/capacity/TeamRollup'

const UNDEFINED_TABLE = '42P01'

type AssignedProject = {
  id: string
  name: string
  lp_editor_id: string | null
  creative_editor_id: string | null
  brands: { name: string } | null
}

export default async function CapacityPage() {
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!(await canEdit(user?.email))) redirect('/')

  // No isJobEditor() guard, unlike /financials — LP and creative editors are
  // the producers this report exists to hear from.
  const profiles = await getCachedProfiles()
  const myProfile = profiles.find(p => p.email === user?.email?.toLowerCase()) ?? null

  const weekStart = currentWeekStart()
  const isReviewer = canViewCapacity(user?.email)

  // In-flight moments currently assigned to me on either track. Assignment is
  // the same attribution basis /insights uses (see the note in insights.ts),
  // so the two views agree about whose card is whose.
  const projectsQuery = supabase
    .from('projects')
    .select('id, name, lp_editor_id, creative_editor_id, brands(name)')
    .eq('is_complete', false)

  const [projectsResult, reportsResult] = await Promise.all([
    myProfile
      ? projectsQuery.or(`lp_editor_id.eq.${myProfile.id},creative_editor_id.eq.${myProfile.id}`)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('capacity_reports')
      .select('*')
      .eq('week_start', weekStart),
  ])

  const migrationMissing = reportsResult.error?.code === UNDEFINED_TABLE

  const assigned = (projectsResult.data ?? []) as unknown as AssignedProject[]
  const reports = (reportsResult.data ?? []) as unknown as CapacityReport[]
  const myReport = myProfile ? reports.find(r => r.profile_id === myProfile.id) ?? null : null

  // Entries only for the reports we're actually going to render.
  const reportIds = reports.map(r => r.id)
  const { data: entryRows } = reportIds.length > 0
    ? await supabase
        .from('capacity_report_entries')
        .select('id, report_id, project_id, project_label, track, focused_hours, slip_cause')
        .in('report_id', reportIds)
    : { data: [] }
  const entries = (entryRows ?? []) as unknown as CapacityReportEntry[]

  // One option per assigned track — a moment where I own both LP and Creatives
  // shows up as two rows, because they're two different pieces of work.
  const moments: MomentOption[] = assigned
    .flatMap(p => {
      const label = `${p.brands?.name ?? 'Unknown brand'} · ${p.name}`
      const rows: MomentOption[] = []
      if (myProfile && p.lp_editor_id === myProfile.id) {
        rows.push({ projectId: p.id, track: 'lp', label })
      }
      if (myProfile && p.creative_editor_id === myProfile.id) {
        rows.push({ projectId: p.id, track: 'creative', label })
      }
      return rows
    })
    .sort((a, b) => a.label.localeCompare(b.label) || a.track.localeCompare(b.track))

  const myEntries: ExistingEntry[] = myReport
    ? entries
        .filter(e => e.report_id === myReport.id)
        .map(e => ({
          projectId: e.project_id,
          track: e.track,
          label: e.project_label,
          hours: e.focused_hours,
          cause: e.slip_cause,
        }))
    : []

  const submissions: TeamSubmission[] = isReviewer
    ? profiles
        .filter(p => p.can_edit || reports.some(r => r.profile_id === p.id))
        .map(p => {
          const report = reports.find(r => r.profile_id === p.id) ?? null
          const mine = report ? entries.filter(e => e.report_id === report.id) : []
          return {
            profileId: p.id,
            name: p.full_name ?? p.email,
            submitted: !!report?.submitted_at,
            loadRating: report?.load_rating ?? null,
            sustainableMoments: report?.sustainable_moments ?? null,
            momentsCarried: mine.length,
            totalHours: mine.reduce((sum, e) => sum + (Number(e.focused_hours) || 0), 0),
            atRisk: report?.at_risk_next_week ?? null,
            briefsReady: report?.briefs_ready ?? null,
            briefsReadyDetail: report?.briefs_ready_detail ?? null,
            blocker: report?.biggest_blocker ?? null,
            improvement: report?.improvement ?? null,
            rotatingAnswer: report?.rotating_answer ?? null,
            entries: mine.map(e => ({
              label: e.project_label,
              track: e.track,
              hours: e.focused_hours,
              cause: e.slip_cause,
            })),
          }
        })
        .sort((a, b) => Number(b.submitted) - Number(a.submitted) || a.name.localeCompare(b.name))
    : []

  const rotating = rotatingQuestionFor(weekStart)
  const isFriday = new Date(`${easternToday()}T00:00:00Z`).getUTCDay() === 5

  return (
    <div style={{ padding: 'var(--space-8) var(--space-8) var(--space-10)' }}>
      <div style={{ marginBottom: 'var(--space-5)' }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: 4 }}>
          Friday Capacity Report
        </h1>
        <p style={{ fontSize: 'var(--text-base)', color: 'var(--text-muted)' }}>
          {capacityWeekLabel(weekStart)}
          {myReport?.submitted_at ? ' · submitted — edit any time before Monday' : isFriday ? ' · due today' : ''}
        </p>
      </div>

      {migrationMissing && (
        <div style={{
          padding: 'var(--space-4) var(--space-5)', marginBottom: 'var(--space-6)', borderRadius: 10,
          background: 'color-mix(in srgb, var(--warning) 10%, var(--surface-1))',
          border: '1px solid color-mix(in srgb, var(--warning) 35%, var(--border))',
          fontSize: 'var(--text-base)', color: 'var(--text-primary)', lineHeight: 1.6,
        }}>
          <strong>Capacity tables not found.</strong> Run{' '}
          <code>supabase/migrations/20260731_add_capacity_reports.sql</code> in the Supabase SQL
          editor. The form below won&apos;t save until then.
        </div>
      )}

      {!myProfile ? (
        <div className="card" style={{ color: 'var(--text-muted)', fontSize: 'var(--text-base)' }}>
          No profile found for your account, so there&apos;s nothing to file a report against.
          Ask an admin to check the team roster.
        </div>
      ) : (
        <CapacityReportForm
          moments={moments}
          existing={myEntries}
          report={myReport}
          rotating={rotating}
          alreadySubmitted={!!myReport?.submitted_at}
        />
      )}

      {isReviewer && (
        <section style={{ marginTop: 'var(--space-10)' }}>
          <TeamRollup submissions={submissions} weekLabel={capacityWeekLabel(weekStart)} rotating={rotating} />
        </section>
      )}
    </div>
  )
}
