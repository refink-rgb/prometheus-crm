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
  const trackColor = STAGE_COLORS[optimisticStage]

  function advance() {
    if (disabled || optimisticIndex >= STAGE_ORDER.length - 1) return
    const next = STAGE_ORDER[optimisticIndex + 1]
    startTransition(async () => {
      setOptimisticStage(next)
      await updateProjectStage(projectId, brandId, track, next)
      router.refresh()
    })
  }

  function retreat() {
    if (disabled || optimisticIndex <= 0) return
    const prev = STAGE_ORDER[optimisticIndex - 1]
    startTransition(async () => {
      setOptimisticStage(prev)
      await updateProjectStage(projectId, brandId, track, prev)
      router.refresh()
    })
  }

  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: '18px 22px',
      opacity: isPending ? 0.75 : 1,
      transition: 'opacity 0.15s',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.09em',
          color: trackColor.text,
          background: trackColor.bg,
          border: `1px solid color-mix(in srgb, ${trackColor.border} 30%, transparent)`,
          padding: '3px 9px',
          borderRadius: 6,
          flexShrink: 0,
        }}>
          {trackTag}
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '0.02em' }}>
          {label}
        </span>
        <div style={{ flex: 1 }} />
        {disabled && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            🔒 Locked
          </span>
        )}
      </div>

      {/* Stepper */}
      <div style={{ display: 'flex', alignItems: 'flex-start', width: '100%' }}>
        {STAGE_ORDER.map((stage, i) => {
          const isPast    = i < optimisticIndex
          const isCurrent = i === optimisticIndex
          const isFuture  = i > optimisticIndex
          const colors    = STAGE_COLORS[stage]
          const currColors = STAGE_COLORS[optimisticStage]

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
            circleColor = colors.text
            boxShadow = `0 0 0 3px ${colors.bg}`
          }

          const labelColor = isCurrent
            ? colors.text
            : isPast ? 'var(--text-secondary)' : 'var(--text-muted)'
          const labelWeight = isCurrent ? 700 : 500

          return (
            <div key={stage} style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              minWidth: 0,
              position: 'relative',
            }}>
              {/* Connecting line — spans left half + right half, drawn absolute */}
              {i > 0 && (
                <div style={{
                  position: 'absolute',
                  top: 10,
                  left: '-50%',
                  width: '100%',
                  height: 2,
                  background: i <= optimisticIndex
                    ? currColors.border
                    : 'var(--border-strong)',
                  transition: 'background 0.2s',
                  zIndex: 0,
                }} />
              )}
              <div style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: circleBg,
                border: `2px solid ${circleBorder}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: circleColor,
                fontSize: 10, fontWeight: 700,
                position: 'relative',
                zIndex: 1,
                boxShadow,
                transition: 'all 0.2s',
              }}>
                {isPast ? '✓' : isCurrent ? '' : ''}
              </div>
              <span style={{
                marginTop: 8,
                fontSize: 9.5,
                lineHeight: 1.2,
                textAlign: 'center',
                color: labelColor,
                fontWeight: labelWeight,
                letterSpacing: '0.01em',
                padding: '0 2px',
                zIndex: 1,
              }}>
                {STAGE_LABELS[stage]}
              </span>
              {isFuture && null}
            </div>
          )
        })}
      </div>

      {!disabled && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button
            onClick={retreat}
            disabled={optimisticIndex === 0 || isPending}
            className="btn-secondary"
            style={{ padding: '6px 12px', fontSize: 12 }}
          >
            ← Back
          </button>
          <button
            onClick={advance}
            disabled={optimisticIndex === STAGE_ORDER.length - 1 || isPending}
            className="btn-primary"
            style={{ padding: '6px 14px', fontSize: 12 }}
          >
            {optimisticStage === 'live' ? 'Mark Done ✓' : 'Advance →'}
          </button>
        </div>
      )}
    </div>
  )
}
