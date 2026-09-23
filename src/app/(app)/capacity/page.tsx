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
import AssignmentsPivot, { type PivotTrack, type PivotEditor } from '@/components/capacity/AssignmentsPivot'

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

  // Assignments-by-editor pivot (reviewers only): every project launching from
  // two months back onward, counted into launch (due-date) months per editor.
  // Attribution is ASSIGNMENT, per Lucas's spec ("base the numbers in the
  // assigns"): lp_editor_id on the LP track, creative_editor_id with the
  // legacy assigned_designer string as fallback on the creative track, and an
  // explicit Unassigned bucket — deleting a user nulls these FKs, so hiding
  // unattributed work would hide real pages.
  let pivot: { tracks: PivotTrack[]; months: string[]; monthLabels: string[] } | null = null
  if (isReviewer) {
    const now = new Date(easternToday() + 'T00:00:00Z')
    const windowStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1))
      .toISOString().slice(0, 10)
    const { data: assignRaw } = await supabase
      .from('projects')
      .select('due_date, lp_editor_id, creative_editor_id, assigned_designer, brands(name)')
      .gte('due_date', windowStart)
    type AssignRow = {
      due_date: string
      lp_editor_id: string | null
      creative_editor_id: string | null
      assigned_designer: string | null
      brands: { name: string } | null
    }
    const assignRows = ((assignRaw ?? []) as unknown as AssignRow[]).filter(r => !!r.due_date)
    const nameOf = (id: string | null) => {
      if (!id) return null
      const p = profiles.find(x => x.id === id)
      return p ? (p.full_name ?? p.email) : null
    }
    pivot = buildAssignmentsPivot(assignRows.map(r => ({
      month: r.due_date.slice(0, 7),
      client: r.brands?.name ?? 'Unknown brand',
      lpEditor: nameOf(r.lp_editor_id) ?? 'Unassigned',
      creativeEditor: nameOf(r.creative_editor_id) ?? r.assigned_designer ?? 'Unassigned',
    })))
  }

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

      {isReviewer && pivot && pivot.months.length > 0 && (
        <section style={{ marginTop: 'var(--space-10)' }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
            Assignments by editor
          </h2>
          <p style={{ fontSize: 'var(--text-base)', color: 'var(--text-muted)', marginBottom: 'var(--space-4)', lineHeight: 1.6 }}>
            Projects per launch month, by current assignment. Click an editor to open their
            client breakdown. Creatives fall back to the legacy designer field when no
            editor is linked.
          </p>
          <AssignmentsPivot tracks={pivot.tracks} months={pivot.months} monthLabels={pivot.monthLabels} />
        </section>
      )}
    </div>
  )
}

// Groups flat (track-implicit) assignment rows into the pivot's shape:
// track -> editor -> month counts + per-client month counts. Editors sort by
// total descending with Unassigned pinned last; clients alphabetically.
function buildAssignmentsPivot(
  rows: { month: string; client: string; lpEditor: string; creativeEditor: string }[],
): { tracks: PivotTrack[]; months: string[]; monthLabels: string[] } {
  const months = [...new Set(rows.map(r => r.month))].sort()
  const spansYears = new Set(months.map(m => m.slice(0, 4))).size > 1
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const monthLabels = months.map(m => {
    const [y, mm] = m.split('-')
    return MONTH_NAMES[Number(mm) - 1] + (spansYears ? ` ${y.slice(2)}` : '')
  })

  const buildTrack = (track: string, editorOf: (r: typeof rows[number]) => string): PivotTrack => {
    const editors = new Map<string, PivotEditor>()
    const trackMonths: Record<string, number> = {}
    let trackTotal = 0
    for (const r of rows) {
      const name = editorOf(r)
      let e = editors.get(name)
      if (!e) {
        e = { name, months: {}, total: 0, clients: [] }
        editors.set(name, e)
      }
      e.months[r.month] = (e.months[r.month] ?? 0) + 1
      e.total += 1
      let c = e.clients.find(x => x.name === r.client)
      if (!c) {
        c = { name: r.client, months: {}, total: 0 }
        e.clients.push(c)
      }
      c.months[r.month] = (c.months[r.month] ?? 0) + 1
      c.total += 1
      trackMonths[r.month] = (trackMonths[r.month] ?? 0) + 1
      trackTotal += 1
    }
    const sorted = [...editors.values()].sort((a, b) => {
      if (a.name === 'Unassigned') return 1
      if (b.name === 'Unassigned') return -1
      return b.total - a.total || a.name.localeCompare(b.name)
    })
    for (const e of sorted) e.clients.sort((a, b) => a.name.localeCompare(b.name))
    return { track, editors: sorted, months: trackMonths, total: trackTotal }
  }

  return {
    tracks: [
      buildTrack('Landing Pages', r => r.lpEditor),
      buildTrack('Creatives', r => r.creativeEditor),
    ],
    months,
    monthLabels,
  }
}
