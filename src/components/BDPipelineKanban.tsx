'use client'

import { useState, useOptimistic, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import type { Brand, PipelineStatus } from '@/lib/types'
import { PIPELINE_STATUS_LABELS, PIPELINE_STATUS_ORDER } from '@/lib/types'
import { updateBrandPipelineStatus } from '@/lib/actions'

interface BDPipelineKanbanProps {
  brands: Brand[]
  canEdit: boolean
}

const COLUMN_COLORS: Record<PipelineStatus, string> = {
  intro_contact:  'var(--bd-intro)',
  discovery_call: 'var(--bd-discovery)',
  offer_prep:     'var(--bd-offer)',
  active:         'var(--bd-active)',
}

function billingBadge(brand: Brand) {
  if (brand.is_trial) return { label: 'Trial',    color: 'var(--warning)' }
  if (brand.is_active) return { label: 'Active',   color: 'var(--success)' }
  return { label: 'Inactive', color: 'var(--danger)' }
}

function fmtCurrency(n: number) {
  return '$' + n.toLocaleString('en-US')
}

type Move = { id: string; status: PipelineStatus }

export default function BDPipelineKanban({ brands, canEdit }: BDPipelineKanbanProps) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [draggingId, setDraggingId] = useState<string | null>(null)

  const [optimisticBrands, applyMove] = useOptimistic(brands, (current, move: Move) =>
    current.map(b => (b.id === move.id ? { ...b, pipeline_status: move.status } : b))
  )

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
  )

  const columns = PIPELINE_STATUS_ORDER.map(status => ({
    status,
    label: PIPELINE_STATUS_LABELS[status],
    color: COLUMN_COLORS[status],
    items: optimisticBrands.filter(b => b.pipeline_status === status),
  }))

  const activeBrand = draggingId ? optimisticBrands.find(b => b.id === draggingId) ?? null : null

  function handleDragStart(event: DragStartEvent) {
    setDraggingId(String(event.active.id))
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggingId(null)
    const { active, over } = event
    if (!over) return
    const newStatus = String(over.id) as PipelineStatus
    if (!PIPELINE_STATUS_ORDER.includes(newStatus)) return

    const brandId = String(active.id)
    const current = optimisticBrands.find(b => b.id === brandId)
    if (!current || current.pipeline_status === newStatus) return

    startTransition(async () => {
      applyMove({ id: brandId, status: newStatus })
      await updateBrandPipelineStatus(brandId, newStatus)
      router.refresh()
    })
  }

  const content = (
    <div style={{ overflowX: 'auto', margin: '0 -4px' }}>
      <div
        className="bd-kanban-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(220px, 1fr))',
          gap: 12,
          padding: '0 4px',
          minWidth: 900,
        }}
      >
        {columns.map(col => (
          <KanbanColumn
            key={col.status}
            status={col.status}
            label={col.label}
            color={col.color}
            count={col.items.length}
          >
            {col.items.length === 0 ? (
              <div style={{
                textAlign: 'center',
                fontSize: 20,
                color: 'var(--text-muted)',
                padding: '28px 0',
              }}>
                —
              </div>
            ) : (
              col.items.map(brand => (
                <BrandMiniCard
                  key={brand.id}
                  brand={brand}
                  canEdit={canEdit}
                  draggable={canEdit}
                  isDragging={draggingId === brand.id}
                />
              ))
            )}
          </KanbanColumn>
        ))}
      </div>
    </div>
  )

  if (!canEdit) return content

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      {content}
      <DragOverlay>
        {activeBrand ? (
          <BrandMiniCard brand={activeBrand} canEdit={canEdit} draggable={false} isDragging={false} isOverlay />
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

function KanbanColumn({
  status,
  label,
  color,
  count,
  children,
}: {
  status: PipelineStatus
  label: string
  color: string
  count: number
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '0 4px 10px',
      }}>
        <span style={{
          fontSize: 10.5, fontWeight: 700,
          color,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {label}
        </span>
        <span style={{
          fontSize: 10, fontWeight: 700, color,
          background: `color-mix(in srgb, ${color} 14%, transparent)`,
          border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
          padding: '1px 7px',
          borderRadius: 20,
          flexShrink: 0,
        }}>
          {count}
        </span>
      </div>

      <div
        ref={setNodeRef}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          background: 'var(--surface-2)',
          border: `2px solid ${isOver ? `color-mix(in srgb, ${color} 60%, transparent)` : 'transparent'}`,
          borderRadius: 8,
          padding: 8,
          minHeight: 200,
          transition: 'border-color 0.15s',
        }}
      >
        {children}
      </div>
    </div>
  )
}

function BrandMiniCard({
  brand,
  canEdit,
  draggable,
  isDragging,
  isOverlay,
}: {
  brand: Brand
  canEdit: boolean
  draggable: boolean
  isDragging: boolean
  isOverlay?: boolean
}) {
  const billing = billingBadge(brand)
  const mrr = brand.monthly_retainer ?? 0

  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: brand.id,
    disabled: !draggable,
  })

  const cardStyle: React.CSSProperties = {
    background: 'var(--surface-1)',
    border: '0.5px solid var(--border)',
    borderRadius: 8,
    padding: '10px 12px',
    transition: isOverlay ? 'none' : 'border-color 0.12s, background 0.12s',
    opacity: isDragging ? 0.4 : 1,
    cursor: draggable ? (isOverlay ? 'grabbing' : 'grab') : 'pointer',
    transform: CSS.Translate.toString(transform),
    touchAction: 'none',
    boxShadow: isOverlay ? '0 8px 24px rgba(0,0,0,0.5)' : undefined,
  }

  const inner = (
    <>
      <div style={{
        fontSize: 14, fontWeight: 500, color: 'var(--text-primary)',
        marginBottom: 6,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {brand.name}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{
          fontSize: 10, fontWeight: 600,
          color: billing.color,
          background: `color-mix(in srgb, ${billing.color} 14%, transparent)`,
          border: `1px solid color-mix(in srgb, ${billing.color} 30%, transparent)`,
          padding: '1px 7px', borderRadius: 20,
        }}>
          {billing.label}
        </span>
        {canEdit && mrr > 0 && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {fmtCurrency(mrr)} / mo
          </span>
        )}
      </div>
    </>
  )

  if (isOverlay) {
    return <div style={cardStyle}>{inner}</div>
  }

  if (!draggable) {
    return (
      <Link href={`/brands/${brand.id}`} style={{ textDecoration: 'none', display: 'block' }}>
        <div style={cardStyle}>{inner}</div>
      </Link>
    )
  }

  return (
    <div
      ref={setNodeRef}
      style={cardStyle}
      {...listeners}
      {...attributes}
    >
      <Link
        href={`/brands/${brand.id}`}
        onClick={e => {
          // Prevent navigation while dragging.
          if (isDragging) e.preventDefault()
        }}
        style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
      >
        {inner}
      </Link>
    </div>
  )
}
