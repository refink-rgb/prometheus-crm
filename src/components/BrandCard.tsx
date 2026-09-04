import Link from 'next/link'
import type { Brand, Project } from '@/lib/types'

interface BrandCardProps {
  brand: Brand & {
    projects?: Project[]
    /** Editors on the brand's LATEST project, not every editor it has ever had. */
    editors?: { names: string[]; from: string | null } | null
  }
  canEdit: boolean
}

const AVATAR_COLORS = [
  '#F97316', '#3B82F6', '#10B981', '#8B5CF6',
  '#EC4899', '#F59E0B', '#06B6D4', '#EF4444',
]

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function hashToColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

function fmtCurrency(n: number) {
  return '$' + n.toLocaleString('en-US')
}

export default function BrandCard({ brand, canEdit }: BrandCardProps) {
  const activeCount = (brand.projects ?? []).filter(p => !p.is_complete).length
  const mrr = brand.monthly_retainer ?? 0
  const billing = brand.is_trial
    ? { label: 'Trial',    color: 'var(--warning)' }
    : brand.is_active
      ? { label: 'Active',   color: 'var(--success)' }
      : { label: 'Inactive', color: 'var(--danger)' }
  const avatarColor = hashToColor(brand.name)
  const editors = brand.editors ?? null

  return (
    <Link href={`/brands/${brand.id}`} style={{ textDecoration: 'none', display: 'block' }}>
      <div className="brand-grid-card" style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: 20,
        cursor: 'pointer',
        transition: 'transform 0.15s, border-color 0.15s, box-shadow 0.15s',
      }}>
        <div style={{
          width: 40, height: 40,
          borderRadius: '50%',
          background: avatarColor,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontWeight: 700, fontSize: 14,
          marginBottom: 14,
          letterSpacing: '0.02em',
        }}>
          {initials(brand.name)}
        </div>

        <div style={{
          fontSize: 16, fontWeight: 500, color: 'var(--text-primary)',
          marginBottom: 8, lineHeight: 1.3,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {brand.name}
        </div>

        <span style={{
          display: 'inline-flex',
          fontSize: 10.5, fontWeight: 600,
          color: billing.color,
          background: `color-mix(in srgb, ${billing.color} 14%, transparent)`,
          border: `1px solid color-mix(in srgb, ${billing.color} 30%, transparent)`,
          padding: '2px 10px', borderRadius: 20,
          letterSpacing: '0.02em',
        }}>
          {billing.label}
        </span>

        {/* Who is on this brand. From the latest project only — a union across
            three years of projects names six people and answers nothing. */}
        {editors && editors.names.length > 0 && (
          <div
            title={
              (editors.from ? `Latest project: ${editors.from}\n` : '') +
              `Editors: ${editors.names.join(', ')}`
            }
            style={{
              display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 10,
              fontSize: 11.5, color: 'var(--text-secondary)', minWidth: 0,
            }}
          >
            <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>Editors</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {editors.names.join(' · ')}
            </span>
          </div>
        )}

        <div style={{ height: 1, background: 'var(--border)', margin: '14px 0 12px' }} />

        <div style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          fontSize: 12, color: 'var(--text-muted)', gap: 8,
        }}>
          <span>
            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{activeCount}</span>
            {' '}active project{activeCount === 1 ? '' : 's'}
          </span>
          {canEdit && mrr > 0 && (
            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
              {fmtCurrency(mrr)} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>/ mo</span>
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}
