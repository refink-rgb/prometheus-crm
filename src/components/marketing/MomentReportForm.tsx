'use client'

import { useState } from 'react'
import ImageUploader from '@/components/ImageUploader'
import {
  emptyInputs,
  presetSlots,
  FOCUS_OPTIONS,
  DEFAULT_INDUSTRY,
  type FocusKey,
  type ReportInputs,
} from '@/data/case-studies/buildReport'

type UploadedImage = { path: string; url: string; preview: string }

function urlToImages(url: string | null): UploadedImage[] {
  return url ? [{ path: '', url, preview: url }] : []
}

// ─── Inputs ──────────────────────────────────────────────────────────────────

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
function Area({ value, onChange, placeholder, rows = 3 }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return <textarea value={value} placeholder={placeholder} rows={rows} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, resize: 'vertical' }} />
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
function RowShell({ title, onRemove, children }: { title: string; onRemove?: () => void; children: React.ReactNode }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <strong style={{ fontSize: 13, color: 'var(--text-primary)' }}>{title}</strong>
        {onRemove && <button type="button" onClick={onRemove} className="btn-secondary btn-sm">Remove</button>}
      </div>
      {children}
    </div>
  )
}
const AddBtn = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
  <button type="button" onClick={onClick} className="btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }}>{children}</button>
)

