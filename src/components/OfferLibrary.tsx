'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  offerMonthLabel,
  profileName,
  type Profile,
} from '@/lib/types'
import { OFFER_STAGE_COLORS } from '@/lib/stageColors'
import type { OfferHistoryEntry } from '@/lib/offer-history'
import { offerLibraryMarkdown } from '@/lib/markdown-export'
import MarkdownActions from './MarkdownActions'

type StatusFilter = 'all' | 'approved' | 'active' | 'production'

export default function OfferLibrary({
  entries,
  assignees,
  currentOfferId,
  compact = false,
}: {
  entries: OfferHistoryEntry[]
  assignees: Profile[]
  currentOfferId?: string
  compact?: boolean
}) {
  const [search, setSearch] = useState('')
  const [brandId, setBrandId] = useState('all')
  const [status, setStatus] = useState<StatusFilter>('all')

  const ownersById = useMemo(() => new Map(assignees.map(p => [p.id, profileName(p)])), [assignees])
  const brands = useMemo(() => {
    const unique = new Map(entries.map(entry => [entry.brandId, entry.brandName]))
    return [...unique.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [entries])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return entries.filter(entry => {
      if (brandId !== 'all' && entry.brandId !== brandId) return false
      if (query) {
        const haystack = [entry.brandName, entry.title, entry.description, entry.objective, entry.mechanics, entry.product, entry.pageType]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(query)) return false
      }
      if (status === 'approved' && entry.offerStage !== 'offer_approved') return false
      if (status === 'active' && (!entry.offerStage || entry.offerStage === 'offer_approved')) return false
      if (status === 'production' && entry.source !== 'legacy_production') return false
      return true
    })
  }, [entries, search, brandId, status])

  function filterNote(): string | undefined {
    const parts: string[] = []
    if (brandId !== 'all') parts.push(`brand ${brands.find(([id]) => id === brandId)?.[1] ?? brandId}`)
    if (search.trim()) parts.push(`search "${search.trim()}"`)
    if (status !== 'all') parts.push(`${status} only`)
    return parts.length ? `filtered: ${parts.join(', ')}` : undefined
  }

  const offerCycleCount = entries.filter(entry => entry.source === 'offer_cycle').length
  const legacyCount = entries.length - offerCycleCount
  const approvedCount = entries.filter(entry => entry.offerStage === 'offer_approved').length
  const brandCount = new Set(entries.map(entry => entry.brandId)).size

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, gap: 16 }}>
      {!compact && (
        <div className="offer-library-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(140px, 1fr))', gap: 10 }}>
          <LibraryStat label="All offers" value={entries.length} hint="across every source" />
          <LibraryStat label="Brands" value={brandCount} hint="searchable in one place" />
          <LibraryStat label="Approved" value={approvedCount} hint="Offer Cycle records" />
          <LibraryStat label="Historical coverage" value={legacyCount} hint={`legacy + ${offerCycleCount} cycle`} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="search"
          value={search}
          onChange={event => setSearch(event.target.value)}
          placeholder="Search brand, offer, product…"
          aria-label="Search offer history"
          style={{ width: compact ? 250 : 290, fontSize: 'var(--text-base)' }}
        />
        {!compact && brands.length > 1 && (
          <select
            value={brandId}
            onChange={event => setBrandId(event.target.value)}
            aria-label="Filter offer history by brand"
            style={{ width: 'auto', minWidth: 180, fontSize: 'var(--text-sm)' }}
          >
            <option value="all">All brands</option>
            {brands.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        )}
        <select
          value={status}
          onChange={event => setStatus(event.target.value as StatusFilter)}
          aria-label="Filter offer history by status"
          style={{ width: 'auto', minWidth: 150, fontSize: 'var(--text-sm)' }}
        >
          <option value="all">All records</option>
          <option value="active">Active pipeline</option>
          <option value="approved">Approved offers</option>
          <option value="production">Legacy production</option>
        </select>
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
          {filtered.length}{filtered.length !== entries.length ? ` of ${entries.length}` : ''} offer{filtered.length === 1 ? '' : 's'}
        </span>
        {filtered.length > 0 && (
          <MarkdownActions
            markdown={() => offerLibraryMarkdown(filtered, filterNote())}
            filename={brandId === 'all' ? 'offer-library' : `${brands.find(([id]) => id === brandId)?.[1] ?? 'brand'}-offer-history`}
            copyLabel="Copy library"
            style={{ marginLeft: 'auto' }}
          />
        )}
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="offer-library-table" style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 900 }}>
            <div style={{
              display: 'grid', gridTemplateColumns: compact ? '132px minmax(260px, 1.6fr) minmax(150px, .8fr) 132px 100px' : '150px minmax(280px, 1.7fr) minmax(160px, .8fr) 145px 120px 110px',
              gap: 16, padding: '10px 16px', borderBottom: '1px solid var(--border)',
              color: 'var(--text-muted)', fontSize: 'var(--text-2xs)', fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.08em',
            }}>
              <span>Moment</span>
              <span>Offer</span>
              <span>Product</span>
              <span>Status</span>
              {!compact && <span>Owner</span>}
              <span>Source</span>
            </div>

            {filtered.length === 0 ? (
              <div style={{ padding: '48px 24px', textAlign: 'center' }}>
                <p style={{ color: 'var(--text-primary)', fontSize: 'var(--text-base)', fontWeight: 600, marginBottom: 6 }}>No offers match these filters</p>
                <button
                  type="button"
                  onClick={() => { setSearch(''); setBrandId('all'); setStatus('all') }}
                  style={{ border: 0, background: 'transparent', color: 'var(--accent)', cursor: 'pointer', fontSize: 'var(--text-sm)' }}
                >
                  Clear filters
                </button>
              </div>
            ) : filtered.map(entry => {
              const active = entry.id === currentOfferId && entry.source === 'offer_cycle'
              const color = entry.offerStage ? OFFER_STAGE_COLORS[entry.offerStage] : null
              return (
                <div
                  key={entry.key}
                  className="pipeline-row"
                  style={{
                    display: 'grid', gridTemplateColumns: compact ? '132px minmax(260px, 1.6fr) minmax(150px, .8fr) 132px 100px' : '150px minmax(280px, 1.7fr) minmax(160px, .8fr) 145px 120px 110px',
                    gap: 16, alignItems: 'center', padding: '13px 16px', borderBottom: '1px solid var(--border)',
                    background: active ? 'var(--accent-muted)' : undefined,
                  }}
                >
                  <div>
                    {!compact && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginBottom: 3 }}>{entry.brandName}</div>}
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)', fontWeight: 600 }}>
                      {offerMonthLabel(entry.targetMonth)}{entry.momentSlot ? ` · M${entry.momentSlot}` : ''}
                    </div>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <Link href={entry.href} style={{ color: 'var(--text-primary)', fontSize: 'var(--text-base)', fontWeight: 650, textDecoration: 'none', lineHeight: 1.35 }}>
                      {entry.title}
                    </Link>
                    {entry.objective && (
                      <div
                        title={entry.objective}
                        style={{
                          fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.4,
                          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                        }}
                      >
                        {entry.objective}
                      </div>
                    )}
                    {(entry.mechanics || entry.pageType) && (
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {[entry.mechanics, entry.pageType].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 'var(--text-sm)', color: entry.product ? 'var(--text-secondary)' : 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {entry.product ?? 'Not captured'}
                    </div>
                    {entry.retailPrice && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 3 }}>{entry.retailPrice}</div>}
                  </div>
                  <div>
                    <span style={{
                      display: 'inline-flex', padding: '3px 8px', borderRadius: 20,
                      fontSize: 'var(--text-2xs)', fontWeight: 700, whiteSpace: 'nowrap',
                      color: color?.text ?? 'var(--text-secondary)',
                      background: color?.bg ?? 'var(--surface-raised)',
                      border: `1px solid ${color?.border ?? 'var(--border)'}`,
                    }}>
                      {entry.status}
                    </span>
                  </div>
                  {!compact && (
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                      {entry.ownerId ? ownersById.get(entry.ownerId) ?? 'Off roster' : '—'}
                    </span>
                  )}
                  <div>
                    <span style={{ fontSize: 'var(--text-2xs)', color: entry.source === 'offer_cycle' ? 'var(--accent)' : 'var(--text-muted)', fontWeight: 600 }}>
                      {entry.source === 'offer_cycle' ? 'Offer Cycle' : 'Production'}
                    </span>
                    {entry.productionHref && entry.source === 'offer_cycle' && (
                      <div style={{ marginTop: 4 }}>
                        <Link href={entry.productionHref} style={{ fontSize: 'var(--text-2xs)', color: 'var(--success)', textDecoration: 'none' }}>
                          Open production →
                        </Link>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function LibraryStat({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <div style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', marginTop: 5 }}>{value}</div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 2 }}>{hint}</div>
    </div>
  )
}
