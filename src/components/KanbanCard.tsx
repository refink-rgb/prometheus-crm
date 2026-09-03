'use client'

import { memo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { STAGE_ORDER, STAGE_LABELS, profileName, type Stage, type Project, type Profile } from '@/lib/types'
import { isProjectOverdue, parseAndDaysUntil, parseDueDate, phaseDueTone, STAGE_COLORS, STAGE_DUE_FIELD, type PhaseDueTone } from '@/lib/stageColors'
import { updateProjectStageDueDate } from '@/lib/actions'
import Avatar from '@/components/Avatar'
import { ChevronLeft, ChevronRight, GripVertical, AlertTriangle, Check, Hourglass } from 'lucide-react'

type PipelineProject = Project & { brands: { id: string; name: string } }

// The card's controls — move back, move forward, drag — share one 20px square
// so they read as a single cluster in the top-right corner.
const ctrlStyle: React.CSSProperties = {
  width: 20,
  height: 20,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 5,
  background: 'transparent',
  border: '1px solid transparent',
  color: 'var(--text-muted)',
  padding: 0,
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

  const brandInitial = (p.brands.name.trim()[0] ?? '?').toUpperCase()
  const SEGMENTS = STAGE_ORDER.length - 1
  const filledSegments = Math.round((progress / 100) * SEGMENTS)

  return (
    <div
      ref={setNodeRef}
      className="kanban-card"
      style={{
        position: 'relative',
        background: isOverdue
          ? 'color-mix(in srgb, var(--danger) 4%, var(--surface))'
          : 'var(--surface)',
        border: `1px solid ${isOverdue ? 'color-mix(in srgb, var(--danger) 40%, transparent)' : 'var(--border)'}`,
        borderRadius: 12,
        boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
        overflow: 'hidden',
        opacity: isDragging ? 0.35 : 1,
        transform: CSS.Translate.toString(transform),
      }}
    >
      {/* Stage rail: the colour of the constraining track's stage, red when
          the go-live is past. Inset rather than a full-height border so the
          card's rounded corners stay clean. */}
      <span aria-hidden style={{ position: 'absolute', left: 0, top: 12, bottom: 12, width: 3, borderRadius: '0 3px 3px 0', background: leftBorderColor }} />

      {/* Controls cluster: move back / move forward / drag. The drag handle is
          deliberately NOT on the same node as the Link below — dnd-kit's
          pointer sensor swallows the click event on whatever element its
          listeners are attached to, even for a plain click that never crosses
          the activation distance, which silently ate every first click on a
          card (confirmed live). The move buttons are the keyboard-operable
          equivalent of the drag, and stop pointerdown so they never engage it. */}
      {!isGhost && (
        <div style={{ position: 'absolute', top: 9, right: 9, display: 'flex', alignItems: 'center', gap: 1, zIndex: 1 }}>
          {onMove && columnStage && (
            <div onPointerDown={e => e.stopPropagation()} style={{ display: 'flex', gap: 1 }}>
              <button
                type="button"
                className="focus-ring-pill kanban-ctrl"
                aria-label={prevStage ? `Move to ${STAGE_LABELS[prevStage]}` : 'Already in the first stage'}
                title={prevStage ? `Move to ${STAGE_LABELS[prevStage]}` : undefined}
                disabled={!prevStage}
                onClick={() => prevStage && onMove(p, prevStage)}
                style={ctrlStyle}
              >
                <ChevronLeft size={14} strokeWidth={2} aria-hidden />
              </button>
              <button
                type="button"
                className="focus-ring-pill kanban-ctrl"
                aria-label={nextStage ? `Move to ${STAGE_LABELS[nextStage]}` : 'Already in the last stage'}
                title={nextStage ? `Move to ${STAGE_LABELS[nextStage]}` : undefined}
                disabled={!nextStage}
                onClick={() => nextStage && onMove(p, nextStage)}
                style={ctrlStyle}
              >
                <ChevronRight size={14} strokeWidth={2} aria-hidden />
              </button>
            </div>
          )}
          <div
            {...listeners}
            {...attributes}
            aria-hidden="true"
            tabIndex={-1}
            title="Drag to move"
            className="kanban-ctrl"
            style={{ ...ctrlStyle, cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}
          >
            <GripVertical size={14} strokeWidth={2} aria-hidden />
          </div>
        </div>
      )}

      <Link
        href={`/brands/${p.brands.id}/projects/${p.id}`}
        style={{
          display: 'block',
          textDecoration: 'none',
          color: 'inherit',
          padding: '12px 14px 10px 16px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>

          {/* Brand: a lettered mark and the name, right-padded so the controls
              never overlap a long, ellipsis-truncated name. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, paddingRight: 68, minWidth: 0 }}>
            <span aria-hidden style={{
              width: 18, height: 18, borderRadius: 5, flexShrink: 0,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)',
              background: 'var(--surface-raised)', border: '1px solid var(--border)',
            }}>
              {brandInitial}
            </span>
            <span style={{
              fontSize: 11, fontWeight: 500, color: 'var(--text-secondary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {p.brands.name}
            </span>
          </div>

          {/* Project name */}
          <div style={{
            fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.35, letterSpacing: '-0.005em',
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
              display: 'flex', alignItems: 'flex-start', gap: 5,
              fontSize: 10.5, color: 'var(--warning)', lineHeight: 1.4,
              background: 'color-mix(in srgb, var(--warning) 8%, transparent)',
              border: '1px solid color-mix(in srgb, var(--warning) 22%, transparent)',
              borderRadius: 7, padding: '5px 8px',
            }}>
              <AlertTriangle size={11} strokeWidth={2} aria-hidden style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{laggingMsg}</span>
            </div>
          )}

        </div>
      </Link>

      {/* Footer — two distinct dates, two visual languages, under a hairline.
          Sits OUTSIDE the Link so the inline date editor's controls aren't
          nested in an anchor, and stops pointerdown so editing never engages
          the drag sensor. Phase target = the actionable deadline (flares
          amber/red); go-live = the calm green anchor. */}
      {!isGhost && (
        <div
          onPointerDown={e => e.stopPropagation()}
          style={{
            margin: '0 14px 0 16px', padding: '9px 0 10px',
            borderTop: '1px solid color-mix(in srgb, var(--border) 70%, transparent)',
            display: 'flex', flexDirection: 'column', gap: 7,
          }}
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

          {/* Editors left, go-live anchor right. */}
          {(p.due_date || lpEditor || creativeEditor) && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
              <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                {lpEditor && (
                  <Avatar name={profileName(lpEditor)} size={20} title={`LP: ${profileName(lpEditor)}`} />
                )}
                {creativeEditor && (
                  <Avatar name={profileName(creativeEditor)} size={20} title={`Creative: ${profileName(creativeEditor)}`} />
                )}
              </div>
              {p.due_date && (
                <span
                  title={`Go-live ${due?.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`}
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: isOverdue ? 'var(--danger)' : STAGE_COLORS.live.text,
                    background: isOverdue ? 'color-mix(in srgb, var(--danger) 12%, transparent)' : STAGE_COLORS.live.bg,
                    borderRadius: 20, padding: '3px 9px',
                    display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0,
                  }}
                >
                  <RocketIcon />
                  Go-live · {due?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              )}
            </div>
          )}

          {/* Progress: one segment per stage transition, filled for the
              distance both tracks have covered on average. */}
          <div
            role="img"
            aria-label={`${progress}% through the pipeline`}
            title={`${progress}% through the pipeline`}
            style={{ display: 'flex', gap: 3, marginTop: 1 }}
          >
            {Array.from({ length: SEGMENTS }, (_, i) => (
              <span key={i} style={{
                flex: 1, height: 3, borderRadius: 2,
                background: i < filledSegments
                  ? progress === 100 ? 'var(--success)' : 'var(--accent)'
                  : 'var(--border)',
                transition: 'background 0.3s',
              }} />
            ))}
          </div>
        </div>
      )}
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
      <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Leave by</span>
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
  return (
    <span
      title={inReview ? (approved ? 'Client approved' : 'Waiting on the client') : undefined}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: 'var(--text-2xs)', fontWeight: 600, color: color.text,
        background: color.bg,
        border: `1px solid color-mix(in srgb, ${color.border} 25%, transparent)`,
        borderRadius: 6, padding: '3px 7px',
        whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden style={{ width: 5, height: 5, borderRadius: '50%', background: color.border, flexShrink: 0 }} />
      {label} · {STAGE_LABELS[stage]}
      {inReview && (approved ? <Check size={10} strokeWidth={2.5} aria-hidden /> : <Hourglass size={10} strokeWidth={2} aria-hidden />)}
    </span>
  )
}
