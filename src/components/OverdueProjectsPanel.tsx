import Link from 'next/link'
import type { Project } from '@/lib/types'
import { calcDaysUntil, isProjectOverdue } from '@/lib/stageColors'

interface OverdueProjectsPanelProps {
  projects: (Project & { brand_name: string })[]
}

export default function OverdueProjectsPanel({ projects }: OverdueProjectsPanelProps) {
  const overdueRows = projects
    .filter(p => isProjectOverdue(p.due_date, p.is_complete, p.lp_stage, p.creatives_stage))
    .map(p => ({ p, days: calcDaysUntil(p.due_date) }))
    .sort((a, b) => (a.days ?? 0) - (b.days ?? 0))

  return (
    <div style={{
      background: 'var(--surface-1)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      display: 'flex',
      flexDirection: 'column',
      maxHeight: 460,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '14px 18px',
        borderBottom: '1px solid var(--border)',
      }}>
        <span style={{
          fontSize: 12, fontWeight: 700,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}>
          Overdue
        </span>
        <span style={{
          fontSize: 11, fontWeight: 700,
          color: overdueRows.length > 0 ? 'var(--urgent-overdue)' : 'var(--stage-done-text)',
          background: overdueRows.length > 0 ? 'var(--urgent-overdue-bg)' : 'var(--stage-done-bg)',
          border: `1px solid color-mix(in srgb, ${overdueRows.length > 0 ? '#EF4444' : '#10B981'} 30%, transparent)`,
          padding: '1px 8px',
          borderRadius: 20,
        }}>
          {overdueRows.length}
        </span>
      </div>

      <div style={{
        overflowY: 'auto',
        flex: 1,
      }}>
        {overdueRows.length === 0 ? (
          <div style={{
            padding: '28px 20px',
            textAlign: 'center',
            fontSize: 13,
            color: 'var(--stage-done-text)',
            fontWeight: 600,
          }}>
            ✓ All on track
          </div>
        ) : (
          overdueRows.map(({ p, days }, i) => {
            const absDays = Math.abs(days ?? 0)
            return (
              <Link
                key={p.id}
                href={`/brands/${p.brand_id}/projects/${p.id}`}
                style={{ textDecoration: 'none', display: 'block' }}
              >
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: 10,
                  alignItems: 'center',
                  padding: '10px 18px',
                  borderBottom: i < overdueRows.length - 1 ? '1px solid var(--border)' : 'none',
                  transition: 'background 0.12s',
                }}
                className="overdue-row"
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      fontSize: 10.5,
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.07em',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      marginBottom: 2,
                    }}>
                      {p.brand_name}
                    </div>
                    <div style={{
                      fontSize: 13, fontWeight: 500, color: 'var(--text-primary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {p.name}
                    </div>
                  </div>
                  <span style={{
                    fontSize: 10.5, fontWeight: 600,
                    color: 'var(--urgent-overdue)',
                    background: 'var(--urgent-overdue-bg)',
                    border: '1px solid color-mix(in srgb, #EF4444 30%, transparent)',
                    padding: '2px 8px',
                    borderRadius: 20,
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}>
                    {absDays} day{absDays === 1 ? '' : 's'} late
                  </span>
                </div>
              </Link>
            )
          })
        )}
      </div>
    </div>
  )
}
