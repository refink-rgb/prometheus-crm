'use client'

import { memo } from 'react'
import Link from 'next/link'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { STAGE_ORDER, STAGE_LABELS, profileName, type Stage, type Project, type Profile } from '@/lib/types'
import { isProjectOverdue, parseAndDaysUntil, STAGE_COLORS } from '@/lib/stageColors'
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

  const { due, daysUntil: daysLeft } = parseAndDaysUntil(p.due_date)
  const isOverdue = isProjectOverdue(p.due_date, p.is_complete, p.lp_stage, p.creatives_stage)
  const isUrgent = !isOverdue && daysLeft !== null && daysLeft >= 0 && daysLeft <= 7

  const progress = Math.round(((lpIdx + crIdx) / (5 * 2)) * 100)

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
      {...(isGhost ? {} : listeners)}
      {...(isGhost ? {} : attributes)}
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
        cursor: isGhost ? 'grabbing' : isDragging ? 'grabbing' : 'grab',
        transform: CSS.Translate.toString(transform),
        touchAction: 'none',
      }}
    >
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

          {/* Brand name */}
          <div style={{
            fontSize: 11, color: 'var(--text-muted)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
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

          {/* Bottom row: editors left, due date right. Rendered when either is
              present — the due date used to be the row's only reason to exist. */}
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
                <span style={{
                  fontSize: 11,
                  color: isOverdue ? 'var(--danger)' : isUrgent ? 'var(--warning)' : 'var(--text-muted)',
                  fontWeight: isOverdue || isUrgent ? 600 : 400,
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                }}>
                  <span style={{
                    width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
                    background: isOverdue ? 'var(--danger)' : isUrgent ? 'var(--warning)' : 'var(--text-muted)',
                  }} />
                  {due?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              )}
            </div>
          )}
        </div>
      </Link>

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
