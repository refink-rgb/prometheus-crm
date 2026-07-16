'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { Check, ChevronDown, Copy, X } from 'lucide-react'

/**
 * Inspiration Library — browse the hosted reference-ad library, filter by
 * facets, preview, multi-select, and copy the selected IDs to paste into a
 * creative run. Reads the public index in Supabase Storage directly.
 */

const INDEX_URL =
  'https://mhizyjlvqrhwzjqywiwz.supabase.co/storage/v1/object/public/ad-inspiration/_library/index.json'

interface AdRecord {
  id: string
  file_name: string
  public_url?: string
  industry: string
  brand: string
  ad_archetype: string
  layout_style: string
  color_mood: string
  has_person: boolean
  has_text_overlay: boolean
  text_overlay: string
  tags: string[]
  description: string
  transferable_concept: string
  why_it_works?: string
}

function FacetDropdown({
  label,
  options,
  selected,
  onToggle,
  onClear,
}: {
  label: string
  options: string[]
  selected: string[]
  onToggle: (v: string) => void
  onClear: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg"
        style={{
          background: selected.length ? 'var(--accent-muted)' : 'var(--surface-raised)',
          border: `1px solid ${selected.length ? 'var(--accent)' : 'var(--border)'}`,
          color: selected.length ? 'var(--accent)' : 'var(--text-primary)',
        }}
      >
        {label}
        {selected.length > 0 && <span className="font-semibold">· {selected.length}</span>}
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            className="absolute z-40 mt-1 rounded-lg py-1 max-h-72 overflow-y-auto min-w-48 shadow-xl"
            style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-strong)' }}
          >
            {selected.length > 0 && (
              <button
                onClick={() => { onClear(); setOpen(false) }}
                className="w-full text-left px-3 py-1.5 text-xs"
                style={{ color: 'var(--text-muted)' }}
              >
                Clear {label.toLowerCase()}
              </button>
            )}
            {options.map((opt) => {
              const on = selected.includes(opt)
              return (
                <button
                  key={opt}
                  onClick={() => onToggle(opt)}
                  className="w-full text-left px-3 py-1.5 text-sm flex items-center gap-2"
                  style={{ color: on ? 'var(--accent)' : 'var(--text-primary)' }}
                >
                  <span
                    className="w-3.5 h-3.5 rounded flex items-center justify-center shrink-0"
                    style={{ border: `1px solid ${on ? 'var(--accent)' : 'var(--border-strong)'}`, background: on ? 'var(--accent)' : 'transparent' }}
                  >
                    {on && <Check className="w-2.5 h-2.5" style={{ color: 'var(--background)' }} />}
                  </span>
                  {opt}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

export default function InspirationLibraryPage() {
  const [allAds, setAllAds] = useState<AdRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [industryFilter, setIndustryFilter] = useState<string[]>([])
  const [archetypeFilter, setArchetypeFilter] = useState<string[]>([])
  const [moodFilter, setMoodFilter] = useState<string[]>([])
  const [layoutFilter, setLayoutFilter] = useState<string[]>([])
  const [personFilter, setPersonFilter] = useState<string[]>([]) // 'with person' | 'no person'
  const [search, setSearch] = useState('')

  const [preview, setPreview] = useState<AdRecord | null>(null)
  const [previewIdx, setPreviewIdx] = useState(-1)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch(INDEX_URL)
        const data = (await res.json()) as AdRecord[]
        // Only records whose image is actually hosted.
        setAllAds(data.filter((a) => a.public_url))
      } catch {
        setLoadError('Could not load the library index. Check your connection and refresh.')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const industries = useMemo(
    () => [...new Set(allAds.map((a) => a.industry).filter(Boolean))].sort(),
    [allAds],
  )
  const archetypes = useMemo(
    () => [...new Set(allAds.map((a) => a.ad_archetype).filter(Boolean))].sort(),
    [allAds],
  )
  const moods = useMemo(
    () => [...new Set(allAds.map((a) => a.color_mood).filter(Boolean))].sort(),
    [allAds],
  )
  const layouts = useMemo(
    () => [...new Set(allAds.map((a) => a.layout_style).filter(Boolean))].sort(),
    [allAds],
  )

  const filtered = useMemo(() => {
    let ads = allAds
    if (industryFilter.length) ads = ads.filter((a) => industryFilter.includes(a.industry))
    if (archetypeFilter.length) ads = ads.filter((a) => archetypeFilter.includes(a.ad_archetype))
    if (moodFilter.length) ads = ads.filter((a) => moodFilter.includes(a.color_mood))
    if (layoutFilter.length) ads = ads.filter((a) => layoutFilter.includes(a.layout_style))
    if (personFilter.length === 1) {
      const want = personFilter[0] === 'with person'
      ads = ads.filter((a) => a.has_person === want)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      ads = ads.filter(
        (a) =>
          a.brand?.toLowerCase().includes(q) ||
          a.description?.toLowerCase().includes(q) ||
          a.transferable_concept?.toLowerCase().includes(q) ||
          a.text_overlay?.toLowerCase().includes(q) ||
          a.tags?.some((t) => t.toLowerCase().includes(q)),
      )
    }
    return ads
  }, [allAds, industryFilter, archetypeFilter, moodFilter, layoutFilter, personFilter, search])

  const toggle = useCallback((v: string, cur: string[], set: (x: string[]) => void) => {
    set(cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v])
  }, [])

  function clearAll() {
    setIndustryFilter([]); setArchetypeFilter([]); setMoodFilter([]); setLayoutFilter([]); setPersonFilter([]); setSearch('')
  }

  function toggleSelect(ad: AdRecord) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(ad.id)) next.delete(ad.id)
      else next.add(ad.id)
      return next
    })
  }

  function openPreview(ad: AdRecord) {
    setPreview(ad)
    setPreviewIdx(filtered.findIndex((a) => a.id === ad.id))
  }

  function navPreview(dir: 1 | -1) {
    const i = previewIdx + dir
    if (i < 0 || i >= filtered.length) return
    setPreview(filtered[i])
    setPreviewIdx(i)
  }

  async function copySelection() {
    const line = `inspiration ids: ${[...selectedIds].join(', ')}`
    await navigator.clipboard.writeText(line)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  const hasFilters =
    industryFilter.length || archetypeFilter.length || moodFilter.length || layoutFilter.length || personFilter.length || search

  return (
    <main className="max-w-7xl mx-auto px-4 py-6 pb-28">
      <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Inspiration Library</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            {loading ? 'Loading…' : `${filtered.length} of ${allAds.length} reference ads`}
            {selectedIds.size ? ` · ${selectedIds.size} selected` : ''}
          </p>
        </div>
        <input
          type="text"
          placeholder="Search brand, tags, concept…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="text-sm px-3 py-2 rounded-lg w-64"
          style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
        />
      </div>

      <div className="flex flex-wrap gap-2 items-center mb-5">
        <FacetDropdown label="Industry" options={industries} selected={industryFilter} onToggle={(v) => toggle(v, industryFilter, setIndustryFilter)} onClear={() => setIndustryFilter([])} />
        <FacetDropdown label="Archetype" options={archetypes} selected={archetypeFilter} onToggle={(v) => toggle(v, archetypeFilter, setArchetypeFilter)} onClear={() => setArchetypeFilter([])} />
        <FacetDropdown label="Color mood" options={moods} selected={moodFilter} onToggle={(v) => toggle(v, moodFilter, setMoodFilter)} onClear={() => setMoodFilter([])} />
        <FacetDropdown label="Layout" options={layouts} selected={layoutFilter} onToggle={(v) => toggle(v, layoutFilter, setLayoutFilter)} onClear={() => setLayoutFilter([])} />
        <FacetDropdown label="People" options={['with person', 'no person']} selected={personFilter} onToggle={(v) => toggle(v, personFilter, setPersonFilter)} onClear={() => setPersonFilter([])} />
        {hasFilters ? (
          <button onClick={clearAll} className="text-sm px-3 py-2" style={{ color: 'var(--text-muted)' }}>
            Clear all
          </button>
        ) : null}
      </div>

      {loadError ? (
        <p className="text-sm" style={{ color: 'var(--accent)' }}>{loadError}</p>
      ) : loading ? (
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Loading library…</p>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-lg mb-3">No ads match these filters</p>
          <button onClick={clearAll} className="text-sm underline" style={{ color: 'var(--accent)' }}>
            Clear filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
          {filtered.map((ad) => {
            const sel = selectedIds.has(ad.id)
            return (
              <div
                key={ad.id}
                className="relative aspect-[4/5] rounded overflow-hidden group cursor-pointer"
                style={{ border: `2px solid ${sel ? 'var(--accent)' : 'transparent'}` }}
                onClick={() => openPreview(ad)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={ad.public_url} alt={ad.brand} loading="lazy" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all" />
                <button
                  onClick={(e) => { e.stopPropagation(); toggleSelect(ad) }}
                  className="absolute top-1.5 left-1.5 flex items-center justify-center w-6 h-6 rounded-full"
                  style={{
                    background: sel ? 'var(--accent)' : 'rgba(0,0,0,0.5)',
                    border: `1.5px solid ${sel ? 'var(--accent)' : 'rgba(255,255,255,0.7)'}`,
                  }}
                  title={sel ? 'Remove from selection' : 'Add to selection'}
                >
                  {sel && <Check className="w-3.5 h-3.5" style={{ color: 'var(--background)' }} />}
                </button>
                <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1.5 py-1 translate-y-full group-hover:translate-y-0 transition-transform">
                  <p className="text-white text-[10px] font-medium">{ad.ad_archetype}</p>
                  <p className="text-white/60 text-[10px]">{ad.industry}</p>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Sticky selection bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40" style={{ background: 'var(--surface-raised)', borderTop: '1px solid var(--border-strong)' }}>
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium">{selectedIds.size} selected</span>
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Copy the IDs and paste them into your creative run chat.
            </span>
            <div className="flex-1" />
            <button onClick={copySelection} className="btn-primary text-sm flex items-center gap-1.5">
              <Copy className="w-3.5 h-3.5" />
              {copied ? 'Copied ✓' : `Copy ${selectedIds.size} IDs`}
            </button>
            <button onClick={() => setSelectedIds(new Set())} className="text-sm px-2" style={{ color: 'var(--text-muted)' }}>
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Lightbox preview */}
      {preview && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center" onClick={() => setPreview(null)}>
          <button
            onClick={(e) => { e.stopPropagation(); navPreview(-1) }}
            disabled={previewIdx === 0}
            className="absolute left-4 w-10 h-10 rounded-full bg-white/20 hover:bg-white/30 disabled:opacity-20 text-white text-xl flex items-center justify-center"
          >
            ‹
          </button>
          <div className="flex gap-6 items-start max-w-4xl mx-16 flex-wrap md:flex-nowrap" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview.public_url} alt={preview.brand} className="rounded-lg max-h-[80vh] object-contain" style={{ maxWidth: 420 }} />
            <div className="text-white space-y-3 min-w-60 max-w-72 text-sm">
              <div>
                <p className="text-white/50 text-xs uppercase tracking-wide">Brand</p>
                <p>{preview.brand?.replace(/_/g, ' ')}</p>
              </div>
              <div className="flex gap-4">
                <div>
                  <p className="text-white/50 text-xs uppercase tracking-wide">Archetype</p>
                  <p>{preview.ad_archetype}</p>
                </div>
                <div>
                  <p className="text-white/50 text-xs uppercase tracking-wide">Layout</p>
                  <p>{preview.layout_style}</p>
                </div>
              </div>
              {preview.transferable_concept && (
                <div>
                  <p className="text-white/50 text-xs uppercase tracking-wide">Concept</p>
                  <p className="text-white/85">{preview.transferable_concept}</p>
                </div>
              )}
              <button
                onClick={() => toggleSelect(preview)}
                className="btn-primary text-sm mt-2"
              >
                {selectedIds.has(preview.id) ? '✓ Selected — remove' : 'Add to selection'}
              </button>
            </div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); navPreview(1) }}
            disabled={previewIdx === filtered.length - 1}
            className="absolute right-4 w-10 h-10 rounded-full bg-white/20 hover:bg-white/30 disabled:opacity-20 text-white text-xl flex items-center justify-center"
          >
            ›
          </button>
          <button onClick={() => setPreview(null)} className="absolute top-4 right-4 text-white/70 hover:text-white">
            <X className="w-6 h-6" />
          </button>
        </div>
      )}
    </main>
  )
}
