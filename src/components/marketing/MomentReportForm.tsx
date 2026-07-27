'use client'

import { useState } from 'react'
import ImageUploader from '@/components/ImageUploader'
import type { CampaignFigures } from '@/data/case-studies/types'
import { emptyCampaign, DEFAULT_INDUSTRY, type ReportInputs } from '@/data/case-studies/buildReport'

type UploadedImage = { path: string; url: string; preview: string }

type CreativeRow = {
  images: UploadedImage[]
  revenue: number | null
  roas: number | null
  uniqueOutboundCtr: number | null
}

function urlToImages(url: string | null): UploadedImage[] {
  return url ? [{ path: '', url, preview: url }] : []
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
function Num({ value, onChange, placeholder }: { value: number | null; onChange: (v: number | null) => void; placeholder?: string }) {
  return (
    <input
      type="number"
      inputMode="decimal"
      step="any"
      value={value == null ? '' : value}
      placeholder={placeholder ?? '—'}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      style={inputStyle}
    />
  )
}
function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <h3 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '4px 0 2px' }}>
        {children}
      </h3>
      {hint && <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 4px' }}>{hint}</p>}
    </div>
  )
}

const grid3: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-3)' }
const grid2: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }

// ─── Form ────────────────────────────────────────────────────────────────────

