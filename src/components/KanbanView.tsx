'use client'

import { memo, useCallback, useState, useEffect, useDeferredValue, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  DndContext, DragOverlay,
  PointerSensor, TouchSensor,
  useSensor, useSensors,
  useDroppable,
  type DragStartEvent, type DragOverEvent, type DragEndEvent,
} from '@dnd-kit/core'
import { STAGE_ORDER, STAGE_LABELS, profileName, type Stage, type Project, type Profile } from '@/lib/types'
import { updateProjectStagesBoth } from '@/lib/actions'
import { isProjectOverdue, phaseDueTone, STAGE_COLORS, STAGE_DUE_FIELD } from '@/lib/stageColors'
import KanbanCard from './KanbanCard'

type PipelineProject = Project & { brands: { id: string; name: string } }
type StatusFilter = 'all' | 'overdue' | 'in_review'
// A profile id, or one of the two sentinels. Was a hardcoded union of designer
// names; now driven by the profiles roster.
type EditorFilter = 'all' | 'unassigned' | (string & {})

function isEditedBy(p: PipelineProject, profileId: string): boolean {
  return p.lp_editor_id === profileId || p.creative_editor_id === profileId
}

function cardColumn(p: PipelineProject): Stage {
  const lpIdx = STAGE_ORDER.indexOf(p.lp_stage)
  const crIdx = STAGE_ORDER.indexOf(p.creatives_stage)
  return STAGE_ORDER[Math.min(lpIdx, crIdx)]
}

function isWaitingOnClient(p: PipelineProject): boolean {
  return (
    (p.lp_stage === 'client_review' && !p.lp_approved) ||
    (p.creatives_stage === 'client_review' && !p.creatives_approved)
  )
}

