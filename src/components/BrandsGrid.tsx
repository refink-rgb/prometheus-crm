'use client'

import { useState, useMemo, useDeferredValue } from 'react'
import type { Brand, Project } from '@/lib/types'
import BrandCard from './BrandCard'

interface BrandsGridProps {
  brands: (Brand & { projects?: Project[] })[]
  canEdit: boolean
}

export default function BrandsGrid({ brands, canEdit }: BrandsGridProps) {
  const [search, setSearch] = useState('')
  const deferred = useDeferredValue(search)

  const filtered = useMemo(() => {
    const q = deferred.trim().toLowerCase()
    const sorted = [...brands].sort((a, b) => a.name.localeCompare(b.name))
    if (!q) return sorted
    return sorted.filter(b => b.name.toLowerCase().includes(q))
  }, [brands, deferred])

  return (
    <>
      <div style={{ marginBottom: 20, maxWidth: 320 }}>
        <input
          type="text"
          placeholder="Search brands…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ fontSize: 13 }}
        />
      </div>

      {filtered.length === 0 ? (
        <div style={{
          padding: '64px 24px',
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontSize: 14,
          background: 'var(--surface-1)',
          border: '1px solid var(--border)',
          borderRadius: 12,
        }}>
          {brands.length === 0
            ? 'No brands yet — click + New Brand to add your first.'
            : `No brands match "${search}".`}
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 16,
        }}>
          {filtered.map(brand => (
            <BrandCard key={brand.id} brand={brand} canEdit={canEdit} />
          ))}
        </div>
      )}
    </>
  )
}
