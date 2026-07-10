'use client'

import { useState, useDeferredValue, useMemo } from 'react'
import Link from 'next/link'
import type { Project, Stage } from '@/lib/types'
import { STAGE_LABELS } from '@/lib/types'
import { isProjectOverdue, parseAndDaysUntil } from '@/lib/stageColors'

type PipelineProject = Project & { brands: { id: string; name: string } }

const STAGES: Stage[] = ['brief', 'in_progress', 'internal_review', 'client_review', 'live', 'done']

const STAGE_COLORS: Record<Stage, string> = {
  brief:           'var(--text-muted)',
  in_progress:     'var(--accent)',
  internal_review: '#a855f7',
  client_review:   'var(--warning)',
  live:            '#14b8a6',
  done:            'var(--success)',
}

function isWaitingOnClient(p: PipelineProject): boolean {
  return (
    (p.lp_stage === 'client_review' && !p.lp_approved) ||
    (p.creatives_stage === 'client_review' && !p.creatives_approved)
  )
}

type StatusFilter = 'all' | 'overdue' | 'in_review'

export default function PipelineTable({ pipeline }: { pipeline: PipelineProject[] }) {
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
    return pipeline.filter(p => {
      if (q && !p.brands.name.toLowerCase().includes(q)) return false
      if (status === 'overdue' && !isProjectOverdue(p.due_date, p.is_complete, p.lp_stage, p.creatives_stage)) return false
      if (status === 'in_review' && !(p.lp_stage === 'client_review' || p.creatives_stage === 'client_review')) return false
      if (filterWaiting && !isWaitingOnClient(p)) return false
      return true
    })
  }, [pipeline, deferredSearch, status, filterWaiting])

  const pillBase = {
    padding: '5px 12px', borderRadius: 20, fontSize: 12,
    cursor: 'pointer', transition: 'all 0.15s', border: '1px solid',
  }

  return (
    <section>
      {/* Filter bar */}
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

      {displayed.length === 0 ? (
        <div style={{ padding: '32px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--text-muted)', fontSize: 14, textAlign: 'center' }}>
          {pipeline.length === 0
            ? 'No active projects yet.'
            : 'No projects match your current filters.'}
        </div>
      ) : (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr 88px 150px 150px', gap: 16, padding: '10px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface-raised)' }}>
            {['Brand', 'Project', 'Due', 'Landing Page', 'Creatives'].map(col => (
              <span key={col} style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{col}</span>
            ))}
          </div>
          {displayed.map((p, i) => (
            <Link key={p.id} href={`/brands/${p.brands.id}/projects/${p.id}`} style={{ textDecoration: 'none', display: 'block' }}>
              <div className="pipeline-row" style={{
                display: 'grid',
                gridTemplateColumns: '150px 1fr 88px 150px 150px',
                gap: 16,
                padding: '14px 20px',
                borderBottom: i < displayed.length - 1 ? '1px solid var(--border)' : 'none',
                alignItems: 'center',
              }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.brands.name}
                </span>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.name}
                </span>
                <DueBadge
                  dueDate={p.due_date}
                  isOverdue={isProjectOverdue(p.due_date, p.is_complete, p.lp_stage, p.creatives_stage)}
                />
                <TrackProgress stage={p.lp_stage} approved={p.lp_approved} />
                <TrackProgress stage={p.creatives_stage} approved={p.creatives_approved} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}

function DueBadge({ dueDate, isOverdue }: { dueDate: string | null; isOverdue: boolean }) {
  const { due, daysUntil } = parseAndDaysUntil(dueDate)
  if (!due || daysUntil === null) return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
  const isUrgent = !isOverdue && daysUntil >= 0 && daysUntil <= 7
  const color = isOverdue ? 'var(--danger)' : isUrgent ? 'var(--warning)' : 'var(--text-muted)'
  const dueStr = due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return (
    <span style={{
      fontSize: 12, fontWeight: isOverdue || isUrgent ? 600 : 400, color,
      background: isOverdue ? 'rgba(239,68,68,0.1)' : isUrgent ? 'rgba(234,179,8,0.1)' : 'transparent',
      padding: isOverdue || isUrgent ? '2px 6px' : '0', borderRadius: 4, whiteSpace: 'nowrap',
    }}>
      {isOverdue ? '⚠ ' : ''}{dueStr}
    </span>
  )
}

function TrackProgress({ stage, approved }: { stage: Stage; approved: boolean }) {
  const idx = STAGES.indexOf(stage)
  const waitingReview = stage === 'client_review' && !approved
  return (
    <div style={{ minWidth: 90 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: STAGE_COLORS[stage], letterSpacing: '0.04em' }}>
          {STAGE_LABELS[stage]}
        </span>
        {waitingReview && (
          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--warning)', background: 'rgba(234,179,8,0.15)', border: '1px solid rgba(234,179,8,0.3)', borderRadius: 4, padding: '1px 4px', letterSpacing: '0.04em' }}>
            PENDING
          </span>
        )}
        {stage === 'client_review' && approved && (
          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--success)', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 4, padding: '1px 4px' }}>
            ✓
          </span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 3 }}>
        {STAGES.map((s, i) => {
          const bg = i < idx ? 'var(--success)' : i === idx ? STAGE_COLORS[stage] : 'var(--border)'
          return <div key={s} style={{ width: 14, height: 5, borderRadius: 3, background: bg, transition: 'background 0.2s' }} />
        })}
      </div>
    </div>
  )
}
