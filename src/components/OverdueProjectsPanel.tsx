import Link from 'next/link'
import type { Project } from '@/lib/types'
import { calcDaysUntil, isProjectOverdue } from '@/lib/stageColors'

interface OverdueProjectsPanelProps {
  projects: (Project & { brand_name: string })[]
}

/**
 * Sibling to <PipelineTable> on the dashboard. Structure intentionally mirrors
 * PipelineTable so the two data cards line up top-to-top when placed
 * side-by-side in the dashboard grid:
 *
 *   [filter-bar spacer]  ← reserves the height of PipelineTable's filter row
 *   [section h2]         ← "Overdue — N project(s)"
 *   [table card: header row, then one row per overdue project]
 */
export default function OverdueProjectsPanel({ projects }: OverdueProjectsPanelProps) {
  const overdueRows = projects
    .filter(p => isProjectOverdue(p.due_date, p.is_complete, p.lp_stage, p.creatives_stage))
    .map(p => ({ p, days: calcDaysUntil(p.due_date) }))
    .sort((a, b) => (a.days ?? 0) - (b.days ?? 0))

  const cols = '1fr 90px'

  return (
    <section>
      {/* Spacer to align with PipelineTable's filter bar (input+pills+button). */}
      <div style={{ minHeight: 34, marginBottom: 16 }} aria-hidden />

      {/* Subtitle — mirrors "Active Pipeline — N projects" */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <h2 style={{
          fontSize: 12, fontWeight: 600,
          color: 'var(--text-muted)',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}>
          Overdue — {overdueRows.length} project{overdueRows.length === 1 ? '' : 's'}
        </h2>
      </div>

      {overdueRows.length === 0 ? (
        <div style={{
          padding: '32px',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          color: 'var(--complete-text)',
          fontSize: 14,
          fontWeight: 600,
          textAlign: 'center',
        }}>
          ✓ All on track
        </div>
      ) : (
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          overflow: 'hidden',
        }}>
          {/* Column headers — match PipelineTable's header row proportions */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: cols,
            gap: 16,
            padding: '10px 20px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface-raised)',
          }}>
            {['Project', 'Late by'].map(col => (
              <span key={col} style={{
                fontSize: 10, fontWeight: 600,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.07em',
              }}>
                {col}
              </span>
            ))}
          </div>

          {overdueRows.map(({ p, days }, i) => {
            const absDays = Math.abs(days ?? 0)
            return (
              <Link
                key={p.id}
                href={`/brands/${p.brand_id}/projects/${p.id}`}
                style={{ textDecoration: 'none', display: 'block' }}
              >
                <div
                  className="pipeline-row"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: cols,
                    gap: 16,
                    padding: '14px 20px',
                    borderBottom: i < overdueRows.length - 1 ? '1px solid var(--border)' : 'none',
                    alignItems: 'center',
                  }}
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
                      fontSize: 14,
                      fontWeight: 600,
                      color: 'var(--text-primary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {p.name}
                    </div>
                  </div>
                  <span style={{
                    fontSize: 11, fontWeight: 600,
                    color: 'var(--urgent-overdue)',
                    background: 'var(--urgent-overdue-bg)',
                    border: '1px solid color-mix(in srgb, #EF4444 30%, transparent)',
                    padding: '3px 8px',
                    borderRadius: 20,
                    whiteSpace: 'nowrap',
                    justifySelf: 'start',
                  }}>
                    ⚠ {absDays}d
                  </span>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </section>
  )
}
