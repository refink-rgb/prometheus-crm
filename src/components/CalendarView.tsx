'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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

// Max markers shown inline in a day cell before collapsing into "+N more".
const VISIBLE_MARKERS = 3

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

// Parses a `YYYY-MM-DD` key as a local-midnight Date (avoids the UTC-parse
// off-by-one-day bug that plain `new Date(iso)` has west of UTC).
function parseISODateLocal(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
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
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Link
            href={`/calendar?month=${monthParam(prev.y, prev.m)}`}
            className="btn-secondary btn-icon focus-ring-pill"
            aria-label="Previous month"
          >‹</Link>
          <Link
            href={`/calendar?month=${monthParam(next.y, next.m)}`}
            className="btn-secondary btn-icon focus-ring-pill"
            aria-label="Next month"
          >›</Link>
          <Link href="/calendar" className="btn-secondary btn-sm focus-ring-pill">Today</Link>
          <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--text-primary)', marginLeft: 'var(--space-2)' }}>
            {MONTH_NAMES[month]} {year}
          </div>
        </div>
        <StageLegend />
      </div>

      {/* Grid — its own horizontal scroll container so a narrow viewport
          scrolls the calendar instead of the whole page overflowing. */}
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 700 }}>
          {/* Weekday header */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 1, marginBottom: 'var(--space-1)' }}>
            {DAY_HEADERS.map(d => (
              <div key={d} style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '4px 8px' }}>
                {d}
              </div>
            ))}
          </div>

          {/* Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 1, background: 'var(--border)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            {cells.map(cell => {
              const iso = toISODate(cell)
              const inMonth = cell.getMonth() === month
              const isToday = iso === today
              const markers = markersByDate.get(iso) ?? []
              const hiddenCount = Math.max(0, markers.length - VISIBLE_MARKERS)
              return (
                <div key={iso} style={{
                  minWidth: 0,
                  minHeight: 108,
                  background: inMonth ? 'var(--surface)' : 'var(--surface-raised)',
                  padding: 'var(--space-2)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-1)',
                  opacity: inMonth ? 1 : 0.55,
                }}>
                  <button
                    type="button"
                    onClick={() => setSelectedDate(iso)}
                    className="focus-ring-pill"
                    aria-label={`View all deliverables for ${cell.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`}
                    style={{
                      alignSelf: 'flex-start',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      background: isToday ? 'var(--accent)' : 'transparent',
                      border: 'none',
                      borderRadius: 5,
                      padding: isToday ? '1px 7px' : '1px 4px',
                      cursor: 'pointer',
                      fontSize: 'var(--text-sm)',
                      fontWeight: isToday ? 700 : 500,
                      color: isToday ? '#fff' : inMonth ? 'var(--text-primary)' : 'var(--text-muted)',
                    }}
                  >
                    {cell.getDate()}
                  </button>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                    {markers.slice(0, VISIBLE_MARKERS).map((m, i) => (
                      <MarkerPill key={i} marker={m} />
                    ))}
                    {hiddenCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedDate(iso)}
                        className="focus-ring-pill"
                        style={{
                          fontSize: 'var(--text-2xs)',
                          fontWeight: 600,
                          color: 'var(--text-muted)',
                          background: 'transparent',
                          border: 'none',
                          padding: '2px 4px',
                          textAlign: 'left',
                          cursor: 'pointer',
                        }}
                      >
                        +{hiddenCount} more
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {selectedDate && (
        <DayDetailModal
          iso={selectedDate}
          markers={markersByDate.get(selectedDate) ?? []}
          onClose={() => setSelectedDate(null)}
        />
      )}
    </div>
  )
}

function DayDetailModal({
  iso,
  markers,
  onClose,
}: {
  iso: string
  markers: Marker[]
  onClose: () => void
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeButtonRef.current?.focus()
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  if (typeof document === 'undefined') return null

  const dateLabel = parseISODateLocal(iso).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 'var(--space-4)',
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="day-detail-title"
        className="card"
        style={{ width: '100%', maxWidth: 420, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
          <h2 id="day-detail-title" style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            {dateLabel}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="focus-ring-pill"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: 'var(--text-lg)',
              lineHeight: 1,
              cursor: 'pointer',
              padding: 4,
            }}
          >
            ×
          </button>
        </div>

        {markers.length === 0 ? (
          <p style={{ fontSize: 'var(--text-base)', color: 'var(--text-muted)' }}>No deliverables due this day.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', overflowY: 'auto' }}>
            {markers.map((m, i) => {
              const colors = STAGE_COLORS[m.stage]
              return (
                <Link
                  key={i}
                  href={`/brands/${m.brandId}/projects/${m.projectId}`}
                  className="focus-ring-pill calendar-event-link"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                    borderLeft: `3px solid ${colors.border}`,
                    background: colors.bg,
                    borderRadius: 6,
                    padding: 'var(--space-2) var(--space-3)',
                    textDecoration: 'none',
                  }}
                >
                  <span style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {m.projectName}
                  </span>
                  <span style={{ fontSize: 'var(--text-xs)', color: colors.text, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {m.brandName} · {STAGE_LABELS[m.stage]}
                  </span>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

function MarkerPill({ marker }: { marker: Marker }) {
  const colors = STAGE_COLORS[marker.stage]
  return (
    <Link
      href={`/brands/${marker.brandId}/projects/${marker.projectId}`}
      title={`${marker.brandName} — ${marker.projectName} · ${STAGE_LABELS[marker.stage]}`}
      className="focus-ring-pill calendar-event-link"
      style={{
        fontSize: 'var(--text-xs)',
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
        minWidth: 0,
      }}
    >
      {marker.projectName}
    </Link>
  )
}

function StageLegend() {
  const stages: Stage[] = ['brief', 'in_progress', 'internal_review', 'client_review', 'live']
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', fontSize: 'var(--text-xs)' }}>
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
