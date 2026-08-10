'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { Stage } from '@/lib/types'
import { STAGE_LABELS, STAGE_ORDER } from '@/lib/types'
import {
  STAGE_COLORS,
  governingStageExit,
  trackExit,
  parseDueDate,
  type StageExit,
  type StageExitFields,
} from '@/lib/stageColors'

// Which track's stage exit each row plots. 'both' keeps the governing-exit
// behavior (the more urgent in-flight track); 'lp' / 'creative' show that
// track's own exits only — mirroring the pipeline board's track toggle.
type TrackFilter = 'both' | 'lp' | 'creative'

// Stages a row can be plotted in. Shipped projects are filtered out
// server-side; 'revisions' and 'ready' are included so those rows can't be
// silently dropped by the stage filter.
const FILTERABLE_STAGES: Stage[] = [
  'brief', 'in_progress', 'internal_review', 'client_review', 'revisions', 'ready', 'live',
]

// Narrowed project row — only what the timeline reads. Mirrors the SELECT in
// timeline/page.tsx and extends the shared StageExitFields so the governing
// helper can consume it directly.
export interface TimelineProject extends StageExitFields {
  id: string
  brand_id: string
  name: string
  brands: { id: string; name: string } | null
}

const LABEL_W = 200 // px — fixed left column so bars share one time axis
const MIN_TRACK = 720 // px — min width of the 7-day area before it scrolls
const DAY_MS = 86_400_000
const SPAN_MS = 7 * DAY_MS
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, n))
}

