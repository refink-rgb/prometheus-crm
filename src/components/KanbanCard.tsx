'use client'

import { memo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { STAGE_ORDER, STAGE_LABELS, profileName, type Stage, type Project, type Profile } from '@/lib/types'
import { isProjectOverdue, parseAndDaysUntil, parseDueDate, phaseDueTone, STAGE_COLORS, STAGE_DUE_FIELD, type PhaseDueTone } from '@/lib/stageColors'
import { updateProjectStageDueDate } from '@/lib/actions'
import Avatar from '@/components/Avatar'

type PipelineProject = Project & { brands: { id: string; name: string } }

const moveBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border)',
  color: 'var(--text-muted)',
  borderRadius: 6,
  width: 22,
  height: 18,
  lineHeight: 1,
  fontSize: 'var(--text-sm)',
  cursor: 'pointer',
}

interface KanbanCardProps {
  p: PipelineProject
  isGhost?: boolean
  columnStage?: Stage
  onMove?: (card: PipelineProject, targetStage: Stage) => void
  /** Memoized in KanbanView — a fresh Map here would defeat the memo() below. */
  editorsById: Map<string, Profile>
}

function KanbanCardInner({ p, isGhost = false, columnStage, onMove, editorsById }: KanbanCardProps) {
  const lpEditor = p.lp_editor_id ? editorsById.get(p.lp_editor_id) : undefined
  const creativeEditor = p.creative_editor_id ? editorsById.get(p.creative_editor_id) : undefined
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: p.id,
    disabled: isGhost,
  })

  const lpIdx = STAGE_ORDER.indexOf(p.lp_stage)
  const crIdx = STAGE_ORDER.indexOf(p.creatives_stage)
  const cardIdx = Math.min(lpIdx, crIdx)
  const aligned = p.lp_stage === p.creatives_stage

  const { due } = parseAndDaysUntil(p.due_date)
  const isOverdue = isProjectOverdue(p.due_date, p.is_complete, p.lp_stage, p.creatives_stage)

  // Phase target date: the deadline for the column this card sits in (the
  // constraining track's stage). Revisions/Live have no phase date — those cards
  // show only the go-live anchor. `columnStage` is absent on the drag overlay.
  const phaseField = columnStage ? STAGE_DUE_FIELD[columnStage] : null
  const phaseDate = phaseField ? ((p[phaseField as keyof Project] as string | null) ?? null) : null

  // Derived from STAGE_ORDER so removing/adding a stage can't leave this
  // hardcoded denominator wrong (it silently was, when Done existed).
  const progress = Math.round(((lpIdx + crIdx) / ((STAGE_ORDER.length - 1) * 2)) * 100)

  const stageKey = STAGE_ORDER[cardIdx]
  const leftBorderColor = isOverdue ? 'var(--danger)' : STAGE_COLORS[stageKey].border

  // Keyboard-operable equivalent to the mouse/touch drag: moves the card to
  // the adjacent column, mirroring StageTracker's Advance/Back pattern.
  const columnIdx = columnStage ? STAGE_ORDER.indexOf(columnStage) : -1
  const prevStage = columnIdx > 0 ? STAGE_ORDER[columnIdx - 1] : null
  const nextStage = columnIdx >= 0 && columnIdx < STAGE_ORDER.length - 1 ? STAGE_ORDER[columnIdx + 1] : null

  const laggingMsg = !aligned
    ? lpIdx < crIdx
      ? `LP at ${STAGE_LABELS[p.lp_stage]} — advance to match Creatives`
      : `Creatives at ${STAGE_LABELS[p.creatives_stage]} — advance to match LP`
    : null

  return (
    <div
      ref={setNodeRef}
      className="kanban-card"
      style={{
        position: 'relative',
        background: isOverdue
          ? 'color-mix(in srgb, var(--danger) 5%, var(--surface))'
          : 'var(--surface)',
        border: `1px solid ${isOverdue ? 'rgba(239,68,68,0.35)' : 'var(--border)'}`,
        borderLeft: `3px solid ${leftBorderColor}`,
        borderRadius: 10,
        overflow: 'hidden',
        opacity: isDragging ? 0.35 : 1,
        transform: CSS.Translate.toString(transform),
      }}
    >
      {/* Drag handle — deliberately NOT on the same node as the Link below.
          dnd-kit's pointer sensor swallows the click event on whatever
          element its listeners are attached to, even for a plain click that
          never crosses the activation distance, which silently ate every
          first click on a card (confirmed live: click did nothing, a second
          click then navigated). Keeping listeners off the Link fixes that. */}
      {!isGhost && (
        <div
          {...listeners}
          {...attributes}
          aria-hidden="true"
          tabIndex={-1}
          title="Drag to move"
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            width: 20,
            height: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 5,
            cursor: isDragging ? 'grabbing' : 'grab',
            touchAction: 'none',
            color: 'var(--text-muted)',
            zIndex: 1,
          }}
        >
          <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
            <circle cx="2" cy="2" r="1.4" />
            <circle cx="8" cy="2" r="1.4" />
            <circle cx="2" cy="7" r="1.4" />
            <circle cx="8" cy="7" r="1.4" />
            <circle cx="2" cy="12" r="1.4" />
            <circle cx="8" cy="12" r="1.4" />
          </svg>
        </div>
      )}

      <Link
        href={`/brands/${p.brands.id}/projects/${p.id}`}
        style={{
          display: 'block',
          textDecoration: 'none',
          color: 'inherit',
          padding: '12px 14px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

          {/* Brand name — right-padded so the drag handle never overlaps a
              long, ellipsis-truncated name. */}
          <div style={{
            fontSize: 11, color: 'var(--text-muted)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            paddingRight: 20,
          }}>
            {p.brands.name}
          </div>

          {/* Project name */}
          <div style={{
            fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.35,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>
            {p.name}
          </div>

          {/* Track pills */}
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            <TrackBadge label="LP" stage={p.lp_stage} approved={p.lp_approved} />
            <TrackBadge label="CR" stage={p.creatives_stage} approved={p.creatives_approved} />
          </div>

          {/* Misalignment warning */}
          {laggingMsg && (
            <div style={{
              fontSize: 10, color: 'var(--warning)', lineHeight: 1.4,
              background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)',
              borderRadius: 6, padding: '4px 8px',
            }}>
              ⚠ {laggingMsg}
            </div>
          )}

        </div>
      </Link>

      {/* Deadline zone — two distinct dates, two visual languages. Sits OUTSIDE
          the Link so the inline date editor's controls aren't nested in an
          anchor, and stops pointerdown so editing never engages the drag
          sensor. Phase target = the actionable deadline (flares amber/red);
          go-live = the calm green anchor. */}
      {!isGhost && (
        <div
          onPointerDown={e => e.stopPropagation()}
          style={{ padding: '0 14px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}
        >
          {/* Phase target — editable inline. Hidden for live/done columns. */}
          {phaseField && columnStage && (
            <PhaseDueControl
              projectId={p.id}
              brandId={p.brands.id}
              stage={columnStage}
              initialDate={phaseDate}
            />
          )}

          {/* Bottom row: editors left, go-live anchor right. */}
          {(p.due_date || lpEditor || creativeEditor) && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
              <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                {lpEditor && (
                  <Avatar name={profileName(lpEditor)} size={18} title={`LP: ${profileName(lpEditor)}`} />
                )}
                {creativeEditor && (
                  <Avatar name={profileName(creativeEditor)} size={18} title={`Creative: ${profileName(creativeEditor)}`} />
                )}
              </div>
              {p.due_date && (
                <span
                  title={`Go-live ${due?.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`}
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: isOverdue ? 'var(--danger)' : STAGE_COLORS.live.text,
                    background: isOverdue ? 'rgba(239,68,68,0.1)' : STAGE_COLORS.live.bg,
                    borderRadius: 20, padding: '2px 8px',
                    display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0,
                  }}
                >
                  <RocketIcon />
                  Go-live · {due?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Keyboard-operable move controls — equivalent to mouse/touch drag.
          Sits outside the Link (not nested inside an anchor) and stops
          pointerdown propagation so it never engages the drag sensor. */}
      {onMove && (prevStage || nextStage) && !isGhost && (
        <div
          onPointerDown={e => e.stopPropagation()}
          style={{ display: 'flex', justifyContent: 'space-between', padding: '0 8px 8px' }}
        >
          <button
            type="button"
            className="focus-ring-pill"
            aria-label={prevStage ? `Move to ${STAGE_LABELS[prevStage]}` : 'Already in the first stage'}
            disabled={!prevStage}
            onClick={() => prevStage && onMove(p, prevStage)}
            style={moveBtnStyle}
          >
            ‹
          </button>
          <button
            type="button"
            className="focus-ring-pill"
            aria-label={nextStage ? `Move to ${STAGE_LABELS[nextStage]}` : 'Already in the last stage'}
            disabled={!nextStage}
            onClick={() => nextStage && onMove(p, nextStage)}
            style={moveBtnStyle}
          >
            ›
          </button>
        </div>
      )}

      {/* Progress bar — full width at bottom */}
      <div style={{ height: 3, background: 'var(--border)' }}>
        <div style={{
          height: '100%',
          width: `${progress}%`,
          background: progress === 100
            ? 'var(--success)'
            : progress >= 50 ? 'var(--accent)' : 'color-mix(in srgb, var(--accent) 60%, var(--text-muted))',
          transition: 'width 0.3s',
        }} />
      </div>
    </div>
  )
}

// Memoized so drag-over/pointer-move events on the parent board don't force
// every card in every column to re-render. `p` is a stable reference between
// renders (comes straight from server data), so shallow-equal props is enough.
const KanbanCard = memo(KanbanCardInner)
export default KanbanCard

const PHASE_TONE_COLOR: Record<PhaseDueTone, string> = {
  neutral: 'var(--text-muted)',
  urgent:  'var(--warning)',
  overdue: 'var(--danger)',
}

// The phase target date for the card's current column, editable inline so a PM
// sets a deadline without leaving the board. Optimistic: the picked value shows
// immediately; a failed save reverts it. Only the column's own stage date is
// editable here — the actionable one — the rest live on the project page.
function PhaseDueControl({
  projectId,
  brandId,
  stage,
  initialDate,
}: {
  projectId: string
  brandId: string
  stage: Stage
  initialDate: string | null
}) {
  const [override, setOverride] = useState<{ v: string | null } | null>(null)
  const [editing, setEditing] = useState(false)
  const [, startSave] = useTransition()

  const date = override ? override.v : initialDate
  const label = STAGE_LABELS[stage]

  function commit(next: string) {
    const v = next || null
    setOverride({ v })
    setEditing(false)
    startSave(async () => {
      try {
        await updateProjectStageDueDate(projectId, brandId, stage, v)
      } catch {
        setOverride(null)
      }
    })
  }

  if (editing) {
    return (
      <input
        type="date"
        autoFocus
        defaultValue={date ?? ''}
        onChange={e => commit(e.target.value)}
        onBlur={() => setEditing(false)}
        aria-label={`Set ${label} target date`}
        style={{
          fontSize: 11, padding: '2px 6px', width: '100%',
          borderRadius: 6, border: '1px solid var(--border)',
          background: 'var(--surface)', color: 'var(--text-primary)',
        }}
      />
    )
  }

  if (!date) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="focus-ring-pill"
        style={{
          alignSelf: 'flex-start',
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 11, color: 'var(--text-muted)',
          background: 'transparent',
          border: '1px dashed var(--border-strong, var(--border))',
          borderRadius: 20, padding: '2px 9px', cursor: 'pointer',
        }}
      >
        + Set {label} date
      </button>
    )
  }

  const tone = phaseDueTone(date) ?? 'neutral'
  const color = PHASE_TONE_COLOR[tone]
  const { daysUntil } = parseAndDaysUntil(date)
  const shortDate = parseDueDate(date)?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const pill =
    tone === 'overdue'
      ? daysUntil !== null ? `${Math.abs(daysUntil)}d late` : 'Overdue'
      : daysUntil !== null ? `${daysUntil}d` : ''

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="focus-ring-pill"
      title={`Leave ${label} by ${shortDate} — click to edit`}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, width: '100%',
        background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
        fontSize: 11, color,
      }}
    >
      <ClockIcon />
      <span style={{ color: 'var(--text-muted)' }}>Leave {label} by</span>
      <span style={{
        marginLeft: 'auto', flexShrink: 0,
        fontWeight: 600, color,
        background: tone === 'neutral' ? 'transparent' : `color-mix(in srgb, ${color} 14%, transparent)`,
        borderRadius: 20, padding: tone === 'neutral' ? 0 : '1px 8px',
        display: 'inline-flex', alignItems: 'center', gap: 5,
      }}>
        {shortDate}{pill && <span style={{ opacity: 0.85 }}>· {pill}</span>}
      </span>
    </button>
  )
}

function ClockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function RocketIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </svg>
  )
}

function TrackBadge({ label, stage, approved }: { label: string; stage: Stage; approved: boolean }) {
  const color = STAGE_COLORS[stage]
  const inReview = stage === 'client_review'
  const icon = inReview ? (approved ? ' ✓' : ' ⏳') : ''
  return (
    <span style={{
      fontSize: 'var(--text-2xs)', fontWeight: 600, color: color.text,
      background: color.bg,
      border: `1px solid color-mix(in srgb, ${color.border} 25%, transparent)`,
      borderRadius: 5, padding: '2px 6px',
      whiteSpace: 'nowrap',
    }}>
      {label} · {STAGE_LABELS[stage]}{icon}
    </span>
  )
}
