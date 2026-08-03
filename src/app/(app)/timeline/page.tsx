import { redirect } from 'next/navigation'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import TimelineView, { type TimelineProject } from '@/components/TimelineView'

function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Monday of the week containing the given (or requested) day. Weeks start
// Monday to match the header rendered by TimelineView.
function weekStartFrom(param: string | undefined): Date {
  const base =
    param && /^\d{4}-\d{2}-\d{2}$/.test(param)
      ? (() => {
          const [y, m, d] = param.split('-').map(Number)
          return new Date(y, m - 1, d)
        })()
      : new Date()
  const out = new Date(base.getFullYear(), base.getMonth(), base.getDate())
  const dow = out.getDay() // 0=Sun
  out.setDate(out.getDate() + (dow === 0 ? -6 : 1 - dow))
  return out
}

export default async function TimelinePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>
}) {
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) redirect('/login')

  const { week } = await searchParams
  const weekStart = weekStartFrom(week)

  // Narrow SELECT: the timeline needs id/brand/name, both stages, and the five
  // date columns the governing-exit helper reads. Pulling `*` would drag the
  // JSONB copy banks and every brief field per project.
  //
  // We fetch every in-flight project (not complete) rather than filtering by
  // date range in SQL: the "Overdue" bucket must catch projects whose exit
  // date is already in the past, which a window filter would drop. The set of
  // open projects is small, so this is one cheap round-trip.
  const { data: raw } = await supabase
    .from('projects')
    .select('id, brand_id, name, due_date, lp_stage, creatives_stage, stage_brief_due_date, stage_in_progress_due_date, stage_internal_review_due_date, stage_client_review_due_date, brands(id, name)')
    .eq('is_complete', false)

  // Supabase infers `brands` as an array from the FK; at runtime a single-row
  // FK comes back as an object. Route through `unknown` like the rest of the app.
  const all = ((raw ?? []) as unknown) as TimelineProject[]

  // Drop projects where both tracks have already shipped — they have no stage
  // left to exit and would only add noise. 'done' is still matched for rows
  // written before that stage was retired (pre-migration).
  const shipped = (s: string) => s === 'live' || s === 'done'
  const projects = all.filter(p => !(shipped(p.lp_stage) && shipped(p.creatives_stage)))

  return (
    <div style={{ padding: 'var(--space-6) 32px 40px' }}>
      <TimelineView weekStartISO={toISODate(weekStart)} projects={projects} />
    </div>
  )
}