function parseISODateLocal(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Monday of the week containing `d` (weeks start Monday, matching the header).
function mondayOf(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dow = out.getDay() // 0=Sun
  const delta = dow === 0 ? -6 : 1 - dow
  out.setDate(out.getDate() + delta)
  return out
}

interface Row {
  project: TimelineProject
  exit: StageExit
  goLive: Date | null
}

export default function TimelineView({
  weekStartISO,
  projects,
}: {
  weekStartISO: string
  projects: TimelineProject[]
}) {
  const [track, setTrack] = useState<TrackFilter>('both')
  // Stage chips hide rows currently sitting in that stage; the two overlay
  // chips toggle bar decorations rather than filtering anything out.
  const [hiddenStages, setHiddenStages] = useState<Set<Stage>>(() => new Set())
  const [showOverrun, setShowOverrun] = useState(true)
  const [showRunToLive, setShowRunToLive] = useState(true)

  const toggleStage = (s: Stage) =>
    setHiddenStages(prev => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })

  const weekStart = parseISODateLocal(weekStartISO)
  const weekStartMs = weekStart.getTime()
  const weekEndMs = weekStartMs + SPAN_MS // exclusive (next Monday 00:00)

  const now = new Date()
  const nowMs = now.getTime()
  const nowPctRaw = ((nowMs - weekStartMs) / SPAN_MS) * 100
  const nowInWindow = nowPctRaw >= 0 && nowPctRaw <= 100
  const nowPct = clampPct(nowPctRaw)

  // Build one exit per project — governing (both) or the selected track's own —
  // then bucket by urgency (relative to the real today via daysUntil, not the
  // displayed week). In a single-track view, projects whose selected track has
  // already shipped have nothing left to exit and are dropped as noise.
  const rows: Row[] = projects
    .filter(project => {
      if (track === 'both') return true
      const s = track === 'lp' ? project.lp_stage : project.creatives_stage
      return s !== 'live'
    })
    .map(project => ({
      project,
      exit: track === 'both' ? governingStageExit(project) : trackExit(project, track),
      goLive: parseDueDate(project.due_date),
    }))

  const totalRows = rows.length
  const visibleRows = rows.filter(r => !hiddenStages.has(r.exit.stage))

  const overdue: Row[] = []
  const today: Row[] = []
  const thisWeek: Row[] = []
  let laterCount = 0

  for (const row of visibleRows) {
    const { daysUntil, exitDate } = row.exit
    if (daysUntil === null) continue // no target date — nothing to plot
    if (daysUntil < 0) overdue.push(row)
    else if (daysUntil === 0) today.push(row)
    else if (exitDate && exitDate.getTime() < weekEndMs) thisWeek.push(row)
    else laterCount++
  }

  const byUrgency = (a: Row, b: Row) =>
    (a.exit.daysUntil ?? 0) - (b.exit.daysUntil ?? 0)
  overdue.sort(byUrgency)
  today.sort(byUrgency)
  thisWeek.sort(byUrgency)

  // Day-column boundaries for header + gridlines.
  const days = Array.from({ length: 7 }, (_, i) => new Date(weekStartMs + i * DAY_MS))
  const rangeLabel = `${MONTH_ABBR[days[0].getMonth()]} ${days[0].getDate()} – ${MONTH_ABBR[days[6].getMonth()]} ${days[6].getDate()}, ${days[6].getFullYear()}`

  const prevISO = toISODate(new Date(weekStartMs - SPAN_MS))
  const nextISO = toISODate(new Date(weekStartMs + SPAN_MS))

  return (
    <div>
      {/* Header — title + week nav, mirroring the Calendar's controls. */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap', marginBottom: 'var(--space-5)' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: 'var(--space-1)' }}>
            Stage Exits
          </h1>
          <p style={{ fontSize: 'var(--text-base)', color: 'var(--text-muted)', maxWidth: 560 }}>
            What has to leave its stage this week. A bar ends on its exit deadline — anything crossing the NOW line has slipped.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          {/* Track filter — same pattern as the pipeline board's toggle */}
          <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border)', borderRadius: 20, overflow: 'hidden', marginRight: 'var(--space-2)' }}>
            {(['both', 'lp', 'creative'] as const).map(opt => {
              const active = track === opt
              const labels = { both: 'Both', lp: 'LP', creative: 'Creatives' }
              return (
                <button
                  key={opt}
                  onClick={() => setTrack(opt)}
                  className="focus-ring-pill"
                  title={
                    opt === 'both'
                      ? 'Rows plot the more urgent of the two tracks'
                      : `Rows plot only the ${labels[opt]} track's stage exits`
                  }
                  style={{
                    padding: 'var(--space-2) var(--space-3)',
                    fontSize: 'var(--text-sm)',
                    cursor: 'pointer',
                    border: 'none',
                    fontWeight: active ? 600 : 400,
                    background: active ? 'var(--accent-muted)' : 'transparent',
                    color: active ? 'var(--accent)' : 'var(--text-muted)',
                    transition: 'all 0.15s',
                  }}
                >
                  {labels[opt]}
                </button>
              )
            })}
          </div>
          <Link href={`/timeline?week=${prevISO}`} className="btn-secondary btn-icon focus-ring-pill" aria-label="Previous week">‹</Link>
          <Link href="/timeline" className="btn-secondary btn-sm focus-ring-pill">This week</Link>
          <Link href={`/timeline?week=${nextISO}`} className="btn-secondary btn-icon focus-ring-pill" aria-label="Next week">›</Link>
          <div style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-secondary)', marginLeft: 'var(--space-2)', whiteSpace: 'nowrap' }}>
            {rangeLabel}
          </div>
        </div>
      </div>

      {/* Summary stat cards. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
        <StatCard n={overdue.length} label="Overdue — slipped their stage" tone="danger" />
        <StatCard n={today.length} label="Exit today" tone="warning" />
        <StatCard n={thisWeek.length} label="Exit later this week" tone="neutral" />
        <StatCard n={laterCount} label="Next week or later" tone="muted" />
      </div>

      <Legend
        hiddenStages={hiddenStages}
        onToggleStage={toggleStage}
        showOverrun={showOverrun}
        onToggleOverrun={() => setShowOverrun(v => !v)}
        showRunToLive={showRunToLive}
        onToggleRunToLive={() => setShowRunToLive(v => !v)}
        onReset={() => { setHiddenStages(new Set()); setShowOverrun(true); setShowRunToLive(true) }}
        hiddenCount={totalRows - visibleRows.length}
      />

      {/* Timeline body — its own horizontal-scroll container. */}
      <div style={{ overflowX: 'auto', marginTop: 'var(--space-3)' }}>
        <div style={{ minWidth: LABEL_W + MIN_TRACK, position: 'relative' }}>
          {/* Day header. */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
            <div style={{ width: LABEL_W, flexShrink: 0, padding: '8px 12px', fontSize: 'var(--text-2xs)', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              Project · Current stage
            </div>
            <div style={{ flex: 1, display: 'flex', position: 'relative' }}>
              {days.map((d, i) => {
                const isToday = toISODate(d) === toISODate(now)
                return (
                  <div key={i} style={{ flex: 1, padding: '8px 6px', borderLeft: i === 0 ? 'none' : '1px solid var(--border)', fontSize: 'var(--text-2xs)', fontWeight: 600, color: isToday ? 'var(--accent)' : 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span>{DAY_NAMES[d.getDay()]} {d.getDate()}</span>
                    {isToday && (
                      <span style={{ fontSize: 9, fontWeight: 800, color: '#fff', background: 'var(--accent)', borderRadius: 4, padding: '1px 4px', letterSpacing: '0.04em' }}>NOW</span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Sections. */}
          {overdue.length > 0 && <SectionHeader label="Overdue" hint="still in stage past exit date" tone="danger" />}
          {overdue.map(row => <TimelineRow key={row.project.id} row={row} weekStartMs={weekStartMs} nowPct={nowPct} showOverrun={showOverrun} showRunToLive={showRunToLive} />)}

          {today.length > 0 && <SectionHeader label="Exits today" hint="must move on by end of day" tone="warning" />}
          {today.map(row => <TimelineRow key={row.project.id} row={row} weekStartMs={weekStartMs} nowPct={nowPct} showOverrun={showOverrun} showRunToLive={showRunToLive} />)}

          {thisWeek.length > 0 && <SectionHeader label="Later this week" tone="neutral" />}
          {thisWeek.map(row => <TimelineRow key={row.project.id} row={row} weekStartMs={weekStartMs} nowPct={nowPct} showOverrun={showOverrun} showRunToLive={showRunToLive} />)}

          {overdue.length === 0 && today.length === 0 && thisWeek.length === 0 && (
            <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--text-base)' }}>
              Nothing is due to exit its stage this week. 🎉
            </div>
          )}

          {/* Continuous NOW line overlaid on the whole body (header + rows).
              calc mixes the fixed label width with the day-area fraction. */}
          {nowInWindow && (
            <div aria-hidden style={{ position: 'absolute', top: 0, bottom: 0, width: 2, background: 'var(--accent)', opacity: 0.7, left: `calc(${LABEL_W}px + (100% - ${LABEL_W}px) * ${nowPct / 100})`, pointerEvents: 'none' }} />
          )}
        </div>
      </div>

      {laterCount > 0 && (
        <p style={{ marginTop: 'var(--space-4)', fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
          + {laterCount} more {laterCount === 1 ? 'project exits' : 'projects exit'} next week or later — outside this horizon. Use <strong style={{ color: 'var(--text-secondary)' }}>This week ›</strong> to look ahead.
        </p>
      )}
    </div>
  )
}

function TimelineRow({
  row,
  weekStartMs,
  nowPct,
  showOverrun,
  showRunToLive,
}: {
  row: Row
  weekStartMs: number
  nowPct: number
  showOverrun: boolean
  showRunToLive: boolean
}) {
  const { project, exit, goLive } = row
  const colors = STAGE_COLORS[exit.stage]
  const isOverdue = exit.daysUntil !== null && exit.daysUntil < 0
  const daysUntil = exit.daysUntil ?? 0

  const toPct = (ms: number) => clampPct(((ms - weekStartMs) / SPAN_MS) * 100)
  const exitPct = exit.exitDate ? toPct(exit.exitDate.getTime()) : nowPct
  const goLivePct = goLive ? toPct(goLive.getTime()) : null

  // Leading edge of the "solid" region: the exit deadline, or NOW once overrun.
  const solidRight = isOverdue ? Math.min(exitPct, nowPct) : exitPct
  const dashedStart = isOverdue ? nowPct : exitPct
  const showDashed = goLivePct !== null && goLivePct > dashedStart + 0.5

  const badge = isOverdue
    ? { text: `${Math.abs(daysUntil)}d OVER`, color: 'var(--danger)' }
    : daysUntil === 0
      ? { text: 'DUE TODAY', color: 'var(--warning)' }
      : { text: `${daysUntil}d left`, color: 'var(--text-muted)' }

  const href = project.brands
    ? `/brands/${project.brands.id}/projects/${project.id}`
    : `/brands/${project.brand_id}/projects/${project.id}`

  return (
    <Link
      href={href}
      className="pipeline-row focus-ring-pill"
      style={{ display: 'flex', alignItems: 'stretch', borderBottom: '1px solid var(--border)', textDecoration: 'none', minHeight: 52 }}
    >
      {/* Label cell. */}
      <div style={{ width: LABEL_W, flexShrink: 0, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 3, justifyContent: 'center', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {project.name}
          </span>
          <span title={`${badge.text} · exit governed by the ${exit.track === 'lp' ? 'LP' : 'Creative'} track`} style={{ flexShrink: 0, fontSize: 9, fontWeight: 700, color: badge.color, background: `color-mix(in srgb, ${badge.color} 14%, transparent)`, borderRadius: 4, padding: '1px 5px', letterSpacing: '0.03em' }}>
            {badge.text}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 600, color: colors.text, textTransform: 'uppercase', letterSpacing: '0.05em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {STAGE_LABELS[exit.stage]}
          </span>
          <span style={{ flexShrink: 0, fontSize: 8.5, fontWeight: 700, color: 'var(--text-muted)', border: '1px solid var(--border-strong)', borderRadius: 3, padding: '0 3px', letterSpacing: '0.04em' }}>
            {exit.track === 'lp' ? 'LP' : 'CRE'}
          </span>
        </div>
      </div>

      {/* Track area — bars positioned along the 7-day axis. */}
      <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
        {/* Day gridlines. */}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', pointerEvents: 'none' }}>
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} style={{ flex: 1, borderLeft: i === 0 ? 'none' : '1px solid var(--border)' }} />
          ))}
        </div>

        {/* Bar stack, vertically centered. */}
        <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', transform: 'translateY(-50%)', height: 22 }}>
          {/* Solid current-stage segment. */}
          {solidRight > 0.5 && (
            <div style={{ position: 'absolute', left: 0, width: `${solidRight}%`, top: 0, bottom: 0, background: colors.bg, borderLeft: `3px solid ${colors.border}`, borderRadius: '4px', display: 'flex', alignItems: 'center', paddingLeft: 8, overflow: 'hidden' }}>
              <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 600, color: colors.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {isOverdue ? `${Math.abs(daysUntil)}d over` : STAGE_LABELS[exit.stage]}
              </span>
            </div>
          )}

          {/* Overrun — slipped past the exit deadline, up to NOW. */}
          {showOverrun && isOverdue && nowPct > exitPct + 0.3 && (
            <div title="Overrun — should have left this stage already" style={{ position: 'absolute', left: `${exitPct}%`, width: `${nowPct - exitPct}%`, top: 0, bottom: 0, borderRadius: '0 4px 4px 0', backgroundColor: 'color-mix(in srgb, var(--danger) 22%, transparent)', backgroundImage: 'repeating-linear-gradient(-45deg, transparent, transparent 4px, color-mix(in srgb, var(--danger) 55%, transparent) 4px, color-mix(in srgb, var(--danger) 55%, transparent) 8px)', border: '1px solid color-mix(in srgb, var(--danger) 45%, transparent)', borderLeft: 'none' }} />
          )}

          {/* Leading-edge cap. */}
          <div style={{ position: 'absolute', left: `${solidRight}%`, top: -2, bottom: -2, width: 2, background: isOverdue ? 'var(--danger)' : colors.border, transform: 'translateX(-1px)' }} />

          {/* Dashed run to go-live. */}
          {showRunToLive && showDashed && (
            <div style={{ position: 'absolute', left: `${dashedStart}%`, width: `${goLivePct! - dashedStart}%`, top: 3, bottom: 3, border: `1px dashed ${STAGE_COLORS.live.border}`, borderRadius: 4, background: 'transparent', display: 'flex', alignItems: 'center', paddingLeft: 6, overflow: 'hidden' }}>
              <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 600, color: STAGE_COLORS.live.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                Live
              </span>
            </div>
          )}
        </div>
      </div>
    </Link>
  )
}

function SectionHeader({ label, hint, tone }: { label: string; hint?: string; tone: 'danger' | 'warning' | 'neutral' }) {
  const color = tone === 'danger' ? 'var(--danger)' : tone === 'warning' ? 'var(--warning)' : 'var(--text-secondary)'
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)', padding: '10px 12px 6px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
      {hint && <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>— {hint}</span>}
    </div>
  )
}

function StatCard({ n, label, tone }: { n: number; label: string; tone: 'danger' | 'warning' | 'neutral' | 'muted' }) {
  const color = tone === 'danger' ? 'var(--danger)' : tone === 'warning' ? 'var(--warning)' : tone === 'neutral' ? 'var(--text-primary)' : 'var(--text-secondary)'
  const border = tone === 'danger' && n > 0 ? 'color-mix(in srgb, var(--danger) 40%, var(--border))' : 'var(--border)'
  return (
    <div className="card" style={{ padding: 'var(--space-4)', borderColor: border }}>
      <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1, color, letterSpacing: '-0.02em' }}>{n}</div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 6 }}>{label}</div>
    </div>
  )
}

// The legend doubles as the filter control: stage chips hide/show rows sitting
// in that stage, the last two toggle bar overlays. An "off" chip is dimmed with
// its swatch hollowed out.
function chipStyle(on: boolean): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '4px 10px', borderRadius: 20, cursor: 'pointer',
    fontSize: 'var(--text-xs)',
    border: `1px solid ${on ? 'var(--border-strong)' : 'var(--border)'}`,
    background: on ? 'var(--surface-2)' : 'transparent',
    color: on ? 'var(--text-secondary)' : 'var(--text-muted)',
    opacity: on ? 1 : 0.5,
    transition: 'opacity 0.15s, background 0.15s',
  }
}

