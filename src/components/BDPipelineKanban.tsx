import Link from 'next/link'
import type { Brand, PipelineStatus } from '@/lib/types'
import { PIPELINE_STATUS_LABELS, PIPELINE_STATUS_ORDER } from '@/lib/types'

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
  if (brand.is_trial) {
    return { label: 'Trial', color: 'var(--warning)' }
  }
  if (brand.is_active) {
    return { label: 'Active', color: 'var(--success)' }
  }
  return { label: 'Inactive', color: 'var(--danger)' }
}

function fmtCurrency(n: number) {
  return '$' + n.toLocaleString('en-US')
}

export default function BDPipelineKanban({ brands, canEdit }: BDPipelineKanbanProps) {
  const columns = PIPELINE_STATUS_ORDER.map(status => ({
    status,
    label: PIPELINE_STATUS_LABELS[status],
    color: COLUMN_COLORS[status],
    items: brands.filter(b => b.pipeline_status === status),
  }))

  return (
    <div style={{ overflowX: 'auto', margin: '0 -4px' }}>
      <div
        className="bd-kanban-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(180px, 1fr))',
          gap: 12,
          padding: '0 4px',
          minWidth: 720,
        }}
      >
        {columns.map(col => (
          <div key={col.status} style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {/* Column header */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '0 4px 10px',
            }}>
              <span style={{
                fontSize: 10.5,
                fontWeight: 700,
                color: col.color,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {col.label}
              </span>
              <span style={{
                fontSize: 10,
                fontWeight: 700,
                color: col.color,
                background: `color-mix(in srgb, ${col.color} 14%, transparent)`,
                border: `1px solid color-mix(in srgb, ${col.color} 30%, transparent)`,
                padding: '1px 7px',
                borderRadius: 20,
                flexShrink: 0,
              }}>
                {col.items.length}
              </span>
            </div>

            {/* Cards */}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              background: 'var(--surface-2)',
              borderRadius: 8,
              padding: 8,
              minHeight: 120,
            }}>
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
                  <BrandMiniCard key={brand.id} brand={brand} canEdit={canEdit} />
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function BrandMiniCard({ brand, canEdit }: { brand: Brand; canEdit: boolean }) {
  const billing = billingBadge(brand)
  const mrr = brand.monthly_retainer ?? 0
  return (
    <Link href={`/brands/${brand.id}`} style={{ textDecoration: 'none', display: 'block' }}>
      <div style={{
        background: 'var(--surface-1)',
        border: '0.5px solid var(--border)',
        borderRadius: 8,
        padding: '10px 12px',
        transition: 'border-color 0.12s, background 0.12s',
      }}>
        <div style={{
          fontSize: 14,
          fontWeight: 500,
          color: 'var(--text-primary)',
          marginBottom: 6,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {brand.name}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 10,
            fontWeight: 600,
            color: billing.color,
            background: `color-mix(in srgb, ${billing.color} 14%, transparent)`,
            border: `1px solid color-mix(in srgb, ${billing.color} 30%, transparent)`,
            padding: '1px 7px',
            borderRadius: 20,
          }}>
            {billing.label}
          </span>
          {canEdit && mrr > 0 && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {fmtCurrency(mrr)} / mo
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}
