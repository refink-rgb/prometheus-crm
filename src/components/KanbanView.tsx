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
import { updateProjectStage, updateProjectStagesBoth } from '@/lib/actions'
import { isProjectOverdue, phaseDueTone, STAGE_COLORS, STAGE_DUE_FIELD } from '@/lib/stageColors'
import KanbanCard from './KanbanCard'
import CopyMarkdownButton from '@/components/CopyMarkdownButton'
import { pipelineMarkdown } from '@/lib/markdown-export'
import { Search, Hourglass, UserRound, X } from 'lucide-react'

type PipelineProject = Project & { brands: { id: string; name: string } }
type StatusFilter = 'all' | 'overdue' | 'in_review'
// Which track's stage a card is columned by. 'combined' keeps the historical
// behavior (the earliest of the two tracks); 'lp' / 'creatives' column by that
// track alone, so creative work in internal review shows in Internal Review
// even while the LP track is still in progress.
type TrackView = 'combined' | 'lp' | 'creatives'
// A profile id, or one of the two sentinels. Was a hardcoded union of designer
// names; now driven by the profiles roster.
type EditorFilter = 'all' | 'unassigned' | (string & {})

const FILTERS_KEY = 'prometheus-pipeline-filters'
type SavedFilters = {
  search: string
  trackView: TrackView
  status: StatusFilter
  filterWaiting: boolean
  editor: EditorFilter
  mineOnly: boolean
}

function isEditedBy(p: PipelineProject, profileId: string): boolean {
  return p.lp_editor_id === profileId || p.creative_editor_id === profileId
}

