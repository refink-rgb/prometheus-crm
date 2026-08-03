import { STAGE_COLORS, STAGE_LABELS, normalizeStage, type Stage } from '@/lib/stageColors'

interface StagePillProps {
  stage: Stage
  track?: 'LP' | 'Creatives'
  size?: 'sm' | 'md'
  showCheck?: boolean
}

export default function StagePill({ stage, track, size = 'sm', showCheck = false }: StagePillProps) {
  // Rows written before the Done stage was retired can still carry 'done' until
  // the migration runs; normalize so an archived project's pill renders as Live
  // rather than blanking out on an undefined colour lookup.
  const safeStage = normalizeStage(stage)
  const colors = STAGE_COLORS[safeStage]
  const isMd = size === 'md'

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: isMd ? '4px 14px' : '3px 10px',
        borderRadius: 20,
        fontSize: isMd ? 12 : 11,
        fontWeight: 600,
        background: colors.bg,
        color: colors.text,
        border: `1px solid color-mix(in srgb, ${colors.border} 30%, transparent)`,
        whiteSpace: 'nowrap',
        letterSpacing: '0.01em',
        lineHeight: 1.2,
      }}
    >
      {track && (
        <span style={{ fontSize: 10, opacity: 0.7, fontWeight: 500 }}>
          {track} ·
        </span>
      )}
      {STAGE_LABELS[safeStage]}
      {showCheck && safeStage === 'live' && (
        <span aria-hidden style={{ marginLeft: 2 }}>✓</span>
      )}
    </span>
  )
}
