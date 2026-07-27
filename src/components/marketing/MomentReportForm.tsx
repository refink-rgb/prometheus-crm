'use client'

import { useState } from 'react'
import type { CaseStudy, Creative } from '@/data/case-studies/types'

export type ReportDraft = Omit<CaseStudy, 'slug'>

// ─── Defaults ────────────────────────────────────────────────────────────────
// The form seeds a complete, coherent CaseStudy so one click scaffolds the whole
// report; the editor fills the numbers + copy. Structural bits (stat labels,
// narrative headings, the 5 standard hotspots, comparison labels) are preset.
// Nothing here contains a brand name — the server also relabels creatives and
// blocks generation if the brand leaks in.

function emptyCreative(i: number): Creative {
  return {
    id: `c${i + 1}`,
    label: `Creative ${String(i + 1).padStart(2, '0')}`,
    media: { kind: 'image', poster: { src: null, alt: `Creative ${String(i + 1).padStart(2, '0')} preview` } },
    metrics: {
      impressions: null,
      cpm: null,
      uniqueOutboundCtr: null,
      cpc: null,
      purchases: null,
      revenue: null,
      roas: null,
      costPerPurchase: null,
    },
  }
}

function makeInitial(projectName: string, creativeCount: number): ReportDraft {
  const n = Math.max(1, Math.min(creativeCount || 3, 24))
  return {
    internalTitle: 'Marketing moment report', // internal handle — keep neutral
    publishedAt: new Date().toISOString().slice(0, 10),
    creativesAreFixture: false,
    hero: {
      eyebrow: 'PAID MEDIA CASE STUDY · META',
      headline: '',
      subhead: '',
      stat: { value: '', caption: 'in incremental revenue, from one offer test' },
      meta: [
        { label: 'Industry', value: '' },
        { label: 'Services', value: 'Paid Media (Meta) · Offer Strategy · Creative · Landing Page' },
      ],
    },
    statStrip: [
      { label: 'Landing page conversion rate', value: '', benchmarkValue: '', benchmarkLabel: 'account average', multiplier: '' },
      { label: 'Unique outbound CTR', value: '', benchmarkValue: '', benchmarkLabel: 'rest of account', multiplier: '' },
      { label: 'Incremental ROAS', value: '', benchmarkValue: '', benchmarkLabel: 'account average', multiplier: '' },
    ],
    narrative: [
      { heading: 'The Challenge', paragraphs: [''] },
      { heading: 'The Approach', paragraphs: [''] },
      { heading: 'The Results', paragraphs: [''] },
      { heading: 'The Insight', paragraphs: [''] },
    ],
    landing: {
      image: { src: null, alt: 'Redacted landing page for the offer test', width: 1200, height: 3000 },
      device: 'desktop',
      hotspots: [
        { id: 'price-anchor', number: 1, xPct: 34, yPct: 21, title: 'Strikethrough price anchor', body: '' },
        { id: 'free-shipping', number: 2, xPct: 68, yPct: 30, title: 'Free-shipping call-out', body: '' },
        { id: 'gwp-box', number: 3, xPct: 50, yPct: 48, title: 'Gift-with-purchase box', body: '' },
        { id: 'trust-badge', number: 4, xPct: 24, yPct: 63, title: 'Social-proof / trust badge', body: '' },
        { id: 'offer-selector', number: 5, xPct: 60, yPct: 78, title: 'Offer selector', body: '' },
      ],
    },
    creatives: Array.from({ length: n }, (_, i) => emptyCreative(i)),
    creativeBenchmark: { uniqueOutboundCtr: null, roas: null },
    comparisons: [
      { label: 'Creative performance — unique outbound CTR', campaign: { label: 'This campaign', value: 0, display: '' }, rest: { label: 'Rest of account', value: 0, display: '' }, multiplier: '' },
      { label: 'Revenue efficiency — average revenue per ad', campaign: { label: 'This campaign', value: 0, display: '' }, rest: { label: 'Rest of account', value: 0, display: '' }, multiplier: '' },
    ],
    closing: { headline: 'Want this for your brand?', body: '', buttonLabel: 'Start a marketing moment', href: null },
    campaign: {
      revenue: 0, purchases: 0, costPerPurchase: 0, blendedRoas: 0,
      incrementalRoas: 0, incrementalRoasBenchmark: 0,
      lpConversionRate: 0, lpConversionBenchmark: 0,
      uniqueOutboundCtr: 0, uniqueOutboundCtrBenchmark: 0,
      adsInTest: 0, restOfAccountAds: 0, restOfAccountRevenue: 0,
    },
  }
}

