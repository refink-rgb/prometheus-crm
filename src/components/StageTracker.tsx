'use client'

import { useOptimistic, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateProjectStage } from '@/lib/actions'
import { STAGE_ORDER, STAGE_LABELS, STAGE_COLORS, normalizeStage, type Stage } from '@/lib/stageColors'

interface StageTrackerProps {
  projectId: string
  brandId: string
  track: 'lp_stage' | 'creatives_stage'
  currentStage: Stage
  label: string
  disabled?: boolean
}

// One track's pipeline as a rail of steps. Every step is a button, so a project
// can be sent straight back to In Progress from Client Review without stepping
// through each stage; Back and Advance remain for the routine one-step move, and
// Advance says where it is going so nobody has to read the rail to find out.
export default function StageTracker({
  projectId,
  brandId,
  track,
  currentStage,
  label,
  disabled = false,
}: StageTrackerProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  // An archived project still renders this tracker (disabled), and rows written
  // before the Done stage was retired hold 'done' until the migration runs —
  // which would index STAGE_COLORS/STAGE_ORDER out of range and blow up the
  // render. Normalize on the way in so old projects stay fully viewable.
  const [optimisticStage, setOptimisticStage] = useOptimistic(
    normalizeStage(currentStage),
    (_current: Stage, newStage: Stage) => newStage
  )
  const optimisticIndex = STAGE_ORDER.indexOf(optimisticStage)
  const trackTag = track === 'lp_stage' ? 'LP' : 'CRE'
  const currColors = STAGE_COLORS[optimisticStage]
  const nextStage = STAGE_ORDER[optimisticIndex + 1] as Stage | undefined
  const prevStage = STAGE_ORDER[optimisticIndex - 1] as Stage | undefined

  function moveTo(stage: Stage) {
    if (disabled || isPending || stage === optimisticStage) return
    startTransition(async () => {
      setOptimisticStage(stage)
      await updateProjectStage(projectId, brandId, track, stage)
      router.refresh()
    })
  }

  return (
    <section
      aria-label={`${label} stage`}
      style={{
        background: 'var(--surface-raised)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        padding: '18px 22px 16px',
        opacity: isPending ? 0.75 : 1,
        transition: 'opacity 0.15s',
      }}
    >
      {/* Header: which track, and where it is right now in words. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.09em',
          color: currColors.text,
          background: currColors.bg,
          border: `1px solid color-mix(in srgb, ${currColors.border} 30%, transparent)`,
          padding: '4px 9px',
          borderRadius: 6,
          flexShrink: 0,
        }}>
          {trackTag}
        </span>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
          {label}
        </span>
        <span style={{
          marginLeft: 'auto', fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 999,
          background: currColors.bg, color: currColors.text,
        }}>
          Now · {STAGE_LABELS[optimisticStage]}
        </span>
        {disabled && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>🔒 Locked</span>
        )}
      </div>

      {/* Rail */}
      <ol style={{ display: 'flex', alignItems: 'flex-start', width: '100%', margin: 0, padding: 0, listStyle: 'none' }}>
        {STAGE_ORDER.map((stage, i) => {
          const isPast    = i < optimisticIndex
          const isCurrent = i === optimisticIndex
          const colors    = STAGE_COLORS[stage]

          let circleBg = 'var(--surface-1)'
          let circleBorder = 'var(--border-strong)'
          let circleColor = 'var(--text-muted)'
          let boxShadow: string | undefined
          if (isPast) {
            circleBg = currColors.border
            circleBorder = currColors.border
            circleColor = '#fff'
          } else if (isCurrent) {
            circleBg = colors.bg
            circleBorder = colors.border
            circleColor = colors.border
            boxShadow = `0 0 0 4px color-mix(in srgb, ${colors.border} 22%, transparent)`
          }

          const labelColor = isCurrent ? colors.text : isPast ? 'var(--text-secondary)' : 'var(--text-muted)'
          const clickable = !disabled && !isCurrent && !isPending

          return (
            <li key={stage} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 0, position: 'relative' }}>
              {/* Connector from the previous step. Thicker and rounded so the
                  filled part reads as progress, not a hairline. */}
              {i > 0 && (
                <div aria-hidden style={{
                  position: 'absolute',
                  top: 12,
                  left: 'calc(-50% + 14px)',
                  width: 'calc(100% - 28px)',
                  height: 3,
                  borderRadius: 2,
                  background: i <= optimisticIndex ? currColors.border : 'var(--border-strong)',
                  transition: 'background 0.2s',
                  zIndex: 0,
                }} />
              )}
              <button
                type="button"
                className="stage-step"
                onClick={() => moveTo(stage)}
                disabled={!clickable}
                aria-current={isCurrent ? 'step' : undefined}
                aria-label={isCurrent ? `${STAGE_LABELS[stage]} (current)` : `Move to ${STAGE_LABELS[stage]}`}
                title={isCurrent ? 'Current stage' : clickable ? `Move to ${STAGE_LABELS[stage]}` : undefined}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  background: circleBg,
                  border: `2px solid ${circleBorder}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: circleColor,
                  fontSize: 11, fontWeight: 700,
                  position: 'relative',
                  zIndex: 1,
                  boxShadow,
                  padding: 0,
                  cursor: clickable ? 'pointer' : 'default',
                  transition: 'transform 0.12s, box-shadow 0.12s, background 0.2s',
                }}
              >
                {isPast ? '✓' : isCurrent ? <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'currentColor', display: 'block' }} /> : null}
              </button>
              <span style={{
                marginTop: 10,
                fontSize: 11,
                lineHeight: 1.25,
                textAlign: 'center',
                color: labelColor,
                fontWeight: isCurrent ? 700 : 500,
                padding: '0 4px',
              }}>
                {STAGE_LABELS[stage]}
              </span>
            </li>
          )
        })}
      </ol>

      {!disabled && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 20, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Or click any step to jump straight to it.
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button
              onClick={() => prevStage && moveTo(prevStage)}
              disabled={!prevStage || isPending}
              className="btn-secondary btn-sm"
              title={prevStage ? `Back to ${STAGE_LABELS[prevStage]}` : undefined}
            >
              ← Back
            </button>
            <button
              onClick={() => nextStage && moveTo(nextStage)}
              disabled={!nextStage || isPending}
              className="btn-primary btn-sm"
            >
              {nextStage ? `Advance to ${STAGE_LABELS[nextStage]} →` : 'Live ✓'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
