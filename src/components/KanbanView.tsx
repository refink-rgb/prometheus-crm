'use client'

import { useState, useDeferredValue, useMemo } from 'react'
import { STAGE_ORDER, STAGE_LABELS, type Stage, type Project } from '@/lib/types'
import KanbanCard from './KanbanCard'

type PipelineProject = Project & { brands: { id: string; name: string } }
type StatusFilter = 'all' | 'overdue' | 'in_review'

const STAGE_COLORS: Record<Stage, string> = {
  brief: 'var(--text-muted)',
  in_progress: 'var(--accent)',
  review: 'var(--warning)',
  done: 'var(--success)',
}

function cardColumn(p: PipelineProject): Stage {
  const lpIdx = STAGE_ORDER.indexOf(p.lp_stage)
  const crIdx = STAGE_ORDER.indexOf(p.creatives_stage)
  return STAGE_ORDER[Math.min(lpIdx, crIdx)]
}

function isWaitingOnClient(p: PipelineProject): boolean {
  return (
    (p.lp_stage === 'review' && !p.lp_approved) ||
    (p.creatives_stage === 'review' && !p.creatives_approved)
  )
}

export default function KanbanView({ pipeline }: { pipeline: PipelineProject[] }) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [filterWaiting, setFilterWaiting] = useState(false)
  const deferredSearch = useDeferredValue(search)

  const waitingCount = useMemo(
    () => pipeline.filter(isWaitingOnClient).length,
    [pipeline]
  )

  const displayed = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase()
    const now = Date.now()
    return pipeline.filter(p => {
      if (q && !p.brands.name.toLowerCase().includes(q)) return false
      if (status === 'overdue' && !(p.due_date && new Date(p.due_date).getTime() < now)) return false
      if (status === 'in_review' && !(p.lp_stage === 'review' || p.creatives_stage === 'review')) return false
      if (filterWaiting && !isWaitingOnClient(p)) return false
      return true
    })
  }, [pipeline, deferredSearch, status, filterWaiting])

  const pillBase: React.CSSProperties = {
    padding: '5px 12px', borderRadius: 20, fontSize: 12,
    cursor: 'pointer', transition: 'all 0.15s', border: '1px solid',
  }

  const columns = useMemo(
    () => STAGE_ORDER.map(stage => ({
      stage,
      cards: displayed.filter(p => cardColumn(p) === stage),
    })),
    [displayed]
  )

  return (
    <section>
      {/* Filter bar — mirrors PipelineTable */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Search by brand…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: 190, fontSize: 13 }}
        />

        <div style={{ display: 'flex', gap: 4 }}>
          {(['all', 'overdue', 'in_review'] as const).map(opt => {
            const active = status === opt
            const labels = { all: 'All', overdue: 'Overdue', in_review: 'In Review' }
            return (
              <button
                key={opt}
                onClick={() => setStatus(opt)}
                style={{
                  ...pillBase,
                  fontWeight: active ? 600 : 400,
                  borderColor: active ? 'var(--accent)' : 'var(--border)',
                  background: active ? 'var(--accent-muted)' : 'transparent',
                  color: active ? 'var(--accent)' : 'var(--text-muted)',
                }}
              >
                {labels[opt]}
              </button>
            )
          })}
        </div>

        <button
          onClick={() => setFilterWaiting(!filterWaiting)}
          style={{
            ...pillBase,
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontWeight: 600,
            borderColor: filterWaiting ? 'rgba(234,179,8,0.4)' : 'var(--border)',
            background: filterWaiting ? 'rgba(234,179,8,0.1)' : 'transparent',
            color: filterWaiting ? 'var(--warning)' : 'var(--text-muted)',
          }}
        >
          <span style={{ fontSize: 10 }}>⏳</span>
          Waiting on client
          {waitingCount > 0 && (
            <span style={{
              fontSize: 10, fontWeight: 700,
              background: filterWaiting ? 'rgba(234,179,8,0.2)' : 'var(--border)',
              color: filterWaiting ? 'var(--warning)' : 'var(--text-secondary)',
              borderRadius: 10, padding: '1px 6px',
            }}>
              {waitingCount}
            </span>
          )}
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Active Pipeline — {displayed.length}{displayed.length !== pipeline.length ? ` of ${pipeline.length}` : ''} project{displayed.length !== 1 ? 's' : ''}
        </h2>
      </div>

      {/* Board */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, minmax(220px, 1fr))',
        gap: 12,
        overflowX: 'auto',
        alignItems: 'start',
      }}>
        {columns.map(({ stage, cards }) => {
          const color = STAGE_COLORS[stage]
          return (
            <div key={stage} style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              {/* Column header */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '9px 14px', marginBottom: 10,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderTop: `2px solid ${color}`,
                borderRadius: 8,
                position: 'sticky', top: 0, zIndex: 1,
              }}>
                <span style={{
                  fontSize: 11, fontWeight: 700, color,
                  textTransform: 'uppercase', letterSpacing: '0.08em',
                }}>
                  {STAGE_LABELS[stage]}
                </span>
                <span style={{
                  fontSize: 11, fontWeight: 700, color,
                  background: `color-mix(in srgb, ${color} 15%, transparent)`,
                  borderRadius: 12, padding: '1px 8px',
                }}>
                  {cards.length}
                </span>
              </div>

              {/* Cards */}
              <div style={{
                display: 'flex', flexDirection: 'column', gap: 8,
                maxHeight: 'calc(100vh - 340px)',
                overflowY: 'auto',
                paddingBottom: 4,
              }}>
                {cards.length === 0 ? (
                  <div style={{
                    border: '1px dashed var(--border)', borderRadius: 10,
                    padding: '28px 12px', textAlign: 'center',
                    color: 'var(--text-muted)', fontSize: 12,
                  }}>
                    No projects
                  </div>
                ) : (
                  cards.map(p => <KanbanCard key={p.id} p={p} />)
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
