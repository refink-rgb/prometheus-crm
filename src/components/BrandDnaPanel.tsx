'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { buildBrandDna, buildBrandDnaFromGuideline, uploadBrandLogo, updateBrandDna } from '@/lib/actions'
import { createClient } from '@/lib/supabase/client'
import { GUIDELINE_ACCEPT, MAX_GUIDELINE_BYTES } from '@/lib/ai/brand-guideline'
import type { BrandDna } from '@/lib/types'

// Edit-mode form config — mirrors the read-only sections below. 'list' fields
// render as one-item-per-line textareas; 'color' fields get a live swatch.
type EditKind = 'input' | 'textarea' | 'list' | 'color'
const EDIT_SECTIONS: Array<{ title: string; fields: Array<{ name: string; label: string; kind: EditKind }> }> = [
  { title: 'Prompt Modifier', fields: [
    { name: 'prompt_modifier', label: 'Prompt Modifier (prepended to ad-generation prompts)', kind: 'textarea' },
  ]},
  { title: 'Overview', fields: [
    { name: 'tagline', label: 'Tagline', kind: 'input' },
    { name: 'positioning', label: 'Positioning', kind: 'textarea' },
    { name: 'core_value_prop', label: 'Core Value Prop', kind: 'textarea' },
    { name: 'design_agency', label: 'Design Agency', kind: 'input' },
    { name: 'competitive_differentiation', label: 'Competitive Differentiation', kind: 'textarea' },
    { name: 'voice_adjectives', label: 'Voice Adjectives (one per line)', kind: 'list' },
  ]},
  { title: 'Typography', fields: [
    { name: 'primary_font', label: 'Primary Font', kind: 'input' },
    { name: 'secondary_font', label: 'Secondary Font', kind: 'input' },
    { name: 'headline_weight', label: 'Headline Weight', kind: 'input' },
    { name: 'body_weight', label: 'Body Weight', kind: 'input' },
    { name: 'cta_style', label: 'CTA Style', kind: 'input' },
  ]},
  { title: 'Colors', fields: [
    { name: 'primary_color', label: 'Primary', kind: 'color' },
    { name: 'secondary_color', label: 'Secondary', kind: 'color' },
    { name: 'accent_color', label: 'Accent', kind: 'color' },
    { name: 'contrast_color', label: 'Contrast', kind: 'color' },
    { name: 'background_colors', label: 'Backgrounds (one hex per line)', kind: 'list' },
  ]},
  { title: 'Photography', fields: [
    { name: 'lighting', label: 'Lighting', kind: 'input' },
    { name: 'color_grading', label: 'Color Grading', kind: 'input' },
    { name: 'composition', label: 'Composition', kind: 'input' },
    { name: 'subject_matter', label: 'Subject Matter', kind: 'input' },
    { name: 'props_and_surfaces', label: 'Props & Surfaces', kind: 'input' },
    { name: 'mood', label: 'Mood', kind: 'input' },
  ]},
  { title: 'Packaging', fields: [
    { name: 'packaging_description', label: 'Description', kind: 'textarea' },
    { name: 'packaging_label_placement', label: 'Label Placement', kind: 'input' },
    { name: 'packaging_finish', label: 'Finish', kind: 'input' },
    { name: 'packaging_system', label: 'System', kind: 'input' },
  ]},
  { title: 'Ad Creative Style', fields: [
    { name: 'typical_formats', label: 'Typical Formats', kind: 'input' },
    { name: 'text_overlay_style', label: 'Text Overlay Style', kind: 'input' },
    { name: 'ugc_usage', label: 'UGC Usage', kind: 'input' },
    { name: 'offer_presentation', label: 'Offer Presentation', kind: 'input' },
  ]},
  { title: 'Sales DNA', fields: [
    { name: 'top_pain_points', label: 'Top Pain Points (one per line)', kind: 'list' },
    { name: 'proof_points', label: 'Proof Points (one per line)', kind: 'list' },
    { name: 'common_offers', label: 'Common Offers (one per line)', kind: 'list' },
    { name: 'price_anchor', label: 'Price Anchor', kind: 'input' },
    { name: 'top_objections', label: 'Top Objections (one per line)', kind: 'list' },
    { name: 'winning_hooks', label: 'Winning Hooks (one per line)', kind: 'list' },
  ]},
]

