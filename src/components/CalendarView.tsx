'use client'

import Link from 'next/link'
import type { Stage } from '@/lib/types'
import { STAGE_LABELS } from '@/lib/types'
import { STAGE_COLORS } from '@/lib/stageColors'

// Narrowed view of a project row — only the fields the calendar actually reads.
// Kept here (not in types.ts) so the SELECT in page.tsx and the type stay in sync.
export interface CalendarProject {
  id: string
  brand_id: string
  name: string
  due_date: string | null
  stage_brief_due_date: string | null
  stage_in_progress_due_date: string | null
  stage_internal_review_due_date: string | null
  stage_client_review_due_date: string | null
  brands: { id: string; name: string } | null
}

interface Marker {
  projectId: string
  projectName: string
  brandId: string
  brandName: string
  stage: Stage
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const DAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Which project column maps to which stage marker. Existing `due_date` = LIVE.
type DateField =
  | 'due_date'
  | 'stage_brief_due_date'
  | 'stage_in_progress_due_date'
  | 'stage_internal_review_due_date'
  | 'stage_client_review_due_date'

const STAGE_DATE_FIELDS: ReadonlyArray<{ field: DateField; stage: Stage }> = [
  { field: 'stage_brief_due_date',           stage: 'brief' },
  { field: 'stage_in_progress_due_date',     stage: 'in_progress' },
  { field: 'stage_internal_review_due_date', stage: 'internal_review' },
  { field: 'stage_client_review_due_date',   stage: 'client_review' },
  { field: 'due_date',                       stage: 'live' },
]

function ymd(dateStr: string | null): string | null {
  // Trust that Postgres DATE columns arrive as YYYY-MM-DD (or ISO with time).
  if (!dateStr) return null
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(dateStr)
  return m ? m[1] : null
}

function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function monthParam(year: number, month0: number): string {
  return `${year}-${String(month0 + 1).padStart(2, '0')}`
}

export default function CalendarView({
  year,
  month,
  projects,
}: {
  year: number
  month: number // 0-indexed
  projects: CalendarProject[]
}) {
  // Bucket markers by ISO date string.
  const markersByDate = new Map<string, Marker[]>()
  for (const p of projects) {
    for (const { field, stage } of STAGE_DATE_FIELDS) {
      const key = ymd(p[field])
      if (!key) continue
      const bucket = markersByDate.get(key) ?? []
      bucket.push({
        projectId: p.id,
        projectName: p.name,
        brandId: p.brand_id,
        brandName: p.brands?.name ?? '',
        stage,
      })
      markersByDate.set(key, bucket)
    }
  }

  // Build the grid: start on the Sunday of the week containing day 1,
  // end on the Saturday of the week containing the last day.
  const firstOfMonth = new Date(year, month, 1)
  const gridStart = new Date(firstOfMonth)
  gridStart.setDate(gridStart.getDate() - firstOfMonth.getDay())

  const lastOfMonth = new Date(year, month + 1, 0)
  const gridEnd = new Date(lastOfMonth)
  gridEnd.setDate(gridEnd.getDate() + (6 - lastOfMonth.getDay()))

  const cells: Date[] = []
  for (let d = new Date(gridStart); d <= gridEnd; d.setDate(d.getDate() + 1)) {
    cells.push(new Date(d))
  }

  const today = toISODate(new Date())
  const prev = { y: month === 0 ? year - 1 : year, m: month === 0 ? 11 : month - 1 }
  const next = { y: month === 11 ? year + 1 : year, m: month === 11 ? 0 : month + 1 }

  return (
    <div>
      {/* Header controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Link
            href={`/calendar?month=${monthParam(prev.y, prev.m)}`}
            style={navBtnStyle}
            aria-label="Previous month"
          >‹</Link>
          <Link
            href={`/calendar?month=${monthParam(next.y, next.m)}`}
            style={navBtnStyle}
            aria-label="Next month"
          >›</Link>
          <Link href="/calendar" style={{ ...navBtnStyle, padding: '6px 12px', fontSize: 12 }}>Today</Link>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginLeft: 8 }}>
            {MONTH_NAMES[month]} {year}
          </div>
        </div>
        <StageLegend />
      </div>

      {/* Weekday header */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, marginBottom: 4 }}>
        {DAY_HEADERS.map(d => (
          <div key={d} style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '4px 8px' }}>
            {d}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, background: 'var(--border)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        {cells.map(cell => {
          const iso = toISODate(cell)
          const inMonth = cell.getMonth() === month
          const isToday = iso === today
          const markers = markersByDate.get(iso) ?? []
          return (
            <div key={iso} style={{
              minHeight: 96,
              background: inMonth ? 'var(--surface)' : 'var(--surface-raised)',
              padding: '6px 8px',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              opacity: inMonth ? 1 : 0.55,
            }}>
              <div style={{
                fontSize: 12,
                fontWeight: isToday ? 700 : 500,
                color: isToday ? 'var(--accent)' : inMonth ? 'var(--text-primary)' : 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}>
                {isToday && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }} />}
                {cell.getDate()}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {markers.slice(0, 4).map((m, i) => (
                  <MarkerPill key={i} marker={m} />
                ))}
                {markers.length > 4 && (
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    +{markers.length - 4} more
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MarkerPill({ marker }: { marker: Marker }) {
  const colors = STAGE_COLORS[marker.stage]
  return (
    <Link
      href={`/brands/${marker.brandId}/projects/${marker.projectId}`}
      title={`${marker.brandName} — ${marker.projectName} · ${STAGE_LABELS[marker.stage]}`}
      style={{
        fontSize: 11,
        color: colors.text,
        background: colors.bg,
        borderLeft: `3px solid ${colors.border}`,
        padding: '2px 6px',
        borderRadius: 3,
        textDecoration: 'none',
        display: 'block',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        lineHeight: 1.3,
      }}
    >
      {marker.projectName}
    </Link>
  )
}

function StageLegend() {
  const stages: Stage[] = ['brief', 'in_progress', 'internal_review', 'client_review', 'live']
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 11 }}>
      {stages.map(s => (
        <div key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{
            width: 8, height: 8, borderRadius: 2,
            background: STAGE_COLORS[s].border,
          }} />
          <span style={{ color: 'var(--text-muted)' }}>{STAGE_LABELS[s]}</span>
        </div>
      ))}
    </div>
  )
}

const navBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 30,
  height: 30,
  padding: '6px 10px',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text-primary)',
  fontSize: 14,
  textDecoration: 'none',
  cursor: 'pointer',
}
