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
  OFFER_STAGE_LABELS, OFFER_STAGE_ORDER, offerMonthLabel,
  type Brand, type OfferCard, type OfferStage,
} from '@/lib/types'
import { OFFER_STAGE_COLORS } from '@/lib/stageColors'
import { createOfferCard, updateOfferStage } from '@/lib/offer-actions'

type BoardOfferCard = OfferCard & { brands: { id: string; name: string } }

export default function OffersBoard({
  cards,
  brands,
}: {
  cards: BoardOfferCard[]
  brands: Pick<Brand, 'id' | 'name' | 'is_active'>[]
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
  const [showNew, setShowNew] = useState(false)

  const [activeId, setActiveId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } })
  )

  const displayed = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return localCards
    return localCards.filter(c => c.brands.name.toLowerCase().includes(q))
  }, [localCards, search])

  const columns = useMemo(
    () => OFFER_STAGE_ORDER.map(stage => ({
      stage,
      cards: displayed.filter(c => c.stage === stage),
    })),
    [displayed]
  )

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

  return (
    <section style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', marginBottom: 'var(--space-4)', flexWrap: 'wrap', flexShrink: 0 }}>
        <input
          type="text"
          placeholder="Search by brand…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: 190, fontSize: 'var(--text-base)' }}
        />
        <button
          onClick={() => setShowNew(v => !v)}
          className="focus-ring-pill"
          style={{
            padding: 'var(--space-2) var(--space-3)', borderRadius: 20, fontSize: 'var(--text-sm)',
            cursor: 'pointer', border: '1px solid var(--accent)', fontWeight: 600,
            background: showNew ? 'var(--accent-muted)' : 'transparent', color: 'var(--accent)',
          }}
        >
          + New offer card
        </button>
      </div>

      {showNew && <NewOfferCardForm brands={brands} onDone={() => setShowNew(false)} />}

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="kanban-board" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, minmax(260px, 1fr))',
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
                isOver={overId === stage}
                isDragging={activeId !== null}
                draggedCardId={activeId}
                onMove={moveCard}
              />
            ))}
          </div>

          <DragOverlay dropAnimation={null}>
            {activeCard ? (
              <div style={{ transform: 'rotate(1.5deg)', filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.5))' }}>
                <OfferCardTile card={activeCard} isGhost />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
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
  isOver,
  isDragging,
  draggedCardId,
  onMove,
}: {
  stage: OfferStage
  cards: BoardOfferCard[]
  isOver: boolean
  isDragging: boolean
  draggedCardId: string | null
  onMove: (card: BoardOfferCard, targetStage: OfferStage) => void
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
        <span style={{
          fontSize: 'var(--text-xs)', fontWeight: 700, color: color.text,
          background: color.bg,
          borderRadius: 12, padding: '1px 8px',
        }}>
          {cards.length}
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
                <OfferCardTile card={c} onMove={onMove} />
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
}: {
  card: BoardOfferCard
  isGhost?: boolean
  onMove?: (card: BoardOfferCard, targetStage: OfferStage) => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: card.id,
    disabled: isGhost,
  })

  const color = OFFER_STAGE_COLORS[card.stage]
  const stageIdx = OFFER_STAGE_ORDER.indexOf(card.stage)
  const prevStage = stageIdx > 0 ? OFFER_STAGE_ORDER[stageIdx - 1] : null
  const nextStage = stageIdx < OFFER_STAGE_ORDER.length - 1 ? OFFER_STAGE_ORDER[stageIdx + 1] : null

  return (
    <div
      ref={setNodeRef}
      className="kanban-card"
      style={{
        position: 'relative',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${color.border}`,
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
          <div style={{
            fontSize: 11, color: 'var(--text-muted)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            paddingRight: 20,
          }}>
            {card.brands.name}
          </div>
          <div style={{
            fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.35,
          }}>
            {offerMonthLabel(card.target_month)} · M{card.moment_slot} Offer
          </div>
          <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
            <span style={{
              fontSize: 'var(--text-2xs)', fontWeight: 600, color: color.text,
              background: color.bg,
              border: `1px solid color-mix(in srgb, ${color.border} 25%, transparent)`,
              borderRadius: 5, padding: '2px 6px', whiteSpace: 'nowrap',
            }}>
              {OFFER_STAGE_LABELS[card.stage]}
            </span>
            {card.derived_production_card_id && (
              <span style={{
                fontSize: 'var(--text-2xs)', fontWeight: 600, color: 'var(--success)',
                whiteSpace: 'nowrap',
              }} title="Production card created">
                → production
              </span>
            )}
          </div>
        </div>
      </Link>

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
    </div>
  )
}
