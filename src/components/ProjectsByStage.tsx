import type { Stage } from '@/lib/types'
import { STAGE_LABELS } from '@/lib/types'

interface Props {
  lpCounts: Record<Stage, number>
  crCounts: Record<Stage, number>
}

const STAGES: Stage[] = ['brief', 'in_progress', 'review', 'done']

const STAGE_COLORS: Record<Stage, string> = {
  brief: 'var(--text-muted)',
  in_progress: 'var(--accent)',
  review: 'var(--warning)',
  done: 'var(--success)',
}

export default function ProjectsByStage({ lpCounts, crCounts }: Props) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 32 }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 90px 90px',
        padding: '8px 20px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface-raised)',
      }}>
        {['Stage', 'LP', 'Creatives'].map(col => (
          <span key={col} style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            {col}
          </span>
        ))}
      </div>
      {STAGES.map((stage, i) => (
        <div key={stage} style={{
          display: 'grid',
          gridTemplateColumns: '1fr 90px 90px',
          padding: '12px 20px',
          borderBottom: i < STAGES.length - 1 ? '1px solid var(--border)' : 'none',
          alignItems: 'center',
        }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: STAGE_COLORS[stage] }}>
            {STAGE_LABELS[stage]}
          </span>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
            {lpCounts[stage]}
          </span>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
            {crCounts[stage]}
          </span>
        </div>
      ))}
    </div>
  )
}