function EditColorInput({ name, label, initial }: { name: string; label: string; initial: string }) {
  const [val, setVal] = useState(initial)
  return (
    <div>
      <label style={{ ...FIELD_LABEL, display: 'block' }}>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          display: 'inline-block', width: 24, height: 24, borderRadius: 5, flexShrink: 0,
          background: looksLikeHex(val) ? val : 'transparent',
          border: '1px solid var(--border)',
        }} />
        <input
          name={name}
          type="text"
          value={val}
          onChange={e => setVal(e.target.value)}
          placeholder="#rrggbb"
          style={{ flex: 1 }}
        />
      </div>
    </div>
  )
}

const CARD_STYLE: React.CSSProperties = { marginBottom: 32 }
const H2_STYLE: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text-muted)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  marginBottom: 20,
}
const SECTION_LABEL: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  marginBottom: 8,
}
const FIELD_LABEL: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-muted)',
  marginBottom: 4,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
}
const FIELD_VALUE: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--text-primary)',
  lineHeight: 1.5,
}

function looksLikeHex(v: string): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim())
}

function ColorSwatch({ value }: { value: string }) {
  const hex = looksLikeHex(value) ? value : null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {hex && (
        <span
          style={{
            display: 'inline-block',
            width: 16,
            height: 16,
            borderRadius: 4,
            background: hex,
            border: '1px solid var(--border)',
            flexShrink: 0,
          }}
        />
      )}
      <span style={FIELD_VALUE}>{value}</span>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div>
      <div style={FIELD_LABEL}>{label}</div>
      <div style={FIELD_VALUE}>{value}</div>
    </div>
  )
}

function ColorField({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div>
      <div style={FIELD_LABEL}>{label}</div>
      <ColorSwatch value={value} />
    </div>
  )
}

function ListField({ label, values }: { label: string; values: string[] | null }) {
  if (!values || values.length === 0) return null
  return (
    <div>
      <div style={FIELD_LABEL}>{label}</div>
      <ul style={{ margin: 0, paddingLeft: 18, ...FIELD_VALUE }}>
        {values.map((v, i) => (
          <li key={i} style={{ marginBottom: 2 }}>{v}</li>
        ))}
      </ul>
    </div>
  )
}

