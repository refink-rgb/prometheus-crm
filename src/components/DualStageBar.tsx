import StagePill from './StagePill'
import type { Stage } from '@/lib/stageColors'

interface DualStageBarProps {
  lp_stage: Stage | null
  creatives_stage: Stage | null
  lp_approved?: boolean
  creatives_approved?: boolean
}

export default function DualStageBar({
  lp_stage,
  creatives_stage,
  lp_approved,
  creatives_approved,
}: DualStageBarProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <Row label="LP"        stage={lp_stage}        approved={!!lp_approved} />
      <Row label="Creatives" stage={creatives_stage} approved={!!creatives_approved} />
    </div>
  )
}

function Row({ label, stage, approved }: { label: string; stage: Stage | null; approved: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 22 }}>
      <span style={{
        width: 90,
        flexShrink: 0,
        fontSize: 10.5,
        fontWeight: 500,
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
      }}>
        {label}
      </span>
      {stage ? <StagePill stage={stage} size="sm" /> : (
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>—</span>
      )}
      {approved && (
        <span
          aria-label="approved by client"
          title="Approved by client"
          style={{ fontSize: 12, color: 'var(--client-approved)', fontWeight: 700 }}
        >
          ✓
        </span>
      )}
    </div>
  )
}
