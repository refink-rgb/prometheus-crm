'use client'

import { memo, useCallback, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  DndContext, DragOverlay,
  PointerSensor, TouchSensor,
  useSensor, useSensors,
  useDraggable, useDroppable,
  type DragStartEvent, type DragOverEvent, type DragEndEvent,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import {
  OFFER_STAGE_LABELS, OFFER_STAGE_ORDER, offerMonthLabel, offerMonthShortLabel, profileName,
  type Brand, type OfferCard, type OfferStage, type Profile,
} from '@/lib/types'
import { OFFER_APPROVAL_DAY, OFFER_STAGE_COLORS, offerDueLabel, offerDueTone, type PhaseDueTone } from '@/lib/stageColors'
import { createOfferCard, updateOfferStage, assignOfferCard } from '@/lib/offer-actions'
import Avatar from '@/components/Avatar'
import { ClockIcon } from '@/components/KanbanCard'
import OfferLibrary from '@/components/OfferLibrary'
import ApprovalLinksPanel, { type EngineerLink } from '@/components/ApprovalLinksPanel'
import MarkdownActions from '@/components/MarkdownActions'
import type { OfferHistoryEntry } from '@/lib/offer-history'
import { offerCompletion } from '@/lib/offer-history'
import { offerApprovalState } from '@/lib/offer-approvals'
import { offersBoardMarkdown } from '@/lib/markdown-export'

type BoardOfferCard = OfferCard & { brands: { id: string; name: string } }

// 'all' | 'unassigned' | a profile id.
type OwnerFilter = 'all' | 'unassigned' | (string & {})

// Same shape as KanbanView's StatusFilter: a small always-present pill group
// rather than a filter that appears and disappears with the data.
type OfferStatusFilter = 'all' | 'late' | 'in_review'

// Column sort order: late, then due soon, then everything else (approved cards
// have no tone and sort last).
const TONE_RANK = { overdue: 0, urgent: 1, neutral: 2 } as const
function toneRank(targetMonth: string, stage: OfferStage): number {
  const tone = offerDueTone(targetMonth, stage)
  return tone ? TONE_RANK[tone] : 3
}

export default function OffersBoard({
  cards,
  history,
  brands,
  assignees,
  currentProfileId,
  engineerLinks = [],
}: {
  cards: BoardOfferCard[]
  history: OfferHistoryEntry[]
  brands: Pick<Brand, 'id' | 'name' | 'is_active'>[]
  /** Roster the assignee picker offers — the strategist/management set. */
  assignees: Profile[]
  /** Signed-in user's profile id, or null — powers the "My cards" filter. */
  currentProfileId: string | null
  /** Per-engineer approval links. Empty for non-editors, which hides the tab. */
  engineerLinks?: EngineerLink[]
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  // Optimistic board state, re-synced when the server sends fresh props
  // (router.refresh() after a move). Render-time adjustment instead of an
  // effect — same behavior as KanbanView's useEffect sync without the extra
  // render pass.
  const [localCards, setLocalCards] = useState(cards)
  const [syncedCards, setSyncedCards] = useState(cards)
  if (syncedCards !== cards) {
    setSyncedCards(cards)
    setLocalCards(cards)
  }

  const [search, setSearch] = useState('')
  const [view, setView] = useState<'pipeline' | 'library' | 'approvals'>('pipeline')
  const [showNew, setShowNew] = useState(false)
  const [owner, setOwner] = useState<OwnerFilter>('all')
  const [mineOnly, setMineOnly] = useState(false)
  // Mirrors KanbanView's All / Overdue / In Review pill group, so the two
  // boards are filtered the same way with the same control.
  const [status, setStatus] = useState<OfferStatusFilter>('all')

  const [activeId, setActiveId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } })
  )

  // Memoized so OfferCardTile's memo() holds — an inline Map would be a new
  // reference each render and re-render every card.
  const assigneesById = useMemo(() => new Map(assignees.map(p => [p.id, p])), [assignees])

  // Approved cards from prior months belong in the searchable library, not in
  // the day-to-day board's terminal column. Unapproved old cards stay visible
  // because they still need action.
  const pipelineCards = useMemo(() => {
    const currentMonth = `${new Date().toISOString().slice(0, 7)}-01`
    return localCards.filter(card => card.stage !== 'offer_approved' || card.target_month >= currentMonth)
  }, [localCards])

  const myCount = useMemo(
    () => (currentProfileId ? pipelineCards.filter(c => c.assigned_to === currentProfileId).length : 0),
    [pipelineCards, currentProfileId]
  )

  // An offer still in the pipeline past the 5th of its own month is late.
  const lateCount = useMemo(
    () => pipelineCards.filter(c => offerDueTone(c.target_month, c.stage) === 'overdue').length,
    [pipelineCards]
  )

  const displayed = useMemo(() => {
    const q = search.trim().toLowerCase()
    return pipelineCards.filter(c => {
      if (q && ![c.brands.name, c.offer, c.product_featured].filter(Boolean).join(' ').toLowerCase().includes(q)) return false
      if (mineOnly && (!currentProfileId || c.assigned_to !== currentProfileId)) return false
      if (status === 'late' && offerDueTone(c.target_month, c.stage) !== 'overdue') return false
      if (status === 'in_review' && c.stage !== 'internal_offer_review' && c.stage !== 'client_review') return false
      if (owner === 'unassigned' && c.assigned_to) return false
      if (owner !== 'all' && owner !== 'unassigned' && c.assigned_to !== owner) return false
      return true
    })
  }, [pipelineCards, search, owner, mineOnly, status, currentProfileId])

  // Names the active filters in the exported header, so a pasted table is not
  // mistaken for the whole board.
  function offersFilterNote(): string | undefined {
    const parts: string[] = []
    if (search.trim()) parts.push(`search "${search.trim()}"`)
    if (mineOnly) parts.push('my cards')
    if (status === 'late') parts.push('late only')
    if (status === 'in_review') parts.push('in review')
    if (owner === 'unassigned') parts.push('unassigned')
    else if (owner !== 'all') {
      const p = assignees.find(a => a.id === owner)
      parts.push(`owner ${p ? profileName(p) : owner}`)
    }
    return parts.length ? `filtered: ${parts.join(', ')}` : undefined
  }

  // Late first, then closest to the deadline — the top of a column is the part
  // people actually scan, so the cards that need chasing belong there.
  // .filter() already returns a fresh array, so sorting it in place is safe.
  const columns = useMemo(
    () => OFFER_STAGE_ORDER.map(stage => ({
      stage,
      cards: displayed
        .filter(c => c.stage === stage)
        .sort((a, b) =>
          toneRank(a.target_month, a.stage) - toneRank(b.target_month, b.stage)
          || a.target_month.localeCompare(b.target_month)
          || a.moment_slot - b.moment_slot
          || a.brands.name.localeCompare(b.brands.name)),
    })),
    [displayed]
  )

  const lateByStage = useMemo(() => {
    const map = new Map<OfferStage, number>()
    for (const c of displayed) {
      if (offerDueTone(c.target_month, c.stage) !== 'overdue') continue
      map.set(c.stage, (map.get(c.stage) ?? 0) + 1)
    }
    return map
  }, [displayed])

  const activeCard = activeId ? localCards.find(c => c.id === activeId) ?? null : null

  // Shared by drag-drop and the keyboard move buttons, mirroring KanbanView.
  const moveCard = useCallback((card: BoardOfferCard, targetStage: OfferStage) => {
    if (card.stage === targetStage) return
    const snapshot = [...localCards]
    setLocalCards(prev => prev.map(c => (c.id === card.id ? { ...c, stage: targetStage } : c)))
    startTransition(async () => {
      try {
        await updateOfferStage(card.id, targetStage)
        router.refresh()
      } catch {
        setLocalCards(snapshot)
      }
    })
  }, [localCards, router, startTransition])

  // Optimistic assignment, mirroring moveCard: update local state now, reconcile
  // on the server refresh, roll back on failure.
  const assignCard = useCallback((cardId: string, profileId: string | null) => {
    const snapshot = [...localCards]
    setLocalCards(prev => prev.map(c => (c.id === cardId ? { ...c, assigned_to: profileId } : c)))
    startTransition(async () => {
      try {
        await assignOfferCard(cardId, profileId)
        router.refresh()
      } catch {
        setLocalCards(snapshot)
      }
    })
  }, [localCards, router, startTransition])

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
    const card = localCards.find(c => c.id === active.id)
    if (!card) return
    const targetStage = over.id as OfferStage
    if (!OFFER_STAGE_ORDER.includes(targetStage)) return
    moveCard(card, targetStage)
  }

  // Same pill geometry KanbanView uses for its filter row.
  const pillBase: React.CSSProperties = {
    padding: 'var(--space-2) var(--space-3)', borderRadius: 20, fontSize: 'var(--text-sm)',
    cursor: 'pointer', transition: 'all 0.15s', border: '1px solid',
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
        {([
          { id: 'pipeline', label: 'Active pipeline', count: cards.filter(card => card.stage !== 'offer_approved').length },
          { id: 'library', label: 'Offer library', count: history.length },
          ...(engineerLinks.length
            ? [{ id: 'approvals' as const, label: 'Approval links', count: engineerLinks.length }]
            : []),
        ] as const).map(option => {
          const selected = view === option.id
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setView(option.id)}
              style={{
                position: 'relative', padding: '9px 12px 11px', border: 0,
                background: 'transparent', color: selected ? 'var(--text-primary)' : 'var(--text-muted)',
                fontSize: 'var(--text-base)', fontWeight: selected ? 700 : 500, cursor: 'pointer',
              }}
            >
              {option.label}
              <span style={{ marginLeft: 7, fontSize: 'var(--text-2xs)', color: selected ? 'var(--accent)' : 'var(--text-muted)' }}>{option.count}</span>
              {selected && <span style={{ position: 'absolute', height: 2, left: 8, right: 8, bottom: -1, background: 'var(--accent)', borderRadius: 2 }} />}
            </button>
          )
        })}
        <button
          onClick={() => setShowNew(value => !value)}
          className="btn-accent-outline btn-sm"
          style={{ marginLeft: 'auto', marginBottom: 6 }}
        >
          + New offer
        </button>
      </div>

      {showNew && <NewOfferCardForm brands={brands} onDone={() => setShowNew(false)} />}

      {view === 'approvals' ? (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 2 }}>
          <ApprovalLinksPanel engineers={engineerLinks} />
        </div>
      ) : view === 'library' ? (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 2 }}>
          <OfferLibrary entries={history} assignees={assignees} />
        </div>
      ) : (
        <>
      {/* Toolbar — same control order as the Active Pipeline board:
          search, status pills, "mine", owner. */}
      <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', marginBottom: 'var(--space-4)', flexWrap: 'wrap', flexShrink: 0 }}>
        <input
          type="text"
          placeholder="Search by brand…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: 190, fontSize: 'var(--text-base)' }}
        />

        <div style={{ display: 'flex', gap: 4 }}>
          {(['all', 'late', 'in_review'] as const).map(opt => {
            const active = status === opt
            const labels = { all: 'All', late: 'Late', in_review: 'In Review' }
            // Late is the only pill that carries a count — it's the one worth
            // chasing, and a permanent "Late 0" trains people to ignore it.
            const badge = opt === 'late' && lateCount > 0 ? lateCount : null
            const tint = opt === 'late' ? 'var(--danger)' : 'var(--accent)'
            return (
              <button
                key={opt}
                onClick={() => setStatus(opt)}
                className="focus-ring-pill"
                aria-pressed={active}
                title={opt === 'late'
                  ? `Offers still in the pipeline past the ${OFFER_APPROVAL_DAY}th of their month`
                  : opt === 'in_review'
                    ? 'Offers sitting in internal or client review'
                    : 'Every offer on the board'}
                style={{
                  ...pillBase,
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  fontWeight: active ? 600 : 400,
                  borderColor: active ? tint : 'var(--border)',
                  background: active ? `color-mix(in srgb, ${tint} 12%, transparent)` : 'transparent',
                  color: active ? tint : 'var(--text-muted)',
                }}
              >
                {labels[opt]}
                {badge !== null && (
                  <span style={{
                    fontSize: 'var(--text-2xs)', fontWeight: 700,
                    background: active ? `color-mix(in srgb, ${tint} 22%, transparent)` : 'var(--border)',
                    color: active ? tint : 'var(--text-secondary)',
                    borderRadius: 10, padding: '1px 6px',
                  }}>
                    {badge}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Only surface "My cards" to someone who actually owns some. */}
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
            My cards ({myCount})
          </button>
        )}

        {/* Owner filter — mirrors the pipeline Kanban's editor filter. */}
        {assignees.length > 0 && (
          <select
            value={owner}
            onChange={e => setOwner(e.target.value)}
            aria-label="Filter by owner"
            style={{
              width: 'auto',
              fontSize: 'var(--text-sm)',
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 20,
              border: `1px solid ${owner === 'all' ? 'var(--border)' : 'var(--accent)'}`,
              background: owner === 'all' ? 'transparent' : 'var(--accent-muted)',
              color: owner === 'all' ? 'var(--text-muted)' : 'var(--accent)',
              fontWeight: owner === 'all' ? 400 : 600,
              cursor: 'pointer',
            }}
          >
            <option value="all">All owners</option>
            <option value="unassigned">Unassigned</option>
            {assignees.map(p => (
              <option key={p.id} value={p.id}>{profileName(p)}</option>
            ))}
          </select>
        )}
      </div>

      {/* Board summary — the Active Pipeline's "N of M" header, so a filtered
          board never looks like the whole board. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)', flexShrink: 0 }}>
        <h2 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Offer Pipeline — {displayed.length}{displayed.length !== pipelineCards.length ? ` of ${pipelineCards.length}` : ''} offer{displayed.length !== 1 ? 's' : ''}
        </h2>
        {displayed.length > 0 && (
          <MarkdownActions
            markdown={() => offersBoardMarkdown(
              displayed,
              c => {
                const p = assignees.find(a => a.id === c.assigned_to)
                return p ? profileName(p) : null
              },
              offersFilterNote(),
            )}
            copyLabel="Copy offers"
            filename="active-offer-pipeline"
            style={{ marginLeft: 'auto' }}
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
          <div className="kanban-board" style={{
            display: 'grid',
            // Derived from OFFER_STAGE_ORDER so adding a stage never leaves an
            // orphan column wrapping to a second row (mirrors KanbanView).
            gridTemplateColumns: `repeat(${OFFER_STAGE_ORDER.length}, minmax(260px, 1fr))`,
            gridTemplateRows: 'minmax(0, 1fr)',
            gap: 12,
            height: '100%',
            overflowX: 'auto',
            overflowY: 'hidden',
          }}>
            {columns.map(({ stage, cards: columnCards }) => (
              <OfferColumn
                key={stage}
                stage={stage}
                cards={columnCards}
                lateCount={lateByStage.get(stage) ?? 0}
                isOver={overId === stage}
                isDragging={activeId !== null}
                draggedCardId={activeId}
                onMove={moveCard}
                onAssign={assignCard}
                assignees={assignees}
                assigneesById={assigneesById}
              />
            ))}
          </div>

          <DragOverlay dropAnimation={null}>
            {activeCard ? (
              <div style={{ transform: 'rotate(1.5deg)', filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.5))' }}>
                <OfferCardTile card={activeCard} isGhost assigneesById={assigneesById} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
        </>
      )}
    </section>
  )
}

function NewOfferCardForm({
  brands,
  onDone,
}: {
  brands: Pick<Brand, 'id' | 'name' | 'is_active'>[]
  onDone: () => void
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Actives first — they're who offer cards are for; inactive still allowed
  // (test brands, transitions).
  const sorted = useMemo(
    () => [...brands].sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.name.localeCompare(b.name)),
    [brands]
  )

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      const { redirect } = await createOfferCard(new FormData(e.currentTarget))
      onDone()
      router.push(redirect)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create offer card.')
      setPending(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
        padding: '10px 14px', marginBottom: 'var(--space-4)', flexShrink: 0,
      }}
    >
      <select name="brand_id" required defaultValue="" style={{ fontSize: 'var(--text-sm)' }}>
        <option value="" disabled>Brand…</option>
        {sorted.map(b => (
          <option key={b.id} value={b.id}>{b.is_active ? b.name : `${b.name} (inactive)`}</option>
        ))}
      </select>
      <input name="target_month" type="month" required style={{ fontSize: 'var(--text-sm)' }} />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
        <label style={{ display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
          <input type="radio" name="moment_slot" value="1" defaultChecked style={{ width: 'auto', padding: 0 }} /> M1
        </label>
        <label style={{ display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
          <input type="radio" name="moment_slot" value="2" style={{ width: 'auto', padding: 0 }} /> M2
        </label>
      </div>
      <button
        type="submit"
        disabled={pending}
        style={{
          padding: '6px 14px', borderRadius: 8, fontSize: 'var(--text-sm)', fontWeight: 600,
          background: 'var(--accent)', color: 'white', border: 'none',
          cursor: pending ? 'wait' : 'pointer', opacity: pending ? 0.7 : 1,
        }}
      >
        {pending ? 'Creating…' : 'Create'}
      </button>
      {error && <span style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)' }}>{error}</span>}
    </form>
  )
}

const OfferColumn = memo(OfferColumnInner)

function OfferColumnInner({
  stage,
  cards,
  lateCount,
  isOver,
  isDragging,
  draggedCardId,
  onMove,
  onAssign,
  assignees,
  assigneesById,
}: {
  stage: OfferStage
  cards: BoardOfferCard[]
  lateCount: number
  isOver: boolean
  isDragging: boolean
  draggedCardId: string | null
  onMove: (card: BoardOfferCard, targetStage: OfferStage) => void
  onAssign: (cardId: string, profileId: string | null) => void
  assignees: Profile[]
  assigneesById: Map<string, Profile>
}) {
  const color = OFFER_STAGE_COLORS[stage]
  const { setNodeRef } = useDroppable({ id: stage })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, height: '100%' }}>
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
          {OFFER_STAGE_LABELS[stage]}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {lateCount > 0 && (
            <span
              title={`${lateCount} offer${lateCount === 1 ? '' : 's'} past the ${OFFER_APPROVAL_DAY}th of their month`}
              style={{
                fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--danger)',
                background: 'color-mix(in srgb, var(--danger) 14%, transparent)',
                borderRadius: 12, padding: '1px 8px',
              }}
            >
              {lateCount} late
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
        {isOver && isDragging && (
          <div style={{
            height: 64,
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
            No offers in {OFFER_STAGE_LABELS[stage]}
          </div>
        ) : (
          cards
            .filter(c => c.id !== draggedCardId)
            .map(c => (
              <div key={c.id} style={{ flexShrink: 0 }}>
                <OfferCardTile card={c} onMove={onMove} onAssign={onAssign} assignees={assignees} assigneesById={assigneesById} />
              </div>
            ))
        )}
      </div>
    </div>
  )
}

const moveBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border)',
  color: 'var(--text-muted)',
  borderRadius: 6,
  width: 22,
  height: 18,
  lineHeight: 1,
  fontSize: 'var(--text-sm)',
  cursor: 'pointer',
}

const OfferCardTile = memo(OfferCardTileInner)

function OfferCardTileInner({
  card,
  isGhost = false,
  onMove,
  onAssign,
  assignees,
  assigneesById,
}: {
  card: BoardOfferCard
  isGhost?: boolean
  onMove?: (card: BoardOfferCard, targetStage: OfferStage) => void
  onAssign?: (cardId: string, profileId: string | null) => void
  assignees?: Profile[]
  assigneesById?: Map<string, Profile>
}) {
  const owner = card.assigned_to ? assigneesById?.get(card.assigned_to) : undefined
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: card.id,
    disabled: isGhost,
  })

  const color = OFFER_STAGE_COLORS[card.stage]
  const stageIdx = OFFER_STAGE_ORDER.indexOf(card.stage)
  const prevStage = stageIdx > 0 ? OFFER_STAGE_ORDER[stageIdx - 1] : null
  const nextStage = stageIdx < OFFER_STAGE_ORDER.length - 1 ? OFFER_STAGE_ORDER[stageIdx + 1] : null

  // Same treatment KanbanCard gives an overdue project, so "late" reads
  // identically on both boards.
  const tone = offerDueTone(card.target_month, card.stage)
  const dueLabel = offerDueLabel(card.target_month, card.stage)
  const isLate = tone === 'overdue'
  const completion = offerCompletion(card)

  return (
    <div
      ref={setNodeRef}
      className="kanban-card"
      style={{
        position: 'relative',
        background: isLate
          ? 'color-mix(in srgb, var(--danger) 5%, var(--surface))'
          : 'var(--surface)',
        border: `1px solid ${isLate ? 'rgba(239,68,68,0.35)' : 'var(--border)'}`,
        borderLeft: `3px solid ${isLate ? 'var(--danger)' : color.border}`,
        borderRadius: 10,
        overflow: 'hidden',
        opacity: isDragging ? 0.35 : 1,
        transform: CSS.Translate.toString(transform),
      }}
    >
      {/* Drag handle kept OFF the Link node — dnd-kit's pointer sensor swallows
          plain clicks on whatever element carries its listeners (see the same
          note in KanbanCard.tsx). */}
      {!isGhost && (
        <div
          {...listeners}
          {...attributes}
          aria-hidden="true"
          tabIndex={-1}
          title="Drag to move"
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            width: 20,
            height: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 5,
            cursor: isDragging ? 'grabbing' : 'grab',
            touchAction: 'none',
            color: 'var(--text-muted)',
            zIndex: 1,
          }}
        >
          <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
            <circle cx="2" cy="2" r="1.4" />
            <circle cx="8" cy="2" r="1.4" />
            <circle cx="2" cy="7" r="1.4" />
            <circle cx="8" cy="7" r="1.4" />
            <circle cx="2" cy="12" r="1.4" />
            <circle cx="8" cy="12" r="1.4" />
          </svg>
        </div>
      )}

      <Link
        href={`/offers/${card.id}`}
        style={{ display: 'block', textDecoration: 'none', color: 'inherit', padding: '12px 14px' }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

          {/* Brand name — right-padded so the drag handle never overlaps a
              long, ellipsis-truncated name (same as KanbanCard). */}
          <div style={{
            fontSize: 11, color: 'var(--text-muted)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            paddingRight: 20,
          }}>
            {card.brands.name}
          </div>

          {/* The offer itself — this card's title, in the slot KanbanCard
              gives the project name. */}
          <div style={{
            fontSize: 13, fontWeight: 600, color: card.offer ? 'var(--text-primary)' : 'var(--text-muted)', lineHeight: 1.35,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {card.offer?.trim() || 'Define the offer'}
          </div>

          {/* Chip row — the Track-pill slot on a project card. The stage chip
              is intentionally absent: the column header and the left border
              already say the stage, so repeating it on every card is noise.
              The drag ghost is the exception — off the board it has no
              column to read the stage from. */}
          <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 'var(--text-2xs)', fontWeight: 600, color: 'var(--text-secondary)',
              background: 'var(--surface-raised)',
              border: '1px solid var(--border)',
              borderRadius: 5, padding: '2px 6px', whiteSpace: 'nowrap',
            }}>
              {offerMonthShortLabel(card.target_month)} · M{card.moment_slot}
            </span>
            {isGhost && (
              <span style={{
                fontSize: 'var(--text-2xs)', fontWeight: 600, color: color.text,
                background: color.bg,
                border: `1px solid color-mix(in srgb, ${color.border} 25%, transparent)`,
                borderRadius: 5, padding: '2px 6px', whiteSpace: 'nowrap',
              }}>
                {OFFER_STAGE_LABELS[card.stage]}
              </span>
            )}
            {card.offer_dynamics_type && (
              <span style={{
                fontSize: 'var(--text-2xs)', fontWeight: 600, color: color.text,
                background: color.bg,
                border: `1px solid color-mix(in srgb, ${color.border} 25%, transparent)`,
                borderRadius: 5, padding: '2px 6px', whiteSpace: 'nowrap',
                overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%',
              }}>
                {card.offer_dynamics_type}
              </span>
            )}
            {card.stage === 'internal_offer_review' && (() => {
              const approval = offerApprovalState(card)
              const tone = approval.count === 2 ? 'var(--success)' : 'var(--stage-internal-text)'
              return (
                <span
                  title={[approval.strategist, approval.engineer]
                    .map(s => `${s.label}: ${s.approved ? `approved${s.by ? ` by ${s.by}` : ''}` : 'pending'}`)
                    .join(' · ')}
                  style={{
                    fontSize: 'var(--text-2xs)', fontWeight: 700, whiteSpace: 'nowrap',
                    color: tone,
                    background: `color-mix(in srgb, ${tone} 12%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${tone} 28%, transparent)`,
                    borderRadius: 5, padding: '2px 6px',
                  }}
                >
                  {approval.count}/2 approved
                </span>
              )
            })()}
            {card.derived_production_card_id && (
              <span style={{
                fontSize: 'var(--text-2xs)', fontWeight: 600, color: 'var(--success)',
                background: 'color-mix(in srgb, var(--success) 12%, transparent)',
                border: '1px solid color-mix(in srgb, var(--success) 25%, transparent)',
                borderRadius: 5, padding: '2px 6px', whiteSpace: 'nowrap',
              }} title="Production card created">
                → production
              </span>
            )}
          </div>

          {card.product_featured && (
            <div style={{
              fontSize: 'var(--text-2xs)', color: 'var(--text-muted)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {card.product_featured}
            </div>
          )}
        </div>
      </Link>

      {/* Owner + deadline row — the same bottom band a project card has
          (people on the left, the date anchor on the right). Sits OUTSIDE the
          Link (an anchor can't nest a select) and stops pointerdown so picking
          an owner never engages the drag sensor. */}
      {!isGhost && (
        <div
          onPointerDown={e => e.stopPropagation()}
          style={{
            padding: '0 14px 10px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          }}
        >
          {onAssign && assignees && assigneesById ? (
            <OfferAssigneePicker card={card} assignees={assignees} assigneesById={assigneesById} onAssign={onAssign} />
          ) : <span />}
          {dueLabel && <OfferDuePill card={card} tone={tone} label={dueLabel} />}
        </div>
      )}

      {/* On the drag ghost, show owner and deadline statically (no controls). */}
      {isGhost && (owner || dueLabel) && (
        <div style={{
          padding: '0 14px 10px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        }}>
          {owner ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <Avatar name={profileName(owner)} size={20} />
              <span style={{
                fontSize: 'var(--text-2xs)', color: 'var(--text-muted)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{profileName(owner)}</span>
            </span>
          ) : <span />}
          {dueLabel && <OfferDuePill card={card} tone={tone} label={dueLabel} />}
        </div>
      )}

      {/* Keyboard-operable move controls, outside the Link (see KanbanCard). */}
      {onMove && (prevStage || nextStage) && !isGhost && (
        <div
          onPointerDown={e => e.stopPropagation()}
          style={{ display: 'flex', justifyContent: 'space-between', padding: '0 8px 8px' }}
        >
          <button
            type="button"
            className="focus-ring-pill"
            aria-label={prevStage ? `Move to ${OFFER_STAGE_LABELS[prevStage]}` : 'Already in the first stage'}
            disabled={!prevStage}
            onClick={() => prevStage && onMove(card, prevStage)}
            style={moveBtnStyle}
          >
            ‹
          </button>
          <button
            type="button"
            className="focus-ring-pill"
            aria-label={nextStage ? `Move to ${OFFER_STAGE_LABELS[nextStage]}` : 'Already in the last stage'}
            disabled={!nextStage}
            onClick={() => nextStage && onMove(card, nextStage)}
            style={moveBtnStyle}
          >
            ›
          </button>
        </div>
      )}

      <div title={`${completion.complete} of ${completion.total} brief checkpoints complete`} style={{ height: 3, background: 'var(--border)' }}>
        <div style={{ height: '100%', width: `${completion.percent}%`, background: completion.percent === 100 ? 'var(--success)' : 'var(--accent)', transition: 'width 0.2s' }} />
      </div>
    </div>
  )
}

// The approval deadline — the 5th of the offer's own month — drawn as the
// pill a project card gives its go-live date: icon, rounded, tone-tinted.
// Hidden once approved: there's no deadline left to miss.
const DUE_TONE_COLOR: Record<PhaseDueTone, string> = {
  neutral: 'var(--text-muted)',
  urgent:  'var(--warning)',
  overdue: 'var(--danger)',
}

function OfferDuePill({
  card,
  tone,
  label,
}: {
  card: BoardOfferCard
  tone: PhaseDueTone | null
  label: string
}) {
  const color = DUE_TONE_COLOR[tone ?? 'neutral']
  const tinted = tone === 'urgent' || tone === 'overdue'
  return (
    <span
      title={`Offers must be approved by the ${OFFER_APPROVAL_DAY}th of ${offerMonthLabel(card.target_month)}`}
      style={{
        fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0,
        color,
        background: tinted ? `color-mix(in srgb, ${color} 12%, transparent)` : 'transparent',
        border: `1px solid ${tinted ? `color-mix(in srgb, ${color} 30%, transparent)` : 'transparent'}`,
        borderRadius: 20, padding: '2px 8px',
        display: 'inline-flex', alignItems: 'center', gap: 5,
      }}
    >
      <ClockIcon />
      {label}
    </span>
  )
}

// Compact owner picker on each card: an avatar (when assigned) beside a native
// select. Commits through the board's optimistic assignCard, so the change
// shows instantly and rolls back if the write fails. Restricted to the roster
// passed in; an owner no longer on the roster stays visible via a stale option.
function OfferAssigneePicker({
  card,
  assignees,
  assigneesById,
  onAssign,
}: {
  card: BoardOfferCard
  assignees: Profile[]
  assigneesById: Map<string, Profile>
  onAssign: (cardId: string, profileId: string | null) => void
}) {
  const current = card.assigned_to
  const owner = current ? assigneesById.get(current) : undefined
  const hasValue = !!current

  // Once assigned, the avatar carries the identity and the select shrinks to a
  // quiet affordance — the row then reads like a project card's avatar cluster
  // instead of a full-width form control.
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, flexShrink: 1 }}>
      {owner
        ? <Avatar name={profileName(owner)} size={20} title={`Owner: ${profileName(owner)}`} />
        : (
          <span
            aria-hidden
            style={{
              width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
              border: '1px dashed var(--border-strong, var(--border))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-muted)', fontSize: 11,
            }}
          >
            +
          </span>
        )}
      <select
        value={current ?? ''}
        onChange={e => onAssign(card.id, e.target.value || null)}
        aria-label="Assign owner"
        title={owner ? `Owner: ${profileName(owner)} — change` : 'Assign an owner'}
        style={{
          minWidth: 0, maxWidth: hasValue ? 92 : 108, width: 'auto',
          fontSize: 'var(--text-2xs)', fontWeight: hasValue ? 600 : 500,
          color: hasValue ? 'var(--text-secondary)' : 'var(--text-muted)',
          background: 'transparent',
          border: '1px solid transparent',
          borderRadius: 20, padding: '2px 6px', cursor: 'pointer',
          textOverflow: 'ellipsis',
        }}
      >
        <option value="">Assign…</option>
        {assignees.map(p => <option key={p.id} value={p.id}>{profileName(p)}</option>)}
        {current && !owner && <option value={current}>Assigned (off roster)</option>}
      </select>
    </span>
  )
}