export default function KanbanView({
  pipeline,
  editors,
  currentProfileId,
}: {
  pipeline: PipelineProject[]
  /** Anyone flagged for either track — the people who can appear on a card. */
  editors: Profile[]
  /** The signed-in user's profile id, or null if they have no profile row. */
  currentProfileId: string | null
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  const [localProjects, setLocalProjects] = useState(pipeline)
  useEffect(() => setLocalProjects(pipeline), [pipeline])

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [filterWaiting, setFilterWaiting] = useState(false)
  const [editor, setEditor] = useState<EditorFilter>('all')
  const [mineOnly, setMineOnly] = useState(false)
  const deferredSearch = useDeferredValue(search)

  const myCount = useMemo(
    () => (currentProfileId ? localProjects.filter(p => isEditedBy(p, currentProfileId)).length : 0),
    [localProjects, currentProfileId]
  )

  // Memoized so KanbanCard's memo() holds: a Map built inline would be a new
  // reference on every render and re-render every card on the board.
  const editorsById = useMemo(() => new Map(editors.map(p => [p.id, p])), [editors])

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
    return localProjects.filter(p => {
      if (q && !p.brands.name.toLowerCase().includes(q)) return false
      if (status === 'overdue' && !isProjectOverdue(p.due_date, p.is_complete, p.lp_stage, p.creatives_stage)) return false
      if (status === 'in_review' && !(p.lp_stage === 'client_review' || p.creatives_stage === 'client_review')) return false
      if (filterWaiting && !isWaitingOnClient(p)) return false
      if (mineOnly && (!currentProfileId || !isEditedBy(p, currentProfileId))) return false
      if (editor === 'unassigned' && (p.lp_editor_id || p.creative_editor_id)) return false
      if (editor !== 'all' && editor !== 'unassigned' && !isEditedBy(p, editor)) return false
      return true
    })
  }, [localProjects, deferredSearch, status, filterWaiting, editor, mineOnly, currentProfileId])

  const columns = useMemo(
    () => STAGE_ORDER.map(stage => ({
      stage,
      cards: displayed.filter(p => cardColumn(p) === stage),
    })),
    [displayed]
  )

  const activeCard = activeId ? localProjects.find(p => p.id === activeId) ?? null : null

  // Shared by mouse/touch drag-drop (handleDragEnd) and the keyboard-operable
  // move buttons on each card (KanbanCard's prev/next stage fallback), so both
  // input methods move a card the same way.
  const moveCard = useCallback((card: PipelineProject, targetStage: Stage) => {
    if (cardColumn(card) === targetStage) return
    const snapshot = [...localProjects]
    setLocalProjects(prev => prev.map(p =>
      p.id === card.id
        ? { ...p, lp_stage: targetStage, creatives_stage: targetStage }
        : p
    ))
    startTransition(async () => {
      try {
        await updateProjectStagesBoth(card.id, card.brands.id, targetStage)
        router.refresh()
      } catch {
        setLocalProjects(snapshot)
      }
    })
  }, [localProjects, router, startTransition])

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
    moveCard(card, targetStage)
  }

  const pillBase: React.CSSProperties = {
    padding: 'var(--space-2) var(--space-3)', borderRadius: 20, fontSize: 'var(--text-sm)',
    cursor: 'pointer', transition: 'all 0.15s', border: '1px solid',
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', marginBottom: 'var(--space-4)', flexWrap: 'wrap', flexShrink: 0 }}>
        <input
          type="text"
          placeholder="Search by brand…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: 190, fontSize: 'var(--text-base)' }}
        />

        <div style={{ display: 'flex', gap: 4 }}>
          {(['all', 'overdue', 'in_review'] as const).map(opt => {
            const active = status === opt
            const labels = { all: 'All', overdue: 'Overdue', in_review: 'In Review' }
            return (
              <button
                key={opt}
                onClick={() => setStatus(opt)}
                className="focus-ring-pill"
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

        {/* Only offer "My work" to someone who has a profile and is actually on
            something — otherwise it's a button that always yields an empty board. */}
        {currentProfileId && myCount > 0 && (
          <button
            onClick={() => setMineOnly(v => !v)}
            className="focus-ring-pill"
            aria-pressed={mineOnly}
            style={{
              ...pillBase,
              fontWeight: mineOnly ? 600 : 400,
              borderColor: mineOnly ? 'var(--accent)' : 'var(--border)',
              background: mineOnly ? 'var(--accent-muted)' : 'transparent',
              color: mineOnly ? 'var(--accent)' : 'var(--text-muted)',
            }}
          >
            My work ({myCount})
          </button>
        )}

        <select
          value={editor}
          onChange={e => setEditor(e.target.value)}
          aria-label="Filter by editor"
          style={{
            fontSize: 'var(--text-sm)',
            padding: 'var(--space-2) var(--space-3)',
            borderRadius: 20,
            border: `1px solid ${editor === 'all' ? 'var(--border)' : 'var(--editor-creative)'}`,
            background: editor === 'all' ? 'transparent' : 'color-mix(in srgb, var(--editor-creative) 10%, transparent)',
            color: editor === 'all' ? 'var(--text-muted)' : 'var(--editor-creative)',
            fontWeight: editor === 'all' ? 400 : 600,
            cursor: 'pointer',
          }}
        >
          <option value="all">All editors</option>
          <option value="unassigned">Unassigned</option>
          {editors.map(p => (
            <option key={p.id} value={p.id}>{profileName(p)}</option>
          ))}
        </select>

        <button
          onClick={() => setFilterWaiting(!filterWaiting)}
          className="focus-ring-pill"
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

      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 'var(--space-4)', flexShrink: 0 }}>
        <h2 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
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
          <div className="kanban-board" style={{
            display: 'grid',
            // Derived from STAGE_ORDER so adding a stage never leaves an orphan
            // column wrapping to a second row.
            gridTemplateColumns: `repeat(${STAGE_ORDER.length}, minmax(260px, 1fr))`,
            gridTemplateRows: 'minmax(0, 1fr)',
            gap: 12,
            height: '100%',
            overflowX: 'auto',
            overflowY: 'hidden',
          }}>
            {columns.map(({ stage, cards }) => (
              <KanbanColumn
                key={stage}
                stage={stage}
                cards={cards}
                isOver={overId === stage}
                isDragging={activeId !== null}
                draggedCardId={activeId}
                onMove={moveCard}
                editorsById={editorsById}
              />
            ))}
          </div>

          <DragOverlay dropAnimation={null}>
            {activeCard ? (
              <div style={{ transform: 'rotate(1.5deg)', filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.5))' }}>
                <KanbanCard p={activeCard} isGhost editorsById={editorsById} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    </section>
  )
}

// Memoized so that a pointer-driven `overId` change on the parent only
// re-renders the columns whose `isOver` actually flipped (the leaving column
// and the entering one), instead of all six on every mousemove.
const KanbanColumn = memo(KanbanColumnInner)

function KanbanColumnInner({
  stage,
  cards,
  isOver,
  isDragging,
  draggedCardId,
  onMove,
  editorsById,
}: {
  stage: Stage
  cards: PipelineProject[]
  isOver: boolean
  isDragging: boolean
  draggedCardId: string | null
  onMove: (card: PipelineProject, targetStage: Stage) => void
  editorsById: Map<string, Profile>
}) {
  const color = STAGE_COLORS[stage]
  const { setNodeRef } = useDroppable({ id: stage })

  // How many cards in this column are past this stage's own target date — the
  // "should have left by now" count, distinct from the go-live overdue state.
  const dueField = STAGE_DUE_FIELD[stage]
  const overdueCount = dueField
    ? cards.filter(c => phaseDueTone(c[dueField as keyof PipelineProject] as string | null) === 'overdue').length
    : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, height: '100%' }}>
      {/* Column header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '9px 14px', marginBottom: 10,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderTop: `2px solid ${color.border}`,
        borderRadius: 8,
        flexShrink: 0,
        position: 'sticky',
        top: 0,
        zIndex: 2,
      }}>
        <span style={{
          fontSize: 'var(--text-xs)', fontWeight: 700, color: color.text,
          textTransform: 'uppercase', letterSpacing: '0.08em',
        }}>
          {STAGE_LABELS[stage]}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {overdueCount > 0 && (
            <span
              title={`${overdueCount} past this stage's target date`}
              style={{
                fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--danger)',
                background: 'rgba(239,68,68,0.12)',
                borderRadius: 12, padding: '1px 8px',
              }}
            >
              {overdueCount} overdue
            </span>
          )}
          <span style={{
            fontSize: 'var(--text-xs)', fontWeight: 700, color: color.text,
            background: color.bg,
            borderRadius: 12, padding: '1px 8px',
          }}>
            {cards.length}
          </span>
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
            .map(p => (
              <div key={p.id} style={{ flexShrink: 0 }}>
                <KanbanCard p={p} columnStage={stage} onMove={onMove} editorsById={editorsById} />
              </div>
            ))
        )}
      </div>
    </div>
  )
}
