'use client'

import { memo, useCallback, useDeferredValue, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  DndContext, DragOverlay,
  PointerSensor, TouchSensor,
  useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { ChevronLeft, ChevronRight, ExternalLink, FileText, GripVertical, Plus, Search, Star, Video, X } from 'lucide-react'
import {
  EVERGREEN_STAGES, EVERGREEN_STAGE_COLORS, EVERGREEN_STAGE_LABELS, briefLinkLabel,
  type EvergreenCard, type EvergreenStage,
} from '@/lib/evergreen'
import { createEvergreenAd, moveEvergreenAd } from '@/lib/evergreen-actions'

// The Evergreen Ads board: four columns, Brief → Doing → Client Review → Live.
// Built like the production board (KanbanView) — same column panels, cards,
// drag + keyboard move buttons — but on its own tables, so it never touches a
// project's stages.

type BrandOption = { id: string; name: string }

export default function EvergreenBoard({ cards, brands, canEdit }: {
  cards: EvergreenCard[]
  brands: BrandOption[]
  canEdit: boolean
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [local, setLocal] = useState(cards)
  const [err, setErr] = useState('')
  // Take the server's cards after a refresh (reset during render, not in an effect).
  const [seenCards, setSeenCards] = useState(cards)
  if (cards !== seenCards) { setSeenCards(cards); setLocal(cards) }

  const [search, setSearch] = useState('')
  const [brand, setBrand] = useState('all')
  const deferredSearch = useDeferredValue(search)

  const [activeId, setActiveId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  )

  const brandOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const c of local) if (c.brands) seen.set(c.brands.id, c.brands.name)
    return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [local])

  const columns = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase()
    const shown = local.filter(c => {
      if (brand !== 'all' && c.brand_id !== brand) return false
      if (q && !(c.name.toLowerCase().includes(q) || (c.brands?.name ?? '').toLowerCase().includes(q))) return false
      return true
    })
    return EVERGREEN_STAGES.map(stage => ({
      stage,
      cards: shown
        .filter(c => c.stage === stage)
        .sort((a, b) => Number(!!b.brands?.is_priority) - Number(!!a.brands?.is_priority)),
    }))
  }, [local, deferredSearch, brand])

  const move = useCallback((card: EvergreenCard, stage: EvergreenStage) => {
    if (!canEdit || card.stage === stage) return
    if (stage === 'client_review' && card.videoCount === 0) {
      setErr(`“${card.name}” has no videos yet. Upload one before sending it to Client Review.`)
      return
    }
    const snapshot = local
    setLocal(prev => prev.map(c => (c.id === card.id ? { ...c, stage } : c)))
    setErr('')
    startTransition(async () => {
      const r = await moveEvergreenAd(card.id, stage)
      if (!r.ok) { setLocal(snapshot); setErr(r.error); return }
      router.refresh()
    })
  }, [canEdit, local, router])

  function onDragStart(e: DragStartEvent) { setActiveId(String(e.active.id)) }
  function onDragOver(e: DragOverEvent) { setOverId(e.over ? String(e.over.id) : null) }
  function onDragEnd(e: DragEndEvent) {
    setActiveId(null)
    setOverId(null)
    const card = local.find(c => c.id === e.active.id)
    const target = e.over?.id
    if (card && typeof target === 'string' && (EVERGREEN_STAGES as readonly string[]).includes(target)) {
      move(card, target as EvergreenStage)
    }
  }

  const activeCard = activeId ? local.find(c => c.id === activeId) ?? null : null

  return (
    <section style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12, flexShrink: 0 }}>
        <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
          <Search size={14} aria-hidden style={{ position: 'absolute', left: 11, color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search ads or brands"
            aria-label="Search ads or brands"
            style={{ width: 240, padding: '7px 12px 7px 32px', borderRadius: 20, fontSize: 'var(--text-sm)' }}
          />
        </label>
        <select
          value={brand}
          onChange={e => setBrand(e.target.value)}
          aria-label="Filter by brand"
          style={{ width: 'auto', minWidth: 160, padding: '7px 12px', borderRadius: 20, fontSize: 'var(--text-sm)' }}
        >
          <option value="all">All brands</option>
          {brandOptions.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        {(search || brand !== 'all') && (
          <button type="button" className="btn-secondary btn-sm" onClick={() => { setSearch(''); setBrand('all') }}>
            <X size={12} aria-hidden /> Clear
          </button>
        )}
        <span style={{ flex: 1 }} />
        {canEdit && <NewAdButton brands={brands} />}
      </div>

      {err && (
        <div role="alert" style={{
          display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, padding: '8px 12px', borderRadius: 8, flexShrink: 0,
          background: 'color-mix(in srgb, var(--danger) 10%, var(--surface))',
          border: '1px solid color-mix(in srgb, var(--danger) 35%, transparent)', color: 'var(--text-primary)', fontSize: 'var(--text-sm)',
        }}>
          <span style={{ flex: 1 }}>{err}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setErr('')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={14} aria-hidden />
          </button>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}>
          <div className="kanban-board" style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${EVERGREEN_STAGES.length}, minmax(272px, 1fr))`,
            gridTemplateRows: 'minmax(0, 1fr)',
            gap: 12,
            height: '100%',
            overflowX: 'auto',
            overflowY: 'hidden',
          }}>
            {columns.map(({ stage, cards: colCards }) => (
              <Column
                key={stage}
                stage={stage}
                cards={colCards}
                isOver={overId === stage}
                isDragging={activeId !== null}
                draggedId={activeId}
                onMove={canEdit ? move : undefined}
              />
            ))}
          </div>
          <DragOverlay dropAnimation={null}>
            {activeCard ? (
              <div style={{ transform: 'rotate(1.5deg)', filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.5))' }}>
                <Card card={activeCard} isGhost />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    </section>
  )
}

// ── Column ──────────────────────────────────────────────────────────────────

const Column = memo(function Column({ stage, cards, isOver, isDragging, draggedId, onMove }: {
  stage: EvergreenStage
  cards: EvergreenCard[]
  isOver: boolean
  isDragging: boolean
  draggedId: string | null
  onMove?: (card: EvergreenCard, stage: EvergreenStage) => void
}) {
  const color = EVERGREEN_STAGE_COLORS[stage]
  const { setNodeRef } = useDroppable({ id: stage })
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', minWidth: 0, height: '100%',
      background: isOver ? 'color-mix(in srgb, var(--accent) 6%, var(--surface))' : 'color-mix(in srgb, var(--surface) 45%, var(--background))',
      border: `1px solid ${isOver ? 'color-mix(in srgb, var(--accent) 50%, transparent)' : 'color-mix(in srgb, var(--border) 75%, transparent)'}`,
      borderRadius: 14,
      padding: 8,
      transition: 'background 0.15s, border-color 0.15s',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '7px 8px 13px', flexShrink: 0 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: color.border, boxShadow: `0 0 0 3px color-mix(in srgb, ${color.border} 22%, transparent)`, flexShrink: 0 }} />
          <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: color.text, textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>
            {EVERGREEN_STAGE_LABELS[stage]}
          </span>
        </span>
        <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: color.text, background: color.bg, borderRadius: 12, padding: '1px 8px' }}>
          {cards.length}
        </span>
      </div>

      <div ref={setNodeRef} style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minHeight: 0, overflowY: 'auto', borderRadius: 8, padding: '0 0 4px' }}>
        {isOver && isDragging && (
          <div style={{ height: 80, border: '2px dashed var(--accent)', borderRadius: 10, opacity: 0.5, flexShrink: 0 }} />
        )}
        {cards.length === 0 && !isOver ? (
          <div style={{
            border: '1px dashed color-mix(in srgb, var(--border-strong) 70%, transparent)', borderRadius: 10,
            padding: '30px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12,
          }}>
            Nothing here
          </div>
        ) : (
          cards.filter(c => c.id !== draggedId).map(c => (
            <div key={c.id} style={{ flexShrink: 0 }}>
              <Card card={c} onMove={onMove} />
            </div>
          ))
        )}
      </div>
    </div>
  )
})

// ── Card ────────────────────────────────────────────────────────────────────

const ctrlStyle: React.CSSProperties = {
  width: 20, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: 5, background: 'transparent', border: '1px solid transparent',
  color: 'var(--text-muted)', padding: 0, cursor: 'pointer',
}

function Card({ card, isGhost = false, onMove }: {
  card: EvergreenCard
  isGhost?: boolean
  onMove?: (card: EvergreenCard, stage: EvergreenStage) => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: card.id, disabled: isGhost || !onMove })
  const idx = EVERGREEN_STAGES.indexOf(card.stage)
  const prev = idx > 0 ? EVERGREEN_STAGES[idx - 1] : null
  const next = idx < EVERGREEN_STAGES.length - 1 ? EVERGREEN_STAGES[idx + 1] : null
  const color = EVERGREEN_STAGE_COLORS[card.stage]
  const brandName = card.brands?.name ?? 'Unknown brand'
  const isPriority = !!card.brands?.is_priority

  return (
    <div
      ref={setNodeRef}
      className="kanban-card"
      style={{
        position: 'relative',
        background: isPriority ? 'color-mix(in srgb, #f5b341 3%, var(--surface))' : 'var(--surface)',
        border: `1px solid ${isPriority ? 'color-mix(in srgb, #f5b341 38%, transparent)' : 'var(--border)'}`,
        borderRadius: 12,
        boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
        overflow: 'hidden',
        opacity: isDragging ? 0.35 : 1,
        transform: CSS.Translate.toString(transform),
      }}
    >
      <span aria-hidden style={{ position: 'absolute', left: 0, top: 12, bottom: 12, width: 3, borderRadius: '0 3px 3px 0', background: color.border }} />

      {!isGhost && onMove && (
        <div style={{ position: 'absolute', top: 9, right: 9, display: 'flex', alignItems: 'center', gap: 1, zIndex: 1 }}>
          <div onPointerDown={e => e.stopPropagation()} style={{ display: 'flex', gap: 1 }}>
            <button
              type="button" className="focus-ring-pill kanban-ctrl" style={ctrlStyle}
              aria-label={prev ? `Move to ${EVERGREEN_STAGE_LABELS[prev]}` : 'Already in the first stage'}
              title={prev ? `Move to ${EVERGREEN_STAGE_LABELS[prev]}` : undefined}
              disabled={!prev} onClick={() => prev && onMove(card, prev)}
            >
              <ChevronLeft size={14} strokeWidth={2} aria-hidden />
            </button>
            <button
              type="button" className="focus-ring-pill kanban-ctrl" style={ctrlStyle}
              aria-label={next ? `Move to ${EVERGREEN_STAGE_LABELS[next]}` : 'Already in the last stage'}
              title={next ? `Move to ${EVERGREEN_STAGE_LABELS[next]}` : undefined}
              disabled={!next} onClick={() => next && onMove(card, next)}
            >
              <ChevronRight size={14} strokeWidth={2} aria-hidden />
            </button>
          </div>
          <div
            {...listeners} {...attributes}
            aria-hidden="true" tabIndex={-1} title="Drag to move" className="kanban-ctrl"
            style={{ ...ctrlStyle, cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}
          >
            <GripVertical size={14} strokeWidth={2} aria-hidden />
          </div>
        </div>
      )}

      <Link href={`/evergreen-ads/${card.id}`} style={{ display: 'block', textDecoration: 'none', color: 'inherit', padding: '12px 14px 0 16px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, paddingRight: 68, minWidth: 0 }}>
            <span aria-hidden style={{
              width: 18, height: 18, borderRadius: 5, flexShrink: 0,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)',
              background: 'var(--surface-raised)', border: '1px solid var(--border)',
            }}>
              {(brandName.trim()[0] ?? '?').toUpperCase()}
            </span>
            <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {brandName}
            </span>
            {isPriority && <Star size={11} aria-label="Priority client" style={{ color: '#f5b341', flexShrink: 0 }} fill="#f5b341" />}
          </div>

          <div style={{ fontSize: 14, fontWeight: 650, color: 'var(--text-primary)', lineHeight: 1.35, wordBreak: 'break-word' }}>
            {card.name}
          </div>
        </div>
      </Link>

      {/* Outside the card's Link: the brief chip is a link of its own, and a
          link inside a link is invalid HTML. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: '9px 14px 10px 16px' }}>
        {card.brief_url ? <BriefChip url={card.brief_url} /> : (
          card.stage === 'brief' && (
            <span style={{ ...chip, color: 'var(--text-muted)', borderStyle: 'dashed' }}>
              <FileText size={11} aria-hidden /> No brief link
            </span>
          )
        )}
        <span style={{ ...chip, color: card.videoCount ? 'var(--text-secondary)' : 'var(--text-muted)' }} title={`${card.videoCount} video${card.videoCount === 1 ? '' : 's'}`}>
          <Video size={11} aria-hidden /> {card.videoCount}
        </span>
        {card.client_approved ? (
          <span style={{ ...chip, color: 'var(--success)', borderColor: 'color-mix(in srgb, var(--success) 35%, transparent)', background: 'color-mix(in srgb, var(--success) 10%, transparent)' }}>
            ✓ Client approved
          </span>
        ) : card.changesCount > 0 ? (
          <span style={{ ...chip, color: 'var(--danger)', borderColor: 'color-mix(in srgb, var(--danger) 35%, transparent)', background: 'color-mix(in srgb, var(--danger) 10%, transparent)' }}>
            ↩ {card.changesCount} change{card.changesCount === 1 ? '' : 's'} requested
          </span>
        ) : card.stage === 'client_review' ? (
          <span style={{ ...chip, color: 'var(--warning)', borderColor: 'color-mix(in srgb, var(--warning) 35%, transparent)' }}>
            Waiting on client
          </span>
        ) : null}
      </div>
    </div>
  )
}

const chip: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600,
  border: '1px solid var(--border)', background: 'var(--surface-raised)',
  whiteSpace: 'nowrap', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis',
}

/** The brief link on a card. Its own link, so a click opens the brief, not the card. */
function BriefChip({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={e => e.stopPropagation()}
      onPointerDown={e => e.stopPropagation()}
      title={url}
      style={{ ...chip, color: 'var(--accent)', borderColor: 'color-mix(in srgb, var(--accent) 35%, transparent)', background: 'var(--accent-muted)', textDecoration: 'none' }}
    >
      <FileText size={11} aria-hidden /> {briefLinkLabel(url)} <ExternalLink size={10} aria-hidden />
    </a>
  )
}

// ── New ad ──────────────────────────────────────────────────────────────────

function NewAdButton({ brands }: { brands: BrandOption[] }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const router = useRouter()
  const [brandId, setBrandId] = useState('')
  const [name, setName] = useState('')
  const [briefUrl, setBriefUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function open() {
    setError('')
    dialog.current?.showModal()
  }
  function close() {
    if (busy) return
    dialog.current?.close()
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const r = await createEvergreenAd({ brandId, name, briefUrl })
      if (!r.ok) { setError(r.error); return }
      dialog.current?.close()
      setName('')
      setBriefUrl('')
      router.refresh()
    } catch {
      setError('Could not create the ad. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const field: React.CSSProperties = { display: 'grid', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }
  return (
    <>
      <button type="button" className="btn-primary" onClick={open} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <Plus size={14} aria-hidden /> New evergreen ad
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="evergreen-new-title"
        onCancel={e => { if (busy) e.preventDefault() }}
        style={{
          width: 'min(500px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 40px)', margin: 'auto', position: 'fixed', inset: 0,
          padding: 24, border: '1px solid var(--border)', borderRadius: 16, background: 'var(--surface)', color: 'var(--text-primary)',
        }}
      >
        <form onSubmit={submit} style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
            <h2 id="evergreen-new-title" style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>New evergreen ad</h2>
            <button type="button" aria-label="Close" className="btn-secondary btn-sm" disabled={busy} onClick={close}>
              <X size={14} aria-hidden />
            </button>
          </div>
          <label style={field}>
            Brand
            <select value={brandId} onChange={e => setBrandId(e.target.value)} disabled={busy} required>
              <option value="">Select a brand</option>
              {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <label style={field}>
            Ad name
            <input value={name} onChange={e => setName(e.target.value)} disabled={busy} required maxLength={200} placeholder="e.g. Founder story — 30s" />
          </label>
          <label style={field}>
            Brief link <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional — Google Doc, Drive…)</span>
            <input type="text" inputMode="url" value={briefUrl} onChange={e => setBriefUrl(e.target.value)} disabled={busy} placeholder="https://docs.google.com/…" />
          </label>
          {error && <p role="alert" style={{ margin: 0, color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" className="btn-secondary" disabled={busy} onClick={close}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy || !brands.length}>{busy ? 'Creating…' : 'Create ad'}</button>
          </div>
        </form>
      </dialog>
    </>
  )
}