function cardColumn(p: PipelineProject, view: TrackView): Stage {
  if (view === 'lp') return p.lp_stage
  if (view === 'creatives') return p.creatives_stage
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
  const [trackView, setTrackView] = useState<TrackView>('combined')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [filterWaiting, setFilterWaiting] = useState(false)
  const [editor, setEditor] = useState<EditorFilter>('all')
  const [mineOnly, setMineOnly] = useState(false)
  const deferredSearch = useDeferredValue(search)

  // Filters survive a refresh. Kept in localStorage rather than the URL so a
  // shared project link never carries someone's board state. Hydrated in an
  // effect so the server render stays deterministic; nothing is written back
  // until that first read has happened, or the defaults would overwrite it.
  const [filtersReady, setFiltersReady] = useState(false)
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    try {
      const raw = localStorage.getItem(FILTERS_KEY)
      if (raw) {
        const saved = JSON.parse(raw) as Partial<SavedFilters>
        if (typeof saved.search === 'string') setSearch(saved.search)
        if (saved.trackView === 'combined' || saved.trackView === 'lp' || saved.trackView === 'creatives') setTrackView(saved.trackView)
        if (saved.status === 'all' || saved.status === 'overdue' || saved.status === 'in_review') setStatus(saved.status)
        if (typeof saved.filterWaiting === 'boolean') setFilterWaiting(saved.filterWaiting)
        if (typeof saved.mineOnly === 'boolean') setMineOnly(saved.mineOnly)
        // An editor who has since left the roster would filter to an empty board.
        if (typeof saved.editor === 'string' && (saved.editor === 'all' || saved.editor === 'unassigned' || editors.some(e => e.id === saved.editor))) setEditor(saved.editor)
      }
    } catch { /* private window or unreadable value — start clean */ }
    setFiltersReady(true)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [editors])
  useEffect(() => {
    if (!filtersReady) return
    const snapshot: SavedFilters = { search, trackView, status, filterWaiting, editor, mineOnly }
    try { localStorage.setItem(FILTERS_KEY, JSON.stringify(snapshot)) } catch { /* ignore */ }
  }, [filtersReady, search, trackView, status, filterWaiting, editor, mineOnly])

  const myCount = useMemo(
    () => (currentProfileId ? localProjects.filter(p => isEditedBy(p, currentProfileId)).length : 0),
    [localProjects, currentProfileId]
  )
  // "My work" is only offered to someone with a profile who is on something;
  // a restored mineOnly must not silently empty the board when it is hidden.
  const mineActive = mineOnly && !!currentProfileId && myCount > 0

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
      if (mineActive && !isEditedBy(p, currentProfileId!)) return false
      if (editor === 'unassigned' && (p.lp_editor_id || p.creative_editor_id)) return false
      if (editor !== 'all' && editor !== 'unassigned' && !isEditedBy(p, editor)) return false
      return true
    })
  }, [localProjects, deferredSearch, status, filterWaiting, editor, mineActive, currentProfileId])

  // Names the active filters in the exported header, so a pasted table is not
  // mistaken for the whole pipeline.
  function filterNote(): string | undefined {
    const parts: string[] = []
    if (deferredSearch.trim()) parts.push(`search "${deferredSearch.trim()}"`)
    if (status === 'overdue') parts.push('overdue only')
    if (status === 'in_review') parts.push('in client review')
    if (filterWaiting) parts.push('waiting on client')
    if (mineActive) parts.push('my projects')
    if (editor === 'unassigned') parts.push('unassigned')
    else if (editor !== 'all') {
      const e = editors.find(p => p.id === editor)
      parts.push(`editor ${e ? profileName(e) : editor}`)
    }
    if (trackView !== 'combined') parts.push(`${trackView === 'lp' ? 'landing page' : 'creatives'} track`)
    return parts.length ? `filtered: ${parts.join(', ')}` : undefined
  }

  const columns = useMemo(
    () => STAGE_ORDER.map(stage => ({
      stage,
      cards: displayed.filter(p => cardColumn(p, trackView) === stage),
    })),
    [displayed, trackView]
  )

  const activeCard = activeId ? localProjects.find(p => p.id === activeId) ?? null : null

  // Shared by mouse/touch drag-drop (handleDragEnd) and the keyboard-operable
  // move buttons on each card (KanbanCard's prev/next stage fallback), so both
  // input methods move a card the same way.
  const moveCard = useCallback((card: PipelineProject, targetStage: Stage) => {
    if (cardColumn(card, trackView) === targetStage) return
    const snapshot = [...localProjects]
    // In a single-track view, a drag advances only that track — the other
    // track's stage must not be dragged along with it.
    const patch: Partial<PipelineProject> =
      trackView === 'lp' ? { lp_stage: targetStage }
      : trackView === 'creatives' ? { creatives_stage: targetStage }
      : { lp_stage: targetStage, creatives_stage: targetStage }
    setLocalProjects(prev => prev.map(p =>
      p.id === card.id ? { ...p, ...patch } : p
    ))
    startTransition(async () => {
      try {
        if (trackView === 'combined') {
          await updateProjectStagesBoth(card.id, card.brands.id, targetStage)
        } else {
          await updateProjectStage(
            card.id,
            card.brands.id,
            trackView === 'lp' ? 'lp_stage' : 'creatives_stage',
            targetStage,
          )
        }
        router.refresh()
      } catch {
        setLocalProjects(snapshot)
      }
    })
  }, [localProjects, router, startTransition, trackView])

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

  // The track view is a way of reading the board, not a filter; it is left
  // alone by Clear.
  const filterCount = [deferredSearch.trim() !== '', status !== 'all', filterWaiting, mineActive, editor !== 'all'].filter(Boolean).length
  function clearFilters() {
    setSearch(''); setStatus('all'); setFilterWaiting(false); setMineOnly(false); setEditor('all')
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Toolbar — one row: what to search, how to column, what to show.
          Mutually exclusive choices are segmented controls, on/off ones are
          toggle chips, so the shape of a control says how it behaves. */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', flexShrink: 0 }}>
        <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
          <Search size={14} strokeWidth={2} aria-hidden style={{ position: 'absolute', left: 12, color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input
            type="search"
            placeholder="Search brands"
            aria-label="Search by brand"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: 220, fontSize: 'var(--text-sm)', padding: '7px 12px 7px 34px', borderRadius: 20, background: 'var(--surface)' }}
          />
        </label>

        {/* Which track's stage the board columns by */}
        <Segmented
          ariaLabel="Column cards by"
          value={trackView}
          onChange={setTrackView}
          options={[
            { value: 'combined', label: 'Combined', title: 'Column = the earlier of the two tracks' },
            { value: 'lp', label: 'LP', title: "Column = the LP track's own stage" },
            { value: 'creatives', label: 'Creatives', title: "Column = the Creatives track's own stage" },
          ]}
        />

        <Segmented
          ariaLabel="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: 'All' },
            { value: 'overdue', label: 'Overdue' },
            { value: 'in_review', label: 'In review' },
          ]}
        />

        {/* Only offer "My work" to someone who has a profile and is actually on
            something — otherwise it's a button that always yields an empty board. */}
        {currentProfileId && myCount > 0 && (
          <ToggleChip active={mineOnly} onClick={() => setMineOnly(v => !v)} icon={<UserRound size={13} strokeWidth={2} aria-hidden />} count={myCount}>
            My work
          </ToggleChip>
        )}

        <ToggleChip active={filterWaiting} onClick={() => setFilterWaiting(v => !v)} tone="warning" icon={<Hourglass size={13} strokeWidth={2} aria-hidden />} count={waitingCount || undefined}>
          Waiting on client
        </ToggleChip>

        <select
          value={editor}
          onChange={e => setEditor(e.target.value)}
          aria-label="Filter by editor"
          style={{
            fontSize: 'var(--text-sm)',
            padding: '6px 30px 6px 12px',
            borderRadius: 20,
            border: `1px solid ${editor === 'all' ? 'var(--border)' : 'var(--editor-creative)'}`,
            background: editor === 'all' ? 'var(--surface)' : 'color-mix(in srgb, var(--editor-creative) 10%, var(--surface))',
            color: editor === 'all' ? 'var(--text-secondary)' : 'var(--editor-creative)',
            fontWeight: editor === 'all' ? 500 : 600,
            cursor: 'pointer',
          }}
        >
          <option value="all">All editors</option>
          <option value="unassigned">Unassigned</option>
          {editors.map(p => (
            <option key={p.id} value={p.id}>{profileName(p)}</option>
          ))}
        </select>

        {filterCount > 0 && (
          <button
            type="button"
            onClick={clearFilters}
            className="focus-ring-pill"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 'var(--text-sm)', fontWeight: 500, cursor: 'pointer', padding: '6px 8px' }}
          >
            <X size={13} strokeWidth={2} aria-hidden /> Clear filters
          </button>
        )}
      </div>

      {/* Count and export. The page heading above already says "Active
          Pipeline"; this line says what the filters left of it. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexShrink: 0 }}>
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
          Showing <strong style={{ color: 'var(--text-primary)' }}>{displayed.length}</strong>
          {displayed.length !== localProjects.length ? ` of ${localProjects.length}` : ''} project{displayed.length !== 1 ? 's' : ''}
          {filterCount > 0 && <span style={{ color: 'var(--text-muted)' }}> · {filterCount} filter{filterCount === 1 ? '' : 's'} on</span>}
        </span>
        {displayed.length > 0 && (
          <CopyMarkdownButton
            markdown={() => pipelineMarkdown(displayed, filterNote())}
            label="Copy pipeline"
            title="Copy the cards currently shown as a markdown table"
            style={{ marginLeft: 'auto', padding: '6px 12px' }}
          />
        )}
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
            gridTemplateColumns: `repeat(${STAGE_ORDER.length}, minmax(272px, 1fr))`,
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
    // The column is a soft panel a shade off the page, so cards sit in a lane
    // rather than floating; the panel lights up as the drop target.
    <div style={{
      display: 'flex', flexDirection: 'column', minWidth: 0, height: '100%',
      background: isOver ? 'color-mix(in srgb, var(--accent) 6%, var(--surface))' : 'color-mix(in srgb, var(--surface) 55%, var(--background))',
      border: `1px solid ${isOver ? 'color-mix(in srgb, var(--accent) 50%, transparent)' : 'var(--border)'}`,
      borderRadius: 12,
      padding: 8,
      transition: 'background 0.15s, border-color 0.15s',
    }}>
      {/* Column header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        padding: '6px 6px 12px',
        flexShrink: 0,
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: color.border, flexShrink: 0 }} />
          <span style={{
            fontSize: 'var(--text-xs)', fontWeight: 700, color: color.text,
            textTransform: 'uppercase', letterSpacing: '0.08em',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {STAGE_LABELS[stage]}
          </span>
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
          padding: '0 0 4px',
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
            border: '1px dashed var(--border-strong)', borderRadius: 10,
            padding: '26px 12px', textAlign: 'center',
            color: 'var(--text-muted)', fontSize: 12,
          }}>
            Nothing in {STAGE_LABELS[stage]}
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

// One control for a set of mutually exclusive options.
function Segmented<T extends string>({
  value, onChange, options, ariaLabel,
}: {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string; title?: string }[]
  ariaLabel: string
}) {
  return (
    <div role="group" aria-label={ariaLabel} style={{ display: 'inline-flex', padding: 3, gap: 2, border: '1px solid var(--border)', borderRadius: 20, background: 'var(--surface)' }}>
      {options.map(o => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className="focus-ring-pill"
            aria-pressed={active}
            title={o.title}
            style={{
              padding: '5px 12px', borderRadius: 16, border: 'none',
              fontSize: 'var(--text-sm)', fontWeight: active ? 600 : 500, cursor: 'pointer', whiteSpace: 'nowrap',
              background: active ? 'var(--accent-muted)' : 'transparent',
              color: active ? 'var(--accent)' : 'var(--text-secondary)',
              transition: 'all 0.15s',
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

// An on/off filter with an optional count.
function ToggleChip({
  active, onClick, icon, count, tone = 'accent', children,
}: {
  active: boolean
  onClick: () => void
  icon?: React.ReactNode
  count?: number
  tone?: 'accent' | 'warning'
  children: React.ReactNode
}) {
  const color = tone === 'warning' ? 'var(--warning)' : 'var(--accent)'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="focus-ring-pill"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '6px 12px', borderRadius: 20,
        fontSize: 'var(--text-sm)', fontWeight: active ? 600 : 500, cursor: 'pointer', whiteSpace: 'nowrap',
        border: `1px solid ${active ? `color-mix(in srgb, ${color} 45%, transparent)` : 'var(--border)'}`,
        background: active ? `color-mix(in srgb, ${color} 12%, var(--surface))` : 'var(--surface)',
        color: active ? color : 'var(--text-secondary)',
        transition: 'all 0.15s',
      }}
    >
      {icon}
      {children}
      {count !== undefined && (
        <span style={{
          fontSize: 10, fontWeight: 700, borderRadius: 10, padding: '1px 6px',
          background: active ? `color-mix(in srgb, ${color} 20%, transparent)` : 'var(--surface-raised)',
          border: active ? '1px solid transparent' : '1px solid var(--border)',
          color: active ? color : 'var(--text-secondary)',
        }}>
          {count}
        </span>
      )}
    </button>
  )
}

