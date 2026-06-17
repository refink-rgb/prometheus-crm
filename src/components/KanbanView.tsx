'use client'

import { useState, useEffect, useDeferredValue, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  DndContext, DragOverlay,
  PointerSensor, TouchSensor,
  useSensor, useSensors,
  useDroppable,
  type DragStartEvent, type DragOverEvent, type DragEndEvent,
} from '@dnd-kit/core'
import { STAGE_ORDER, STAGE_LABELS, type Stage, type Project } from '@/lib/types'
import { updateProjectStage } from '@/lib/actions'
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
  const router = useRouter()
  const [, startTransition] = useTransition()

  const [localProjects, setLocalProjects] = useState(pipeline)
  useEffect(() => setLocalProjects(pipeline), [pipeline])

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [filterWaiting, setFilterWaiting] = useState(false)
  const deferredSearch = useDeferredValue(search)

  const [activeId, setActiveId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } })
  )

  const waitingCount = useMemo(
    () => localProjects.filter(isWaitingOnClient).length,
    [localProjects]
  )

  const displayed = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase()
    const now = Date.now()
    return localProjects.filter(p => {
      if (q && !p.brands.name.toLowerCase().includes(q)) return false
      if (status === 'overdue' && !(p.due_date && new Date(p.due_date).getTime() < now && !p.is_complete)) return false
      if (status === 'in_review' && !(p.lp_stage === 'review' || p.creatives_stage === 'review')) return false
      if (filterWaiting && !isWaitingOnClient(p)) return false
      return true
    })
  }, [localProjects, deferredSearch, status, filterWaiting])

  const columns = useMemo(
    () => STAGE_ORDER.map(stage => ({
      stage,
      cards: displayed.filter(p => cardColumn(p) === stage),
    })),
    [displayed]
  )

  const activeCard = activeId ? localProjects.find(p => p.id === activeId) ?? null : null

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string)
  }

  function handleDragOver(event: DragOverEvent) {
    setOverId(event.over?.id as string ?? null)
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveId(null)
    setOverId(null)

    if (!over) return
    const card = localProjects.find(p => p.id === active.id)
    if (!card) return
    const targetStage = over.id as Stage
    if (!STAGE_ORDER.includes(targetStage)) return
    if (cardColumn(card) === targetStage) return

    const snapshot = [...localProjects]
    setLocalProjects(prev => prev.map(p =>
      p.id === card.id
        ? { ...p, lp_stage: targetStage, creatives_stage: targetStage }
        : p
    ))

    startTransition(async () => {
      try {
        await Promise.all([
          updateProjectStage(card.id, card.brands.id, 'lp_stage', targetStage),
          updateProjectStage(card.id, card.brands.id, 'creatives_stage', targetStage),
        ])
        router.refresh()
      } catch {
        setLocalProjects(snapshot)
      }
    })
  }

  const pillBase: React.CSSProperties = {
    padding: '5px 12px', borderRadius: 20, fontSize: 12,
    cursor: 'pointer', transition: 'all 0.15s', border: '1px solid',
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 320px)' }}>
      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', flexShrink: 0 }}>
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

      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16, flexShrink: 0 }}>
        <h2 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Active Pipeline — {displayed.length}{displayed.length !== localProjects.length ? ` of ${localProjects.length}` : ''} project{displayed.length !== 1 ? 's' : ''}
        </h2>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          {/* Board */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(220px, 1fr))',
            gap: 12,
            height: '100%',
            overflowX: 'auto',
          }}>
            {columns.map(({ stage, cards }) => (
              <KanbanColumn
                key={stage}
                stage={stage}
                cards={cards}
                isOver={overId === stage}
                isDragging={activeId !== null}
                draggedCardId={activeId}
              />
            ))}
          </div>

          <DragOverlay dropAnimation={null}>
            {activeCard ? (
              <div style={{ transform: 'rotate(1.5deg)', filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.5))' }}>
                <KanbanCard p={activeCard} isGhost />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    </section>
  )
}

function KanbanColumn({
  stage,
  cards,
  isOver,
  isDragging,
  draggedCardId,
}: {
  stage: Stage
  cards: PipelineProject[]
  isOver: boolean
  isDragging: boolean
  draggedCardId: string | null
}) {
  const color = STAGE_COLORS[stage]
  const { setNodeRef } = useDroppable({ id: stage })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, height: '100%' }}>
      {/* Column header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '9px 14px', marginBottom: 10,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderTop: `2px solid ${color}`,
        borderRadius: 8,
        flexShrink: 0,
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

      {/* Cards drop zone */}
      <div
        ref={setNodeRef}
        style={{
          display: 'flex', flexDirection: 'column', gap: 8,
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          borderRadius: 8,
          background: isOver
            ? 'color-mix(in srgb, var(--accent) 4%, transparent)'
            : 'transparent',
          transition: 'background 0.15s',
          padding: isOver ? '6px' : '0 0 4px',
        }}
      >
        {/* Placeholder when dragging over this column */}
        {isOver && isDragging && (
          <div style={{
            height: 80,
            border: '2px dashed var(--accent)',
            borderRadius: 10,
            opacity: 0.5,
            flexShrink: 0,
          }} />
        )}

        {cards.length === 0 && !isOver ? (
          <div style={{
            border: '1px dashed var(--border)', borderRadius: 10,
            padding: '28px 12px', textAlign: 'center',
            color: 'var(--text-muted)', fontSize: 12,
          }}>
            No projects in {STAGE_LABELS[stage]}
          </div>
        ) : (
          cards
            .filter(p => p.id !== draggedCardId)
            .map(p => <KanbanCard key={p.id} p={p} />)
        )}
      </div>
    </div>
  )
}