// ─── Small controlled inputs ─────────────────────────────────────────────────

const inputStyle: React.CSSProperties = { fontSize: 13, padding: '8px 10px' }

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', textTransform: 'none', letterSpacing: 0 }}>
      <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </span>
      {children}
    </label>
  )
}

function Txt({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <input type="text" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={inputStyle} />
}

function Area({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <textarea value={value} placeholder={placeholder} rows={3} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, resize: 'vertical' }} />
}

// number|null bound input — empty string → null (renders "—", never invented).
function Num({ value, onChange, placeholder, step }: { value: number | null; onChange: (v: number | null) => void; placeholder?: string; step?: string }) {
  return (
    <input
      type="number"
      inputMode="decimal"
      step={step ?? 'any'}
      value={value == null ? '' : value}
      placeholder={placeholder ?? '—'}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      style={inputStyle}
    />
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '4px 0 2px' }}>
      {children}
    </h3>
  )
}

const grid2: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }
const grid3: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-3)' }

// ─── Form ────────────────────────────────────────────────────────────────────

export default function MomentReportForm({
  projectName,
  creativeCount,
  initial,
  submitting,
  error,
  onSubmit,
  onCancel,
}: {
  projectName: string
  creativeCount: number
  initial?: ReportDraft
  submitting: boolean
  error: string | null
  onSubmit: (draft: ReportDraft) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<ReportDraft>(() => initial ?? makeInitial(projectName, creativeCount))

  // Immutable helpers
  const set = (patch: Partial<ReportDraft>) => setDraft((d) => ({ ...d, ...patch }))
  const setHero = (patch: Partial<ReportDraft['hero']>) => set({ hero: { ...draft.hero, ...patch } })
  const setStat = (i: number, patch: Partial<ReportDraft['statStrip'][number]>) =>
    set({ statStrip: draft.statStrip.map((s, j) => (j === i ? { ...s, ...patch } : s)) })
  const setNarr = (i: number, text: string) =>
    set({ narrative: draft.narrative.map((s, j) => (j === i ? { ...s, paragraphs: [text] } : s)) })
  const setHotspot = (i: number, body: string) =>
    set({ landing: { ...draft.landing, hotspots: draft.landing.hotspots.map((h, j) => (j === i ? { ...h, body } : h)) } })
  const setCreative = (i: number, metric: keyof Creative['metrics'], v: number | null) =>
    set({ creatives: draft.creatives.map((c, j) => (j === i ? { ...c, metrics: { ...c.metrics, [metric]: v } } : c)) })
  const setCmp = (i: number, side: 'campaign' | 'rest', patch: Partial<{ value: number; display: string }>) =>
    set({ comparisons: draft.comparisons.map((c, j) => (j === i ? { ...c, [side]: { ...c[side], ...patch } } : c)) })
  const setCmpMul = (i: number, multiplier: string) =>
    set({ comparisons: draft.comparisons.map((c, j) => (j === i ? { ...c, multiplier } : c)) })
  const setCampaign = (k: keyof ReportDraft['campaign'], v: number) => set({ campaign: { ...draft.campaign, [k]: v } })
  const setClosing = (patch: Partial<ReportDraft['closing']>) => set({ closing: { ...draft.closing, ...patch } })

  const addCreative = () => set({ creatives: [...draft.creatives, emptyCreative(draft.creatives.length)] })
  const removeCreative = (i: number) =>
    set({ creatives: draft.creatives.filter((_, j) => j !== i).map((c, k) => ({ ...c, id: `c${k + 1}`, label: `Creative ${String(k + 1).padStart(2, '0')}` })) })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(draft)
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', marginTop: 'var(--space-4)' }}
    >
      {/* Hero */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <SectionTitle>Hero</SectionTitle>
        <Field label="Headline"><Txt value={draft.hero.headline} onChange={(v) => setHero({ headline: v })} placeholder="One untested offer became this brand's best-converting campaign ever" /></Field>
        <Field label="Subhead"><Area value={draft.hero.subhead} onChange={(v) => setHero({ subhead: v })} placeholder="One line summarizing the result" /></Field>
        <div style={grid2}>
          <Field label="Hero stat (big number)"><Txt value={draft.hero.stat.value} onChange={(v) => setHero({ stat: { ...draft.hero.stat, value: v } })} placeholder="$56.4K" /></Field>
          <Field label="Hero stat caption"><Txt value={draft.hero.stat.caption} onChange={(v) => setHero({ stat: { ...draft.hero.stat, caption: v } })} /></Field>
        </div>
        <div style={grid2}>
          <Field label="Industry"><Txt value={draft.hero.meta[0].value} onChange={(v) => setHero({ meta: [{ ...draft.hero.meta[0], value: v }, draft.hero.meta[1]] })} placeholder="Men's Grooming & Beard Care" /></Field>
          <Field label="Services"><Txt value={draft.hero.meta[1].value} onChange={(v) => setHero({ meta: [draft.hero.meta[0], { ...draft.hero.meta[1], value: v }] })} /></Field>
        </div>
      </div>

      {/* Headline stat strip */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <SectionTitle>Headline stats (test vs benchmark)</SectionTitle>
        {draft.statStrip.map((s, i) => (
          <div key={i} style={grid3}>
            <Field label={`${s.label} — test`}><Txt value={s.value} onChange={(v) => setStat(i, { value: v })} placeholder="12.57%" /></Field>
            <Field label="Benchmark"><Txt value={s.benchmarkValue} onChange={(v) => setStat(i, { benchmarkValue: v })} placeholder="6.45%" /></Field>
            <Field label="Multiplier"><Txt value={s.multiplier ?? ''} onChange={(v) => setStat(i, { multiplier: v })} placeholder="~1.9x" /></Field>
          </div>
        ))}
      </div>

      {/* Campaign figures */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <SectionTitle>Campaign figures</SectionTitle>
        <div style={grid3}>
          <Field label="Revenue ($)"><Num value={draft.campaign.revenue} onChange={(v) => setCampaign('revenue', v ?? 0)} placeholder="56427.61" /></Field>
          <Field label="Purchases"><Num value={draft.campaign.purchases} onChange={(v) => setCampaign('purchases', v ?? 0)} placeholder="404" /></Field>
          <Field label="Cost per purchase ($)"><Num value={draft.campaign.costPerPurchase} onChange={(v) => setCampaign('costPerPurchase', v ?? 0)} placeholder="21.74" /></Field>
          <Field label="Blended ROAS"><Num value={draft.campaign.blendedRoas} onChange={(v) => setCampaign('blendedRoas', v ?? 0)} placeholder="3.08" /></Field>
          <Field label="Ads in test"><Num value={draft.campaign.adsInTest} onChange={(v) => setCampaign('adsInTest', v ?? 0)} placeholder="24" /></Field>
          <Field label="Rest of account — ads"><Num value={draft.campaign.restOfAccountAds} onChange={(v) => setCampaign('restOfAccountAds', v ?? 0)} placeholder="68" /></Field>
          <Field label="Rest of account — revenue ($)"><Num value={draft.campaign.restOfAccountRevenue} onChange={(v) => setCampaign('restOfAccountRevenue', v ?? 0)} placeholder="31971.63" /></Field>
        </div>
      </div>

      {/* Narrative */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <SectionTitle>Narrative</SectionTitle>
        {draft.narrative.map((s, i) => (
          <Field key={i} label={s.heading}><Area value={s.paragraphs[0] ?? ''} onChange={(v) => setNarr(i, v)} /></Field>
        ))}
      </div>

      {/* Landing hotspot callouts (copy only; positions preset) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <SectionTitle>Landing page hotspot callouts</SectionTitle>
        {draft.landing.hotspots.map((h, i) => (
          <Field key={h.id} label={`${h.number}. ${h.title}`}><Area value={h.body} onChange={(v) => setHotspot(i, v)} /></Field>
        ))}
      </div>

      {/* Creatives */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <SectionTitle>Per-creative metrics</SectionTitle>
        <div style={grid2}>
          <Field label="Benchmark — unique outbound CTR (%)"><Num value={draft.creativeBenchmark.uniqueOutboundCtr} onChange={(v) => set({ creativeBenchmark: { ...draft.creativeBenchmark, uniqueOutboundCtr: v } })} placeholder="1.90" /></Field>
          <Field label="Benchmark — ROAS"><Num value={draft.creativeBenchmark.roas} onChange={(v) => set({ creativeBenchmark: { ...draft.creativeBenchmark, roas: v } })} placeholder="1.16" /></Field>
        </div>
        {draft.creatives.map((c, i) => (
          <div key={c.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 'var(--space-3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <strong style={{ fontSize: 13, color: 'var(--text-primary)' }}>{c.label}</strong>
              {draft.creatives.length > 1 && (
                <button type="button" onClick={() => removeCreative(i)} className="btn-secondary btn-sm">Remove</button>
              )}
            </div>
            <div style={grid3}>
              <Field label="Impressions"><Num value={c.metrics.impressions} onChange={(v) => setCreative(i, 'impressions', v)} /></Field>
              <Field label="CPM ($)"><Num value={c.metrics.cpm} onChange={(v) => setCreative(i, 'cpm', v)} /></Field>
              <Field label="Unique OB CTR (%)"><Num value={c.metrics.uniqueOutboundCtr} onChange={(v) => setCreative(i, 'uniqueOutboundCtr', v)} /></Field>
              <Field label="CPC ($)"><Num value={c.metrics.cpc} onChange={(v) => setCreative(i, 'cpc', v)} /></Field>
              <Field label="Purchases"><Num value={c.metrics.purchases} onChange={(v) => setCreative(i, 'purchases', v)} /></Field>
              <Field label="Revenue ($)"><Num value={c.metrics.revenue} onChange={(v) => setCreative(i, 'revenue', v)} /></Field>
              <Field label="ROAS"><Num value={c.metrics.roas} onChange={(v) => setCreative(i, 'roas', v)} /></Field>
              <Field label="Cost / purchase ($)"><Num value={c.metrics.costPerPurchase} onChange={(v) => setCreative(i, 'costPerPurchase', v)} /></Field>
            </div>
          </div>
        ))}
        <button type="button" onClick={addCreative} className="btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }}>+ Add creative</button>
      </div>

      {/* Comparisons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <SectionTitle>Comparison bars</SectionTitle>
        {draft.comparisons.map((c, i) => (
          <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 'var(--space-3)' }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>{c.label}</div>
            <div style={grid3}>
              <Field label="This campaign — value"><Num value={c.campaign.value} onChange={(v) => setCmp(i, 'campaign', { value: v ?? 0 })} /></Field>
              <Field label="This campaign — display"><Txt value={c.campaign.display} onChange={(v) => setCmp(i, 'campaign', { display: v })} placeholder="3.18%" /></Field>
              <Field label="Multiplier"><Txt value={c.multiplier} onChange={(v) => setCmpMul(i, v)} placeholder="~1.7x" /></Field>
              <Field label="Rest of account — value"><Num value={c.rest.value} onChange={(v) => setCmp(i, 'rest', { value: v ?? 0 })} /></Field>
              <Field label="Rest of account — display"><Txt value={c.rest.display} onChange={(v) => setCmp(i, 'rest', { display: v })} placeholder="1.90%" /></Field>
            </div>
          </div>
        ))}
      </div>

      {/* Closing */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <SectionTitle>Closing CTA</SectionTitle>
        <Field label="Headline"><Txt value={draft.closing.headline} onChange={(v) => setClosing({ headline: v })} /></Field>
        <Field label="Body"><Area value={draft.closing.body} onChange={(v) => setClosing({ body: v })} /></Field>
        <div style={grid2}>
          <Field label="Button label"><Txt value={draft.closing.buttonLabel} onChange={(v) => setClosing({ buttonLabel: v })} /></Field>
          <Field label="Button destination URL"><Txt value={draft.closing.href ?? ''} onChange={(v) => setClosing({ href: v || null })} placeholder="https://…" /></Field>
        </div>
      </div>

      {error && (
        <div style={{ color: 'var(--danger)', fontSize: 13, background: 'color-mix(in srgb, var(--danger) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--danger) 25%, transparent)', borderRadius: 8, padding: 'var(--space-3)' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? 'Generating…' : 'Generate report'}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
      </div>
    </form>
  )
}