function Legend({
  hiddenStages,
  onToggleStage,
  showOverrun,
  onToggleOverrun,
  showRunToLive,
  onToggleRunToLive,
  onReset,
  hiddenCount,
}: {
  hiddenStages: Set<Stage>
  onToggleStage: (s: Stage) => void
  showOverrun: boolean
  onToggleOverrun: () => void
  showRunToLive: boolean
  onToggleRunToLive: () => void
  onReset: () => void
  hiddenCount: number
}) {
  const anyOff = hiddenStages.size > 0 || !showOverrun || !showRunToLive
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center' }}>
      {FILTERABLE_STAGES.map(s => {
        const on = !hiddenStages.has(s)
        return (
          <button
            key={s}
            type="button"
            onClick={() => onToggleStage(s)}
            aria-pressed={on}
            className="focus-ring-pill"
            title={on ? `Hide projects in ${STAGE_LABELS[s]}` : `Show projects in ${STAGE_LABELS[s]}`}
            style={chipStyle(on)}
          >
            <span style={{
              width: 10, height: 10, borderRadius: 2, flexShrink: 0,
              background: on ? STAGE_COLORS[s].border : 'transparent',
              border: `1px solid ${STAGE_COLORS[s].border}`,
            }} />
            <span>{STAGE_LABELS[s]}</span>
          </button>
        )
      })}

      <span aria-hidden style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 4px' }} />

      <button
        type="button"
        onClick={onToggleOverrun}
        aria-pressed={showOverrun}
        className="focus-ring-pill"
        title={showOverrun ? 'Hide the overrun hatching on slipped bars' : 'Show the overrun hatching on slipped bars'}
        style={chipStyle(showOverrun)}
      >
        <span style={{
          width: 14, height: 10, borderRadius: 2, flexShrink: 0,
          backgroundImage: showOverrun
            ? 'repeating-linear-gradient(-45deg, transparent, transparent 2px, color-mix(in srgb, var(--danger) 60%, transparent) 2px, color-mix(in srgb, var(--danger) 60%, transparent) 4px)'
            : 'none',
          border: '1px solid color-mix(in srgb, var(--danger) 45%, transparent)',
        }} />
        <span>Overrun (slipped)</span>
      </button>

      <button
        type="button"
        onClick={onToggleRunToLive}
        aria-pressed={showRunToLive}
        className="focus-ring-pill"
        title={showRunToLive ? 'Hide the dashed run to go-live' : 'Show the dashed run to go-live'}
        style={chipStyle(showRunToLive)}
      >
        <span style={{ width: 14, height: 0, flexShrink: 0, borderTop: `1px dashed ${STAGE_COLORS.live.border}` }} />
        <span>Run to go-live</span>
      </button>

      {anyOff && (
        <button
          type="button"
          onClick={onReset}
          className="focus-ring-pill"
          style={{
            ...chipStyle(true),
            borderColor: 'var(--accent)',
            color: 'var(--accent)',
            background: 'var(--accent-muted)',
          }}
        >
          Reset{hiddenCount > 0 ? ` · ${hiddenCount} hidden` : ''}
        </button>
      )}
    </div>
  )
}
