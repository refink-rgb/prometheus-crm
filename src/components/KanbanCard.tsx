'use client'

import Link from 'next/link'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { STAGE_LABELS, type Stage, type Project } from '@/lib/types'
import { isProjectOverdue } from '@/lib/stageColors'

type PipelineProject = Project & { brands: { id: string; name: string } }

const STAGE_COLORS: Record<Stage, string> = {
  brief:           'var(--text-muted)',
  in_progress:     'var(--accent)',
  internal_review: '#a855f7',
  client_review:   'var(--warning)',
  live:            '#14b8a6',
  done:            'var(--success)',
}

interface KanbanCardProps {
  p: PipelineProject
  isGhost?: boolean
}

export default function KanbanCard({ p, isGhost = false }: KanbanCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: p.id,
    disabled: isGhost,
  })

  const lpIdx = ['brief', 'in_progress', 'internal_review', 'client_review', 'live', 'done'].indexOf(p.lp_stage)
  const crIdx = ['brief', 'in_progress', 'internal_review', 'client_review', 'live', 'done'].indexOf(p.creatives_stage)
  const cardIdx = Math.min(lpIdx, crIdx)
  const aligned = p.lp_stage === p.creatives_stage

  const now = Date.now()
  const due = p.due_date ? new Date(p.due_date) : null
  const daysLeft = due ? Math.ceil((due.getTime() - now) / (1000 * 60 * 60 * 24)) : null
  const isOverdue = isProjectOverdue(p.due_date, p.is_complete, p.lp_stage, p.creatives_stage)
  const isUrgent = !isOverdue && daysLeft !== null && daysLeft >= 0 && daysLeft <= 7

  const progress = Math.round(((lpIdx + crIdx) / (5 * 2)) * 100)

  const stageKey = ['brief', 'in_progress', 'internal_review', 'client_review', 'live', 'done'][cardIdx] as Stage
  const leftBorderColor = isOverdue ? 'var(--danger)' : STAGE_COLORS[stageKey]

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

          {/* Bottom row: due date right-aligned */}
          {p.due_date && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
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
                {new Date(p.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            </div>
          )}
        </div>
      </Link>

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

function TrackBadge({ label, stage, approved }: { label: string; stage: Stage; approved: boolean }) {
  const color = STAGE_COLORS[stage]
  const inReview = stage === 'client_review'
  const icon = inReview ? (approved ? ' ✓' : ' ⏳') : ''
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, color,
      background: `color-mix(in srgb, ${color} 12%, transparent)`,
      border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
      borderRadius: 5, padding: '2px 6px',
      whiteSpace: 'nowrap',
    }}>
      {label} · {STAGE_LABELS[stage]}{icon}
    </span>
  )
}
