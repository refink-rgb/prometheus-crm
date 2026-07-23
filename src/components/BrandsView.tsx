'use client'

import { useState, useDeferredValue, useMemo } from 'react'
import Link from 'next/link'
import type { Brand, Project } from '@/lib/types'
import { isProjectOverdue } from '@/lib/stageColors'

type BrandWithProjects = Brand & { projects: Project[] }
type PEGroup = { pe: string; brands: BrandWithProjects[] }
type StatusFilter = 'all' | 'overdue' | 'in_review'

export default function BrandsView({
  allBrands,
  peGroups,
  allPEs,
}: {
  allBrands: BrandWithProjects[]
  peGroups: PEGroup[]
  allPEs: string[]
}) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [pe, setPe] = useState('')
  const deferredSearch = useDeferredValue(search)

  const isFiltered = search.trim() !== '' || pe !== '' || status !== 'all'

  const filteredBrands = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase()
    return allBrands.filter(brand => {
      if (q && !brand.name.toLowerCase().includes(q)) return false
      if (pe && brand.profit_engineer !== pe) return false
      if (status === 'overdue') {
        const hasOverdue = brand.projects.some(p =>
          isProjectOverdue(p.due_date, p.is_complete, p.lp_stage, p.creatives_stage)
        )
        if (!hasOverdue) return false
      }
      if (status === 'in_review') {
        const hasInReview = brand.projects.some(
          p => !p.is_complete && (p.lp_stage === 'client_review' || p.creatives_stage === 'client_review')
        )
        if (!hasInReview) return false
      }
      return true
    })
  }, [allBrands, deferredSearch, status, pe])

  const filteredGroups = useMemo(() => {
    const allowedIds = new Set(filteredBrands.map(b => b.id))
    return peGroups
      .map(g => ({ ...g, brands: g.brands.filter(b => allowedIds.has(b.id)) }))
      .filter(g => g.brands.length > 0)
  }, [peGroups, filteredBrands])

  function clearFilters() {
    setSearch('')
    setStatus('all')
    setPe('')
  }

  const pillBase = {
    padding: '5px 12px', borderRadius: 20, fontSize: 12,
    cursor: 'pointer', transition: 'all 0.15s', border: '1px solid',
  }

  return (
    <>
      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 24, flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Search brands…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: 200, fontSize: 13 }}
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

        {allPEs.length > 0 && (
          <select
            value={pe}
            onChange={e => setPe(e.target.value)}
            style={{ fontSize: 12, padding: '5px 10px', minWidth: 150 }}
          >
            <option value="">All engineers</option>
            {allPEs.map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        )}

        {isFiltered && (
          <button
            onClick={clearFilters}
            style={{
              fontSize: 12, color: 'var(--text-muted)', background: 'none',
              border: 'none', cursor: 'pointer', padding: 0,
            }}
          >
            Clear ✕
          </button>
        )}
      </div>

      {/* Results */}
      {filteredGroups.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-muted)', fontSize: 14 }}>
          No brands match your current filters.
        </div>
      ) : (
        filteredGroups.map((group, gi) => (
          <section key={group.pe} style={{ marginBottom: gi < filteredGroups.length - 1 ? 48 : 0 }}>
            <h2 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 16 }}>
              {group.pe === 'Unassigned' ? 'Unassigned' : `${group.pe}'s Brands`} — {group.brands.length} brand{group.brands.length !== 1 ? 's' : ''}
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
              {group.brands.map(brand => <BrandCard key={brand.id} brand={brand} />)}
            </div>
          </section>
        ))
      )}
    </>
  )
}

function BrandCard({ brand }: { brand: BrandWithProjects }) {
  const activeProjects = brand.projects.filter(p => !p.is_complete)
  const totalProjects = brand.projects.length
  return (
    <Link href={`/brands/${brand.id}`} style={{ textDecoration: 'none' }}>
      <div className="card brand-card" style={{ cursor: 'pointer' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: `hsl(${brand.name.charCodeAt(0) * 7 % 360}, 60%, 25%)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: 18, color: 'white', border: '1px solid var(--border)',
          }}>
            {brand.name.charAt(0).toUpperCase()}
          </div>
          {activeProjects.length > 0 && <span className="badge badge-in_progress">{activeProjects.length} active</span>}
          {activeProjects.length === 0 && totalProjects > 0 && <span className="badge badge-done">all done</span>}
        </div>
        <h3 style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)', marginBottom: 4, letterSpacing: '-0.01em' }}>
          {brand.name}
        </h3>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {brand.website}
        </p>
        {activeProjects.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {activeProjects.slice(0, 2).map(project => <MiniProjectRow key={project.id} project={project} />)}
            {activeProjects.length > 2 && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>+{activeProjects.length - 2} more</p>}
          </div>
        )}
        {totalProjects === 0 && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No projects yet — click to add one</p>}
      </div>
    </Link>
  )
}

function MiniProjectRow({ project }: { project: Project }) {
  const isOverdue = isProjectOverdue(project.due_date, project.is_complete, project.lp_stage, project.creatives_stage)
  return (
    <div style={{ background: 'var(--surface-raised)', borderRadius: 8, padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
        {project.name}
      </span>
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        <MiniDot label="LP" stage={project.lp_stage} />
        <MiniDot label="CR" stage={project.creatives_stage} />
        {isOverdue && <span style={{ fontSize: 10, color: 'var(--danger)', fontWeight: 600 }}>LATE</span>}
      </div>
    </div>
  )
}

function MiniDot({ label, stage }: { label: string; stage: string }) {
  const color =
    stage === 'done'            ? 'var(--success)'  :
    stage === 'live'            ? '#14b8a6'          :
    stage === 'revisions'       ? '#f43f5e'          :
    stage === 'client_review'   ? 'var(--warning)'  :
    stage === 'internal_review' ? '#a855f7'          :
    stage === 'in_progress'     ? 'var(--accent)'   :
    'var(--text-muted)'
  return (
    <span style={{ fontSize: 10, fontWeight: 600, color, background: `color-mix(in srgb, ${color} 15%, transparent)`, padding: '2px 5px', borderRadius: 4 }}>
      {label}
    </span>
  )
}
