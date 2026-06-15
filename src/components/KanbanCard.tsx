'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { updateProjectStage } from '@/lib/actions'
import { STAGE_ORDER, STAGE_LABELS, type Stage, type Project } from '@/lib/types'

type PipelineProject = Project & { brands: { id: string; name: string } }

const STAGE_COLORS: Record<Stage, string> = {
  brief: 'var(--text-muted)',
  in_progress: 'var(--accent)',
  review: 'var(--warning)',
  done: 'var(--success)',
}

export default function KanbanCard({ p }: { p: PipelineProject }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const lpIdx = STAGE_ORDER.indexOf(p.lp_stage)
  const crIdx = STAGE_ORDER.indexOf(p.creatives_stage)
  const cardIdx = Math.min(lpIdx, crIdx)
  const aligned = p.lp_stage === p.creatives_stage

  const now = Date.now()
  const due = p.due_date ? new Date(p.due_date) : null
  const daysLeft = due ? Math.ceil((due.getTime() - now) / (1000 * 60 * 60 * 24)) : null
  const isOverdue = daysLeft !== null && daysLeft < 0
  const isUrgent = daysLeft !== null && daysLeft >= 0 && daysLeft <= 7

  const progress = Math.round(((lpIdx + crIdx) / ((STAGE_ORDER.length - 1) * 2)) * 100)

  const canAdvance = aligned && cardIdx < STAGE_ORDER.length - 1 && !isPending
  const canRetreat = aligned && cardIdx > 0 && !isPending

  const laggingMsg = !aligned
    ? lpIdx < crIdx
      ? `LP is at ${STAGE_LABELS[p.lp_stage]} — advance it to match Creatives`
      : `Creatives is at ${STAGE_LABELS[p.creatives_stage]} — advance it to match LP`
    : null

  function moveCard(dir: 1 | -1, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const targetIdx = cardIdx + dir
    if (targetIdx < 0 || targetIdx >= STAGE_ORDER.length) return
    const target = STAGE_ORDER[targetIdx]
    setError(null)
    startTransition(async () => {
      try {
        await Promise.all([
          updateProjectStage(p.id, p.brands.id, 'lp_stage', target),
          updateProjectStage(p.id, p.brands.id, 'creatives_stage', target),
        ])
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Move failed')
      }
    })
  }

  return (
    <div style={{
      position: 'relative',
      background: isOverdue
        ? 'color-mix(in srgb, var(--danger) 5%, var(--surface))'
        : 'var(--surface)',
      border: `1px solid ${isOverdue ? 'rgba(239,68,68,0.35)' : 'var(--border)'}`,
      borderLeft: `3px solid ${isOverdue ? 'var(--danger)' : STAGE_COLORS[STAGE_ORDER[cardIdx]]}`,
      borderRadius: 10,
      overflow: 'hidden',
      opacity: isPending ? 0.6 : 1,
      transition: 'opacity 0.15s, border-color 0.15s',
    }}>
      <Link
        href={`/brands/${p.brands.id}/projects/${p.id}`}
        style={{
          display: 'block',
          textDecoration: 'none',
          color: 'inherit',
          padding: '12px 14px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>

          {/* Brand + project name (right-padded to avoid overlap with buttons) */}
          <div style={{ paddingRight: 56 }}>
            <div style={{
              fontSize: 11, color: 'var(--text-muted)', marginBottom: 2,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {p.brands.name}
            </div>
            <div style={{
              fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.35,
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}>
              {p.name}
            </div>
          </div>

          {/* Track badges */}
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            <TrackBadge label="LP" stage={p.lp_stage} approved={p.lp_approved} />
            <TrackBadge label="CR" stage={p.creatives_stage} approved={p.creatives_approved} />
          </div>

          {/* Misaligned warning */}
          {laggingMsg && (
            <div style={{
              fontSize: 10, color: 'var(--warning)', lineHeight: 1.4,
              background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)',
              borderRadius: 6, padding: '5px 8px',
            }}>
              ⚠ {laggingMsg}
            </div>
          )}

          {/* Move error */}
          {error && (
            <div style={{
              fontSize: 10, color: 'var(--danger)', lineHeight: 1.4,
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
              borderRadius: 6, padding: '5px 8px',
            }}>
              {error}
            </div>
          )}

          {/* Due date */}
          {p.due_date && (
            <div style={{
              fontSize: 11,
              color: isOverdue ? 'var(--danger)' : isUrgent ? 'var(--warning)' : 'var(--text-muted)',
              fontWeight: isOverdue || isUrgent ? 600 : 400,
            }}>
              {isOverdue ? '⚠ ' : ''}
              Due {new Date(p.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </div>
          )}
        </div>
      </Link>

      {/* Move buttons (absolute, sit above the Link) */}
      <div style={{
        position: 'absolute', top: 10, right: 10,
        display: 'flex', gap: 3, zIndex: 2,
      }}>
        <MoveButton
          glyph="‹"
          disabled={!canRetreat}
          isPending={isPending}
          title={!aligned ? (laggingMsg ?? 'Move back') : 'Move back'}
          onClick={(e) => moveCard(-1, e)}
        />
        <MoveButton
          glyph="›"
          disabled={!canAdvance}
          isPending={isPending}
          title={!aligned ? (laggingMsg ?? 'Move forward') : 'Move forward'}
          onClick={(e) => moveCard(1, e)}
        />
      </div>

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

function MoveButton({
  glyph, disabled, isPending, title, onClick,
}: {
  glyph: string
  disabled: boolean
  isPending: boolean
  title: string
  onClick: (e: React.MouseEvent) => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        background: 'var(--surface-raised)', border: '1px solid var(--border)',
        color: 'var(--text-muted)', borderRadius: 5, width: 22, height: 22,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: disabled ? 'not-allowed' : isPending ? 'wait' : 'pointer',
        fontSize: 13, fontWeight: 700, flexShrink: 0,
        opacity: disabled ? 0.3 : 1,
        transition: 'opacity 0.15s',
      }}
    >
      {glyph}
    </button>
  )
}

function TrackBadge({ label, stage, approved }: { label: string; stage: Stage; approved: boolean }) {
  const color = STAGE_COLORS[stage]
  const inReview = stage === 'review'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{
        fontSize: 10, fontWeight: 600, color,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
        borderRadius: 5, padding: '2px 6px',
      }}>
        {label} · {STAGE_LABELS[stage]}
      </span>
      {inReview && !approved && (
        <span style={{
          fontSize: 9, fontWeight: 700, color: 'var(--warning)',
          background: 'rgba(234,179,8,0.15)', border: '1px solid rgba(234,179,8,0.3)',
          borderRadius: 4, padding: '1px 4px',
        }}>
          PENDING
        </span>
      )}
      {inReview && approved && (
        <span style={{
          fontSize: 9, fontWeight: 700, color: 'var(--success)',
          background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)',
          borderRadius: 4, padding: '1px 4px',
        }}>
          ✓
        </span>
      )}
    </div>
  )
}