function ColorListField({ label, values }: { label: string; values: string[] | null }) {
  if (!values || values.length === 0) return null
  return (
    <div>
      <div style={FIELD_LABEL}>{label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {values.map((v, i) => <ColorSwatch key={i} value={v} />)}
      </div>
    </div>
  )
}

export default function BrandDnaPanel({ brandId, dna }: { brandId: string; dna: BrandDna | null }) {
  const router = useRouter()
  const [building, setBuilding] = useState(false)
  const [error, setError] = useState('')
  const [showResearch, setShowResearch] = useState(false)
  const [copied, setCopied] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const guidelineRef = useRef<HTMLInputElement | null>(null)
  const [guideline, setGuideline] = useState<File | null>(null)
  const [guidelineStep, setGuidelineStep] = useState('')

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const fd = new FormData(e.currentTarget)
      fd.set('brand_id', brandId)
      const result = await updateBrandDna(fd)
      if (!result.ok) {
        setError(result.error)
      } else {
        setEditing(false)
        router.refresh()
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleBuild() {
    const label = dna ? 'Rebuild Brand DNA?' : 'Build Brand DNA now?'
    if (!confirm(`${label}\n\nThis runs a two-step Gemini research + synthesis pass (30-90s).`)) return
    setBuilding(true)
    setError('')
    try {
      const result = await buildBrandDna(brandId)
      if (!result.ok) {
        setError(result.error)
      } else {
        router.refresh()
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Build failed')
    } finally {
      setBuilding(false)
    }
  }

  // Guideline route: upload to Storage from the browser first, then hand the
  // server action a path. Server actions cap request bodies at 1MB and brand
  // books are far bigger, so the file cannot travel through the action itself.
  async function handleBuildFromGuideline() {
    if (!guideline) return
    if (guideline.size > MAX_GUIDELINE_BYTES) {
      setError(`That file is ${(guideline.size / 1024 / 1024).toFixed(1)}MB — the limit is ${MAX_GUIDELINE_BYTES / 1024 / 1024}MB.`)
      return
    }
    const label = dna ? 'Rebuild Brand DNA from this guideline?' : 'Build Brand DNA from this guideline?'
    if (!confirm(`${label}\n\n${guideline.name}\n\nThis replaces the current version (a new version is created, the old one is kept).`)) return

    setBuilding(true)
    setError('')
    try {
      setGuidelineStep('Uploading document…')
      const supabase = createClient()
      const ext = (guideline.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '')
      const path = `brand-guidelines/${brandId}-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('project-images')
        .upload(path, guideline, { contentType: guideline.type || undefined })
      if (upErr) {
        setError(`Upload failed: ${upErr.message}`)
        return
      }

      setGuidelineStep('Reading the guideline…')
      const result = await buildBrandDnaFromGuideline(brandId, path, guideline.name)
      if (!result.ok) {
        setError(result.error)
      } else {
        setGuideline(null)
        if (guidelineRef.current) guidelineRef.current.value = ''
        router.refresh()
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Build from guideline failed')
    } finally {
      setBuilding(false)
      setGuidelineStep('')
    }
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('brand_id', brandId)
      fd.append('file', file)
      const result = await uploadBrandLogo(fd)
      if (!result.ok) {
        setError(result.error)
      } else {
        router.refresh()
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Logo upload failed')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function copyPromptModifier() {
    if (!dna?.prompt_modifier) return
    try {
      await navigator.clipboard.writeText(dna.prompt_modifier)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="card" style={CARD_STYLE}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 style={{ ...H2_STYLE, marginBottom: 0 }}>
          Brand DNA {dna && <span style={{ color: 'var(--text-muted)', fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>· v{dna.version}</span>}
        </h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {dna && !editing && (
            <button
              onClick={() => setEditing(true)}
              className="btn-secondary"
              style={{ fontSize: 12 }}
            >
              ✎ Edit
            </button>
          )}
          {editing ? (
            <>
              <button
                onClick={() => setEditing(false)}
                disabled={saving}
                className="btn-secondary"
                style={{ fontSize: 12 }}
              >
                Cancel
              </button>
              <button
                type="submit"
                form="dna-edit-form"
                disabled={saving}
                className="btn-primary"
                style={{ fontSize: 12 }}
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </>
          ) : (
            <button
              onClick={handleBuild}
              disabled={building}
              className="btn-primary"
              style={{ fontSize: 12 }}
            >
              {building
                ? <>Generating… <span style={{ fontSize: 10, opacity: 0.7 }}>(~60s)</span></>
                : dna ? '✦ Rebuild' : '✦ Build Brand DNA'}
            </button>
          )}
        </div>
      </div>

      {error && (
        <p style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 16 }}>{error}</p>
      )}

      {/* Logo slot — always available */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24, padding: 16, background: 'var(--surface-raised)', borderRadius: 8, border: '1px solid var(--border)' }}>
        <div style={{
          width: 80, height: 80, borderRadius: 8, overflow: 'hidden',
          background: 'var(--surface)', border: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          {dna?.logo_url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={dna.logo_url} alt="Brand logo" loading="lazy" decoding="async" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          ) : (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>No logo</span>
          )}
        </div>
        <div style={{ flex: 1 }}>
          <div style={SECTION_LABEL}>Logo</div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={handleLogoUpload}
            disabled={uploading}
            style={{ fontSize: 12 }}
          />
          {uploading && <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>Uploading…</p>}
        </div>
      </div>

      {/* Second route in — the brand's own guideline. Hidden while editing so
          the edit form stays the only thing on screen. */}
      {!editing && (
        <div style={{ marginBottom: 24, padding: 16, background: 'var(--surface-raised)', borderRadius: 8, border: '1px solid var(--border)' }}>
          <div style={SECTION_LABEL}>Or build from a brand guideline</div>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 12px' }}>
            Upload the brand book as <strong>PDF, DOCX or PPTX</strong> and the DNA is read from the client&apos;s stated
            specification instead of researched from their website. PDF is the best input — its pages are read
            visually, so colour swatches and type specimens come through. DOCX and PPTX are read as text only.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <input
              ref={guidelineRef}
              type="file"
              accept={GUIDELINE_ACCEPT}
              disabled={building}
              onChange={e => { setGuideline(e.target.files?.[0] ?? null); setError('') }}
              style={{ fontSize: 12 }}
            />
            <button
              onClick={handleBuildFromGuideline}
              disabled={!guideline || building}
              className="btn-primary"
              style={{ fontSize: 12 }}
            >
              {building && guidelineStep
                ? guidelineStep
                : dna ? '✦ Rebuild from guideline' : '✦ Build from guideline'}
            </button>
          </div>
          {guideline && !building && (
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '8px 0 0' }}>
              {guideline.name} · {(guideline.size / 1024 / 1024).toFixed(1)}MB
            </p>
          )}
        </div>
      )}

      {!dna && !building && (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          No Brand DNA yet. Click <strong>Build Brand DNA</strong> to run a two-step Gemini research + synthesis pass from the brand&apos;s website, or upload their brand guideline above to build it from the client&apos;s own document. Either way the result populates the fonts, colors, photography direction, packaging, ad style, and sales angles used to keep future creative on-brand.
        </p>
      )}

      {/* Edit mode — every DNA field as a form input, prefilled. Arrays are
          one-item-per-line textareas; colors show a live swatch. */}
      {dna && editing && (
        <form id="dna-edit-form" onSubmit={handleSave}>
          {EDIT_SECTIONS.map(section => (
            <div key={section.title} style={{ marginBottom: 24 }}>
              <div style={SECTION_LABEL}>{section.title}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
                {section.fields.map(f => {
                  const raw = (dna as unknown as Record<string, unknown>)[f.name]
                  if (f.kind === 'color') {
                    return <EditColorInput key={f.name} name={f.name} label={f.label} initial={(raw as string | null) ?? ''} />
                  }
                  if (f.kind === 'list') {
                    const joined = Array.isArray(raw) ? (raw as string[]).join('\n') : ''
                    return (
                      <div key={f.name}>
                        <label style={{ ...FIELD_LABEL, display: 'block' }}>{f.label}</label>
                        <textarea name={f.name} rows={4} defaultValue={joined} style={{ resize: 'vertical', width: '100%' }} />
                      </div>
                    )
                  }
                  if (f.kind === 'textarea') {
                    return (
                      <div key={f.name} style={{ gridColumn: '1 / -1' }}>
                        <label style={{ ...FIELD_LABEL, display: 'block' }}>{f.label}</label>
                        <textarea name={f.name} rows={3} defaultValue={(raw as string | null) ?? ''} style={{ resize: 'vertical', width: '100%' }} />
                      </div>
                    )
                  }
                  return (
                    <div key={f.name}>
                      <label style={{ ...FIELD_LABEL, display: 'block' }}>{f.label}</label>
                      <input name={f.name} type="text" defaultValue={(raw as string | null) ?? ''} style={{ width: '100%' }} />
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setEditing(false)} disabled={saving} className="btn-secondary" style={{ fontSize: 12 }}>
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-primary" style={{ fontSize: 12 }}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      )}

      {dna && !editing && (
        <>
          {/* Prompt modifier — the payoff */}
          {dna.prompt_modifier && (
            <div style={{ marginBottom: 24, padding: 16, background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={SECTION_LABEL}>Prompt Modifier</div>
                <button
                  onClick={copyPromptModifier}
                  className="btn-secondary"
                  style={{ fontSize: 11, padding: '4px 10px' }}
                >
                  {copied ? 'Copied ✓' : 'Copy'}
                </button>
              </div>
              <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-primary)', margin: 0, whiteSpace: 'pre-wrap' }}>
                {dna.prompt_modifier}
              </p>
            </div>
          )}

          {/* Overview */}
          <div style={{ marginBottom: 24 }}>
            <div style={SECTION_LABEL}>Overview</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
              <Field label="Tagline" value={dna.tagline} />
              <Field label="Positioning" value={dna.positioning} />
              <Field label="Core Value Prop" value={dna.core_value_prop} />
              <Field label="Design Agency" value={dna.design_agency} />
              <Field label="Competitive Differentiation" value={dna.competitive_differentiation} />
              <ListField label="Voice Adjectives" values={dna.voice_adjectives} />
            </div>
          </div>

          {/* Typography */}
          <div style={{ marginBottom: 24 }}>
            <div style={SECTION_LABEL}>Typography</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
              <Field label="Primary Font" value={dna.primary_font} />
              <Field label="Secondary Font" value={dna.secondary_font} />
              <Field label="Headline Weight" value={dna.headline_weight} />
              <Field label="Body Weight" value={dna.body_weight} />
              <Field label="CTA Style" value={dna.cta_style} />
            </div>
          </div>

          {/* Colors */}
          <div style={{ marginBottom: 24 }}>
            <div style={SECTION_LABEL}>Colors</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
              <ColorField label="Primary" value={dna.primary_color} />
              <ColorField label="Secondary" value={dna.secondary_color} />
              <ColorField label="Accent" value={dna.accent_color} />
              <ColorField label="Contrast" value={dna.contrast_color} />
              <ColorListField label="Backgrounds" values={dna.background_colors} />
            </div>
          </div>

          {/* Photography */}
          <div style={{ marginBottom: 24 }}>
            <div style={SECTION_LABEL}>Photography</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
              <Field label="Lighting" value={dna.lighting} />
              <Field label="Color Grading" value={dna.color_grading} />
              <Field label="Composition" value={dna.composition} />
              <Field label="Subject Matter" value={dna.subject_matter} />
              <Field label="Props & Surfaces" value={dna.props_and_surfaces} />
              <Field label="Mood" value={dna.mood} />
            </div>
          </div>

          {/* Packaging */}
          <div style={{ marginBottom: 24 }}>
            <div style={SECTION_LABEL}>Packaging</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
              <Field label="Description" value={dna.packaging_description} />
              <Field label="Label Placement" value={dna.packaging_label_placement} />
              <Field label="Finish" value={dna.packaging_finish} />
              <Field label="System" value={dna.packaging_system} />
            </div>
          </div>

          {/* Ad Creative */}
          <div style={{ marginBottom: 24 }}>
            <div style={SECTION_LABEL}>Ad Creative Style</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
              <Field label="Typical Formats" value={dna.typical_formats} />
              <Field label="Text Overlay Style" value={dna.text_overlay_style} />
              <Field label="UGC Usage" value={dna.ugc_usage} />
              <Field label="Offer Presentation" value={dna.offer_presentation} />
            </div>
          </div>

          {/* Sales DNA */}
          <div style={{ marginBottom: 24 }}>
            <div style={SECTION_LABEL}>Sales DNA</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
              <ListField label="Top Pain Points" values={dna.top_pain_points} />
              <ListField label="Proof Points" values={dna.proof_points} />
              <ListField label="Common Offers" values={dna.common_offers} />
              <Field label="Price Anchor" value={dna.price_anchor} />
              <ListField label="Top Objections" values={dna.top_objections} />
              <ListField label="Winning Hooks" values={dna.winning_hooks} />
            </div>
          </div>

          {/* Research dossier + sources — collapsed by default. Sources live
              inside the expander so the main panel stays free of link clutter. */}
          {(dna.research_markdown || (dna.sources && dna.sources.length > 0)) && (
            <div>
              <button
                onClick={() => setShowResearch(v => !v)}
                className="btn-secondary"
                style={{ fontSize: 12 }}
              >
                {showResearch ? 'Hide' : 'Show'} research dossier & sources
                {dna.sources && dna.sources.length > 0 && !showResearch && (
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> ({dna.sources.length} sources)</span>
                )}
              </button>
              {showResearch && (
                <div style={{
                  marginTop: 12,
                  padding: 16,
                  background: 'var(--surface-raised)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                }}>
                  {dna.research_markdown && (
                    <pre style={{
                      margin: 0,
                      fontSize: 12,
                      lineHeight: 1.6,
                      color: 'var(--text-secondary)',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      fontFamily: 'inherit',
                    }}>
                      {dna.research_markdown}
                    </pre>
                  )}
                  {dna.sources && dna.sources.length > 0 && (
                    <div style={{ marginTop: dna.research_markdown ? 16 : 0, paddingTop: dna.research_markdown ? 16 : 0, borderTop: dna.research_markdown ? '1px solid var(--border)' : 'none' }}>
                      <div style={SECTION_LABEL}>Sources ({dna.sources.length})</div>
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                        {dna.sources.map((s, i) => (
                          <li key={i} style={{ marginBottom: 4 }}>
                            <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-primary)' }}>
                              {s.url}
                            </a>
                            {' — '}
                            <span style={{ color: 'var(--text-muted)' }}>{s.field}</span>
                            {s.note && <span style={{ color: 'var(--text-muted)' }}>: {s.note}</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 20, marginBottom: 0 }}>
            Last updated {new Date(dna.updated_at).toLocaleString()}
          </p>
        </>
      )}
    </div>
  )
}
