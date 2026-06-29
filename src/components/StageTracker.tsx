'use client'

import { useOptimistic, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateProjectStage } from '@/lib/actions'
import { STAGE_ORDER, STAGE_LABELS, type Stage } from '@/lib/types'

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
  const [optimisticStage, setOptimisticStage] = useOptimistic(
    currentStage,
    (_current: Stage, newStage: Stage) => newStage
  )
  const optimisticIndex = STAGE_ORDER.indexOf(optimisticStage)

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
      borderRadius: 10,
      padding: '16px 20px',
      opacity: isPending ? 0.7 : 1,
      transition: 'opacity 0.15s',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {label}
        </span>
        <span className={`badge badge-${optimisticStage}`}>
          {STAGE_LABELS[optimisticStage]}
        </span>
      </div>

      {/* Progress bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
        {STAGE_ORDER.map((stage, i) => (
          <div
            key={stage}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              background: i <= optimisticIndex
                ? (optimisticStage === 'done' ? 'var(--success)' : 'var(--accent)')
                : 'var(--border)',
              transition: 'background 0.2s ease',
            }}
          />
        ))}
      </div>

      {/* Step labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        {STAGE_ORDER.map((stage, i) => (
          <span key={stage} style={{
            fontSize: 10,
            color: i <= optimisticIndex ? 'var(--text-secondary)' : 'var(--text-muted)',
            fontWeight: i === optimisticIndex ? 600 : 400,
          }}>
            {STAGE_LABELS[stage]}
          </span>
        ))}
      </div>

      {!disabled && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={retreat}
            disabled={optimisticIndex === 0 || isPending}
            className="btn-secondary"
            style={{ flex: 1, justifyContent: 'center', padding: '8px 12px', fontSize: 13 }}
          >
            ← Back
          </button>
          <button
            onClick={advance}
            disabled={optimisticIndex === STAGE_ORDER.length - 1 || isPending}
            className="btn-primary"
            style={{ flex: 2, justifyContent: 'center', padding: '8px 12px', fontSize: 13 }}
          >
            {optimisticStage === 'live' ? 'Mark Done ✓' : 'Advance →'}
          </button>
        </div>
      )}
    </div>
  )
}
