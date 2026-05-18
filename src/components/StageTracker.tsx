'use client'

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
  const currentIndex = STAGE_ORDER.indexOf(currentStage)

  async function advance() {
    if (disabled || currentIndex >= STAGE_ORDER.length - 1) return
    await updateProjectStage(projectId, brandId, track, STAGE_ORDER[currentIndex + 1])
  }

  async function retreat() {
    if (disabled || currentIndex <= 0) return
    await updateProjectStage(projectId, brandId, track, STAGE_ORDER[currentIndex - 1])
  }

  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: '16px 20px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {label}
        </span>
        <span className={`badge badge-${currentStage}`}>
          {STAGE_LABELS[currentStage]}
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
              background: i <= currentIndex
                ? (currentStage === 'done' ? 'var(--success)' : 'var(--accent)')
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
            color: i <= currentIndex ? 'var(--text-secondary)' : 'var(--text-muted)',
            fontWeight: i === currentIndex ? 600 : 400,
          }}>
            {STAGE_LABELS[stage]}
          </span>
        ))}
      </div>

      {!disabled && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={retreat}
            disabled={currentIndex === 0}
            className="btn-secondary"
            style={{ flex: 1, justifyContent: 'center', padding: '8px 12px', fontSize: 13 }}
          >
            ← Back
          </button>
          <button
            onClick={advance}
            disabled={currentIndex === STAGE_ORDER.length - 1}
            className="btn-primary"
            style={{ flex: 2, justifyContent: 'center', padding: '8px 12px', fontSize: 13 }}
          >
            {currentStage === 'review' ? 'Mark Done ✓' : 'Advance →'}
          </button>
        </div>
      )}
    </div>
  )
}