const grid2: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }
const grid3: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-3)' }
const col: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }

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
  const [d, setD] = useState<ReportInputs>(() => initial ?? emptyInputs('conversion'))
  const [lpImages, setLpImages] = useState<UploadedImage[]>(urlToImages(initial?.lpImageUrl ?? null))
  const [proofImages, setProofImages] = useState<UploadedImage[]>(urlToImages(initial?.proofImageUrl ?? null))

  const set = (patch: Partial<ReportInputs>) => setD((p) => ({ ...p, ...patch }))

  // Switching focus re-seeds the structural slots but keeps everything the
  // author has already written (hero, narrative, methodology, media).
  function applyFocus(focus: FocusKey) {
    if (!confirmReplaceSlots()) return
    set({ focus, ...presetSlots(focus) })
  }
  function confirmReplaceSlots() {
    const hasContent = d.statCards.some((s) => s.value) || d.snapshotTiles.some((t) => t.value)
    return !hasContent || window.confirm('Replace the stat cards, tiles and comparisons with this focus preset? Values you have typed in those rows will be cleared.')
  }

  // ── row helpers ──
  const upStat = (i: number, patch: Partial<ReportInputs['statCards'][number]>) =>
    set({ statCards: d.statCards.map((s, j) => (j === i ? { ...s, ...patch } : s)) })
  const upTile = (i: number, patch: Partial<ReportInputs['snapshotTiles'][number]>) =>
    set({ snapshotTiles: d.snapshotTiles.map((t, j) => (j === i ? { ...t, ...patch } : t)) })
  const upNarr = (i: number, text: string) =>
    set({ narrative: d.narrative.map((n, j) => (j === i ? { ...n, paragraphs: [text] } : n)) })
  const upCmp = (i: number, patch: Partial<ReportInputs['comparisons'][number]>) =>
    set({ comparisons: d.comparisons.map((c, j) => (j === i ? { ...c, ...patch } : c)) })
  const upCmpSide = (i: number, side: 'campaign' | 'rest', patch: Partial<{ label: string; value: number; display: string }>) =>
    set({ comparisons: d.comparisons.map((c, j) => (j === i ? { ...c, [side]: { ...c[side], ...patch } } : c)) })
  const upCreative = (i: number, patch: Partial<ReportInputs['creatives'][number]>) =>
    set({ creatives: d.creatives.map((c, j) => (j === i ? { ...c, ...patch } : c)) })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    onSubmit({
      ...d,
      lpImageUrl: lpImages[0]?.url ?? null,
      proofImageUrl: proofImages[0]?.url ?? null,
    })
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', marginTop: 'var(--space-4)' }}>
      {/* Focus */}
      <div style={col}>
        <SectionTitle hint="Seeds the stat cards, tiles and comparisons for this angle. Everything stays editable.">
          Focus of this case study
        </SectionTitle>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {FOCUS_OPTIONS.map((f) => (
            <button
              key={f.key}
              type="button"
              title={f.hint}
              onClick={() => applyFocus(f.key)}
              className={d.focus === f.key ? 'btn-primary' : 'btn-secondary'}
              style={{ fontSize: 13, padding: '8px 16px' }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
          {FOCUS_OPTIONS.find((f) => f.key === d.focus)?.hint}
        </p>
      </div>

      {/* Hero */}
      <div style={col}>
        <SectionTitle hint="The framing. This is what a reader sees first.">Hero</SectionTitle>
        <Field label="Headline"><Txt value={d.hero.headline} onChange={(v) => set({ hero: { ...d.hero, headline: v } })} placeholder="It didn’t need cheaper traffic. It needed bigger orders." /></Field>
        <Field label="Subhead"><Area value={d.hero.subhead} onChange={(v) => set({ hero: { ...d.hero, subhead: v } })} placeholder="One line summarising the result" /></Field>
        <div style={grid3}>
          <Field label="Big number"><Txt value={d.hero.statValue} onChange={(v) => set({ hero: { ...d.hero, statValue: v } })} placeholder="$22.7K" /></Field>
          <Field label="Big number caption"><Txt value={d.hero.statCaption} onChange={(v) => set({ hero: { ...d.hero, statCaption: v } })} placeholder="in attributed revenue, from a single bundle moment" /></Field>
          <Field label="Industry"><Txt value={d.industry} onChange={(v) => set({ industry: v })} placeholder={DEFAULT_INDUSTRY} /></Field>
        </div>
      </div>

      {/* Stat cards */}
      <div style={col}>
        <SectionTitle hint="The three headline metrics. Benchmark label is free text: “account average”, “platform target”, “projection”.">
          Headline stat cards
        </SectionTitle>
        {d.statCards.map((s, i) => (
          <RowShell key={i} title={`Stat ${i + 1}`} onRemove={d.statCards.length > 1 ? () => set({ statCards: d.statCards.filter((_, j) => j !== i) }) : undefined}>
            <div style={grid2}>
              <Field label="Metric label"><Txt value={s.label} onChange={(v) => upStat(i, { label: v })} placeholder="Average order value" /></Field>
              <Field label="Value"><Txt value={s.value} onChange={(v) => upStat(i, { value: v })} placeholder="$354.21" /></Field>
            </div>
            <div style={grid3}>
              <Field label="Benchmark value"><Txt value={s.benchmarkValue} onChange={(v) => upStat(i, { benchmarkValue: v })} placeholder="$253.00" /></Field>
              <Field label="Benchmark label"><Txt value={s.benchmarkLabel} onChange={(v) => upStat(i, { benchmarkLabel: v })} placeholder="account average" /></Field>
              <Field label="Multiplier"><Txt value={s.multiplier ?? ''} onChange={(v) => upStat(i, { multiplier: v })} placeholder="~1.4x" /></Field>
            </div>
          </RowShell>
        ))}
        <AddBtn onClick={() => set({ statCards: [...d.statCards, { label: '', value: '', benchmarkValue: '', benchmarkLabel: 'account average', multiplier: '', higherIsBetter: true }] })}>+ Add stat card</AddBtn>
      </div>

      {/* Snapshot tiles */}
      <div style={col}>
        <SectionTitle hint="The “at a glance” band. Values are free text, so any metric works.">Snapshot tiles</SectionTitle>
        {d.snapshotTiles.map((t, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 'var(--space-3)', alignItems: 'end' }}>
            <Field label="Label"><Txt value={t.label} onChange={(v) => upTile(i, { label: v })} placeholder="Purchases" /></Field>
            <Field label="Value"><Txt value={t.value} onChange={(v) => upTile(i, { value: v })} placeholder="64" /></Field>
            <button type="button" onClick={() => set({ snapshotTiles: d.snapshotTiles.filter((_, j) => j !== i) })} className="btn-secondary btn-sm">Remove</button>
          </div>
        ))}
        <AddBtn onClick={() => set({ snapshotTiles: [...d.snapshotTiles, { label: '', value: '' }] })}>+ Add tile</AddBtn>
      </div>

      {/* Proof + LP */}
      <div style={col}>
        <SectionTitle hint="Ad-account screenshot, shown under the headline stats as proof the numbers are real.">Proof screenshot</SectionTitle>
        <ImageUploader value={proofImages} onChange={(imgs) => setProofImages(imgs.slice(-1))} />
      </div>
      <div style={col}>
        <SectionTitle hint="Renders in a device frame as the landing page.">Landing page image</SectionTitle>
        <ImageUploader value={lpImages} onChange={(imgs) => setLpImages(imgs.slice(-1))} />
      </div>

      {/* Narrative */}
      <div style={col}>
        <SectionTitle hint="The four beats. Write them for this campaign’s story.">Narrative</SectionTitle>
        {d.narrative.map((n, i) => (
          <Field key={i} label={n.heading}>
            <Area value={n.paragraphs[0] ?? ''} onChange={(v) => upNarr(i, v)} rows={4} />
          </Field>
        ))}
      </div>

      {/* Creatives */}
      <div style={col}>
        <SectionTitle hint="Example deliverables. Metrics optional and illustrative.">Creative examples</SectionTitle>
        {d.creatives.map((row, i) => (
          <RowShell key={i} title={`Creative ${String(i + 1).padStart(2, '0')}`} onRemove={d.creatives.length > 1 ? () => set({ creatives: d.creatives.filter((_, j) => j !== i) }) : undefined}>
            <ImageUploaderRow url={row.posterUrl} onChange={(url) => upCreative(i, { posterUrl: url })} />
            <div style={grid3}>
              <Field label="Revenue ($)"><Num value={row.revenue} onChange={(v) => upCreative(i, { revenue: v })} /></Field>
              <Field label="ROAS"><Num value={row.roas} onChange={(v) => upCreative(i, { roas: v })} /></Field>
              <Field label="Unique OB CTR (%)"><Num value={row.uniqueOutboundCtr} onChange={(v) => upCreative(i, { uniqueOutboundCtr: v })} /></Field>
            </div>
          </RowShell>
        ))}
        <AddBtn onClick={() => set({ creatives: [...d.creatives, { posterUrl: null, revenue: null, roas: null, uniqueOutboundCtr: null }] })}>+ Add creative</AddBtn>
        <div style={{ maxWidth: 260 }}>
          <Field label="“+N more” card (e.g. 40)"><Num value={d.moreAdsCount} onChange={(v) => set({ moreAdsCount: v })} placeholder="40" /></Field>
        </div>
      </div>

      {/* Comparisons */}
      <div style={col}>
        <SectionTitle hint="Two column charts. The note under each is where the insight goes.">Comparisons</SectionTitle>
        {d.comparisons.map((c, i) => (
          <RowShell key={i} title={`Comparison ${i + 1}`} onRemove={d.comparisons.length > 1 ? () => set({ comparisons: d.comparisons.filter((_, j) => j !== i) }) : undefined}>
            <Field label="Title"><Txt value={c.label} onChange={(v) => upCmp(i, { label: v })} placeholder="Average order value: the moment vs the account" /></Field>
            <div style={grid3}>
              <Field label="Left label"><Txt value={c.campaign.label} onChange={(v) => upCmpSide(i, 'campaign', { label: v })} placeholder="This moment" /></Field>
              <Field label="Left value (number)"><Num value={c.campaign.value} onChange={(v) => upCmpSide(i, 'campaign', { value: v ?? 0 })} placeholder="354.21" /></Field>
              <Field label="Left display"><Txt value={c.campaign.display} onChange={(v) => upCmpSide(i, 'campaign', { display: v })} placeholder="$354.21" /></Field>
              <Field label="Right label"><Txt value={c.rest.label} onChange={(v) => upCmpSide(i, 'rest', { label: v })} placeholder="Account average" /></Field>
              <Field label="Right value (number)"><Num value={c.rest.value} onChange={(v) => upCmpSide(i, 'rest', { value: v ?? 0 })} placeholder="253" /></Field>
              <Field label="Right display"><Txt value={c.rest.display} onChange={(v) => upCmpSide(i, 'rest', { display: v })} placeholder="$253.00" /></Field>
            </div>
            <div style={grid2}>
              <Field label="Multiplier badge"><Txt value={c.multiplier} onChange={(v) => upCmp(i, { multiplier: v })} placeholder="~1.4x" /></Field>
            </div>
            <Field label="Note under the chart"><Area value={c.note ?? ''} onChange={(v) => upCmp(i, { note: v })} placeholder="A $101.21 lift per order, roughly 40%…" /></Field>
          </RowShell>
        ))}
        <AddBtn onClick={() => set({ comparisons: [...d.comparisons, { label: '', campaign: { label: 'This moment', value: 0, display: '' }, rest: { label: 'Account average', value: 0, display: '' }, multiplier: '', note: '' }] })}>+ Add comparison</AddBtn>
      </div>

      {/* Methodology + CTA */}
      <div style={col}>
        <SectionTitle hint="Where the figures come from. Label anything that is blended business reporting rather than platform-attributed.">
          Methodology footnote
        </SectionTitle>
        <Area value={d.methodology ?? ''} onChange={(v) => set({ methodology: v })} rows={4} placeholder="Campaign figures reflect Meta’s default attribution across the N ads in the moment…" />
      </div>
      <div style={col}>
        <SectionTitle>Closing CTA destination</SectionTitle>
        <div style={grid2}>
          <Field label="Button destination URL (blank = Slack DM)"><Txt value={d.closingHref ?? ''} onChange={(v) => set({ closingHref: v || null })} placeholder="https://…" /></Field>
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
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={submitting}>Cancel</button>
      </div>
    </form>
  )
}

// Thin wrapper so each creative row keeps its own uploader state.
function ImageUploaderRow({ url, onChange }: { url: string | null; onChange: (url: string | null) => void }) {
  const [imgs, setImgs] = useState<UploadedImage[]>(urlToImages(url))
  return (
    <ImageUploader
      value={imgs}
      onChange={(next) => {
        const one = next.slice(-1)
        setImgs(one)
        onChange(one[0]?.url ?? null)
      }}
    />
  )
}