export default function MomentReportForm({
  initial,
  submitting,
  error,
  onSubmit,
  onCancel,
}: {
  initial?: ReportInputs
  submitting: boolean
  error: string | null
  onSubmit: (inputs: ReportInputs) => void
  onCancel: () => void
}) {
  const [campaign, setCampaign] = useState<CampaignFigures>(initial?.campaign ?? emptyCampaign())
  const [industry, setIndustry] = useState(initial?.industry ?? DEFAULT_INDUSTRY)
  const [lpImages, setLpImages] = useState<UploadedImage[]>(urlToImages(initial?.lpImageUrl ?? null))
  const [closingHref, setClosingHref] = useState(initial?.closingHref ?? '')
  const [creatives, setCreatives] = useState<CreativeRow[]>(
    initial?.creatives.length
      ? initial.creatives.map((c) => ({ images: urlToImages(c.posterUrl), revenue: c.revenue, roas: c.roas, uniqueOutboundCtr: c.uniqueOutboundCtr }))
      : [{ images: [], revenue: null, roas: null, uniqueOutboundCtr: null }],
  )

  const setC = (k: keyof CampaignFigures, v: number | null) => setCampaign((c) => ({ ...c, [k]: v ?? 0 }))
  const setCreative = (i: number, patch: Partial<CreativeRow>) =>
    setCreatives((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const addCreative = () => setCreatives((rows) => [...rows, { images: [], revenue: null, roas: null, uniqueOutboundCtr: null }])
  const removeCreative = (i: number) => setCreatives((rows) => rows.filter((_, j) => j !== i))

  function submit(e: React.FormEvent) {
    e.preventDefault()
    onSubmit({
      campaign,
      industry,
      lpImageUrl: lpImages[0]?.url ?? null,
      creatives: creatives.map((r) => ({
        posterUrl: r.images[0]?.url ?? null,
        revenue: r.revenue,
        roas: r.roas,
        uniqueOutboundCtr: r.uniqueOutboundCtr,
      })),
      closingHref: closingHref.trim() || null,
    })
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', marginTop: 'var(--space-4)' }}>
      {/* Campaign figures — the only numbers you type */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <SectionTitle hint="The stat cards, snapshot and comparison bars are all derived from these.">
          Campaign figures
        </SectionTitle>
        <div style={grid3}>
          <Field label="Revenue ($)"><Num value={campaign.revenue} onChange={(v) => setC('revenue', v)} placeholder="56427.61" /></Field>
          <Field label="Purchases"><Num value={campaign.purchases} onChange={(v) => setC('purchases', v)} placeholder="404" /></Field>
          <Field label="Cost per purchase ($)"><Num value={campaign.costPerPurchase} onChange={(v) => setC('costPerPurchase', v)} placeholder="21.74" /></Field>
          <Field label="Blended ROAS"><Num value={campaign.blendedRoas} onChange={(v) => setC('blendedRoas', v)} placeholder="3.08" /></Field>
          <Field label="Incremental ROAS"><Num value={campaign.incrementalRoas} onChange={(v) => setC('incrementalRoas', v)} placeholder="1.61" /></Field>
          <Field label="Incremental ROAS — account avg"><Num value={campaign.incrementalRoasBenchmark} onChange={(v) => setC('incrementalRoasBenchmark', v)} placeholder="1.16" /></Field>
          <Field label="LP conversion rate (%)"><Num value={campaign.lpConversionRate} onChange={(v) => setC('lpConversionRate', v)} placeholder="12.57" /></Field>
          <Field label="LP conversion — account avg (%)"><Num value={campaign.lpConversionBenchmark} onChange={(v) => setC('lpConversionBenchmark', v)} placeholder="6.45" /></Field>
          <Field label="Unique outbound CTR (%)"><Num value={campaign.uniqueOutboundCtr} onChange={(v) => setC('uniqueOutboundCtr', v)} placeholder="3.18" /></Field>
          <Field label="Unique OB CTR — rest of account (%)"><Num value={campaign.uniqueOutboundCtrBenchmark} onChange={(v) => setC('uniqueOutboundCtrBenchmark', v)} placeholder="1.90" /></Field>
          <Field label="Ads in test"><Num value={campaign.adsInTest} onChange={(v) => setC('adsInTest', v)} placeholder="24" /></Field>
          <Field label="Rest of account — ads"><Num value={campaign.restOfAccountAds} onChange={(v) => setC('restOfAccountAds', v)} placeholder="68" /></Field>
          <Field label="Rest of account — revenue ($)"><Num value={campaign.restOfAccountRevenue} onChange={(v) => setC('restOfAccountRevenue', v)} placeholder="31971.63" /></Field>
          <Field label="Industry"><Txt value={industry} onChange={setIndustry} placeholder={DEFAULT_INDUSTRY} /></Field>
        </div>
      </div>

      {/* Landing page image */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <SectionTitle hint="Upload the landing-page screenshot. It renders in a device frame as the LP.">
          Landing page image
        </SectionTitle>
        <ImageUploader value={lpImages} onChange={(imgs) => setLpImages(imgs.slice(-1))} />
      </div>

      {/* Creative examples */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <SectionTitle hint="Example deliverables. Metrics are optional and illustrative — leave blank to show “—”.">
          Creative examples
        </SectionTitle>
        {creatives.map((row, i) => (
          <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <strong style={{ fontSize: 13, color: 'var(--text-primary)' }}>Creative {String(i + 1).padStart(2, '0')}</strong>
              {creatives.length > 1 && (
                <button type="button" onClick={() => removeCreative(i)} className="btn-secondary btn-sm">Remove</button>
              )}
            </div>
            <ImageUploader value={row.images} onChange={(imgs) => setCreative(i, { images: imgs.slice(-1) })} />
            <div style={grid3}>
              <Field label="Revenue ($)"><Num value={row.revenue} onChange={(v) => setCreative(i, { revenue: v })} /></Field>
              <Field label="ROAS"><Num value={row.roas} onChange={(v) => setCreative(i, { roas: v })} /></Field>
              <Field label="Unique OB CTR (%)"><Num value={row.uniqueOutboundCtr} onChange={(v) => setCreative(i, { uniqueOutboundCtr: v })} /></Field>
            </div>
          </div>
        ))}
        <button type="button" onClick={addCreative} className="btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }}>+ Add creative</button>
      </div>

      {/* Closing CTA destination */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <SectionTitle>Closing CTA destination</SectionTitle>
        <div style={grid2}>
          <Field label="Button destination URL"><Txt value={closingHref} onChange={setClosingHref} placeholder="https://…" /></Field>
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
