import { redirect } from 'next/navigation'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import CalendarView, { type CalendarProject } from '@/components/CalendarView'

function parseMonth(param: string | undefined): { year: number; month: number } {
  // month is 0-indexed to match JS Date semantics
  if (param && /^\d{4}-\d{2}$/.test(param)) {
    const [y, m] = param.split('-').map(Number)
    return { year: y, month: m - 1 }
  }
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() }
}

function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) redirect('/login')

  const { month: monthParam } = await searchParams
  const { year, month } = parseMonth(monthParam)

  // Fetch a small buffer around the visible month so days that spill into the
  // adjacent months (leading/trailing week rows of the grid) also render markers.
  const rangeStart = new Date(year, month, 1)
  rangeStart.setDate(rangeStart.getDate() - 7)
  const rangeEnd = new Date(year, month + 1, 0)
  rangeEnd.setDate(rangeEnd.getDate() + 7)
  const startStr = toISODate(rangeStart)
  const endStr = toISODate(rangeEnd)

  // "Any of the 5 date columns falls within the range" — one round-trip with an OR.
  const dateCols = [
    'due_date',
    'stage_brief_due_date',
    'stage_in_progress_due_date',
    'stage_internal_review_due_date',
    'stage_client_review_due_date',
  ]
  const orClause = dateCols
    .map(col => `and(${col}.gte.${startStr},${col}.lte.${endStr})`)
    .join(',')

  // Narrow SELECT: the calendar only needs the id, brand, name, and 5 date columns.
  // Pulling `*` would drag the JSONB copy banks + every brief field per project.
  const { data: raw } = await supabase
    .from('projects')
    .select('id, brand_id, name, due_date, stage_brief_due_date, stage_in_progress_due_date, stage_internal_review_due_date, stage_client_review_due_date, brands(id, name)')
    .or(orClause)

  // Supabase infers `brands` as an array from the FK, but at runtime a
  // single-row FK comes back as an object. Route through `unknown` to match
  // the pattern used by the rest of the app (e.g. dashboard page).
  const projects = ((raw ?? []) as unknown) as CalendarProject[]

  return (
    <div style={{ padding: '28px 32px 40px' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: 4 }}>
          Calendar
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Per-stage target dates across the month.
        </p>
      </div>

      <CalendarView year={year} month={month} projects={projects} />
    </div>
  )
}
