'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { buildBrandDna, uploadBrandLogo } from '@/lib/actions'
import type { BrandDna } from '@/lib/types'

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

  async function handleBuild() {
    const label = dna ? 'Rebuild Brand DNA?' : 'Build Brand DNA now?'
    if (!confirm(`${label}\n\nThis runs a two-step Gemini research + synthesis pass (30-90s).`)) return
    setBuilding(true)
    setError('')
    try {
      await buildBrandDna(brandId)
      router.refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Build failed')
    } finally {
      setBuilding(false)
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
      await uploadBrandLogo(fd)
      router.refresh()
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

      {!dna && !building && (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          No Brand DNA yet. Click <strong>Build Brand DNA</strong> to run a two-step Gemini research + synthesis pass — the result will populate the fonts, colors, photography direction, packaging, ad style, and sales angles used to keep future creative on-brand.
        </p>
      )}

      {dna && (
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

          {/* Sources */}
          {dna.sources && dna.sources.length > 0 && (
            <div style={{ marginBottom: 24 }}>
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

          {/* Full research markdown */}
          {dna.research_markdown && (
            <div>
              <button
                onClick={() => setShowResearch(v => !v)}
                className="btn-secondary"
                style={{ fontSize: 12 }}
              >
                {showResearch ? 'Hide' : 'Show'} full research dossier
              </button>
              {showResearch && (
                <pre style={{
                  marginTop: 12,
                  padding: 16,
                  background: 'var(--surface-raised)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
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
