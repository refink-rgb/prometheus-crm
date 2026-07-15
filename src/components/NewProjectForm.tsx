'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import ImageUploader from '@/components/ImageUploader'
import Spinner from '@/components/Spinner'
import { createProject } from '@/lib/actions'
import EditorPicker from '@/components/EditorPicker'
import { PAGE_TYPE_OPTIONS, editorsFor } from '@/lib/types'
import type { Journey, Profile } from '@/lib/types'

interface UploadedImage {
  path: string
  url: string
  preview: string
}

const OFFER_DYNAMICS_OPTIONS = [
  'BOGO',
  'GWP',
  'Buy X Get Y',
  'Flat Discount',
  'Tiered Discount',
  'Other',
] as const

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: 'var(--space-6)',
      marginBottom: 'var(--space-4)',
    }}>
      <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: subtitle ? 'var(--space-1)' : 'var(--space-5)' }}>
        {title}
      </h2>
      {subtitle && (
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginBottom: 'var(--space-5)' }}>{subtitle}</p>
      )}
      {children}
    </div>
  )
}

function Field({ label, optional, children }: { label: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 'var(--space-4)' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
        <span>{label}</span>
        {optional && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>optional</span>}
      </label>
      {children}
    </div>
  )
}

function CopyBank({
  name,
  count,
  placeholderPrefix,
  values,
  onChange,
}: {
  name: string
  count: number
  placeholderPrefix: string
  values: string[]
  onChange: (next: string[]) => void
}) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <input
          key={i}
          type="text"
          value={values[i] ?? ''}
          onChange={e => {
            const next = [...values]
            next[i] = e.target.value
            onChange(next)
          }}
          placeholder={`${placeholderPrefix} ${i + 1}`}
          style={{ marginBottom: 8 }}
        />
      ))}
      {/* Hidden field carrying JSON-encoded bank into FormData for the server action. */}
      <input type="hidden" name={name} value={JSON.stringify(values)} />
    </>
  )
}

export default function NewProjectForm({
  brandId,
  journeys,
  profiles,
}: {
  brandId: string
  journeys: Journey[]
  profiles: Profile[]
}) {
  const router = useRouter()

  const [images, setImages] = useState<UploadedImage[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const [headlines, setHeadlines] = useState<string[]>(Array(5).fill(''))
  const [subcopies, setSubcopies] = useState<string[]>(Array(5).fill(''))
  const [eyebrows, setEyebrows]  = useState<string[]>(Array(3).fill(''))

  // Journey state
  const [journeyMode, setJourneyMode] = useState<'existing' | 'new'>(
    journeys.length > 0 ? 'existing' : 'new'
  )
  const [selectedJourneyId, setSelectedJourneyId] = useState(journeys[0]?.id ?? '')
  const [newJourneyName, setNewJourneyName] = useState('')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    setError('')

    const fd = new FormData(e.currentTarget)
    fd.set('brand_id', brandId)
    fd.set('image_urls', JSON.stringify(images.map(({ path, url }) => ({ path, url }))))

    if (journeyMode === 'existing') {
      fd.set('journey_id', selectedJourneyId)
      fd.delete('new_journey_name')
    } else {
      fd.delete('journey_id')
      fd.set('new_journey_name', newJourneyName)
    }

    try {
      const result = await createProject(fd)
      router.push(result.redirect)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)' }}>
      {/* Top bar */}
      <div style={{
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        padding: '0 24px',
        height: 56,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Link href={`/brands/${brandId}`} style={{ color: 'var(--text-muted)', fontSize: 13, textDecoration: 'none' }}>
            ← Back
          </Link>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>New Marketing Moment</span>
        </div>
        <button
          type="submit"
          form="project-form"
          className="btn-primary"
          disabled={submitting}
          aria-live="polite"
          style={{ padding: '8px 20px' }}
        >
          {submitting ? <><Spinner size="sm" /> Submitting…</> : '🚀 Submit project'}
        </button>
      </div>

      <main style={{ maxWidth: 720, margin: '0 auto', padding: '32px 24px 80px' }}>
        <form
          id="project-form"
          onSubmit={handleSubmit}
          onKeyDown={e => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              e.currentTarget.requestSubmit()
            }
          }}
        >

          {/* Basics */}
          <Section title="Basics">
            <div className="form-grid-2" style={{ marginBottom: 'var(--space-1)' }}>
              <Field label="Marketing moment name *">
                <input name="name" type="text" placeholder="e.g. Memorial Day Sale 2025" required autoFocus />
              </Field>
              <Field label="Launch date (Live) *">
                <input name="due_date" type="date" required />
              </Field>
            </div>

            {/* Journey selection */}
            <div style={{ marginBottom: 18 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <span>Journey</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>optional</span>
              </label>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                {journeys.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setJourneyMode('existing')}
                    style={{
                      padding: '6px 14px', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontWeight: 500,
                      border: `1px solid ${journeyMode === 'existing' ? 'var(--accent)' : 'var(--border)'}`,
                      background: journeyMode === 'existing' ? 'var(--accent-muted)' : 'transparent',
                      color: journeyMode === 'existing' ? 'var(--accent)' : 'var(--text-secondary)',
                    }}
                  >
                    Use existing
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setJourneyMode('new')}
                  style={{
                    padding: '6px 14px', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontWeight: 500,
                    border: `1px solid ${journeyMode === 'new' ? 'var(--accent)' : 'var(--border)'}`,
                    background: journeyMode === 'new' ? 'var(--accent-muted)' : 'transparent',
                    color: journeyMode === 'new' ? 'var(--accent)' : 'var(--text-secondary)',
                  }}
                >
                  + New journey
                </button>
              </div>

              {journeyMode === 'existing' && journeys.length > 0 && (
                <select
                  value={selectedJourneyId}
                  onChange={e => setSelectedJourneyId(e.target.value)}
                  style={{ width: '100%' }}
                >
                  {journeys.map(j => (
                    <option key={j.id} value={j.id}>{j.name}</option>
                  ))}
                </select>
              )}

              {journeyMode === 'new' && (
                <input
                  type="text"
                  placeholder="e.g. June 2025"
                  value={newJourneyName}
                  onChange={e => setNewJourneyName(e.target.value)}
                />
              )}
            </div>

            {/* Marketing moment */}
            <Field label="Marketing Moment" optional>
              <div style={{ display: 'flex', gap: 8 }}>
                {([1, 2] as const).map(m => (
                  <label key={m} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 16px', borderRadius: 8, cursor: 'pointer',
                    border: '1px solid var(--border)',
                    background: 'transparent',
                    fontSize: 13, fontWeight: 500,
                    color: 'var(--text-secondary)',
                    letterSpacing: 0, textTransform: 'none', marginBottom: 0,
                  }}>
                    <input type="radio" name="marketing_moment" value={String(m)} style={{ width: 'auto', padding: 0 }} />
                    Moment {m} {m === 1 ? '(1st half)' : '(2nd half)'}
                  </label>
                ))}
              </div>
            </Field>

            {/* Editors — one per track, mirroring the LP / Creatives split */}
            <Field label="LP editor" optional>
              <EditorPicker
                mode="form"
                track="lp"
                fieldName="lp_editor_id"
                options={editorsFor(profiles, 'is_lp_editor')}
                current={null}
              />
            </Field>
            <Field label="Creative editor" optional>
              <EditorPicker
                mode="form"
                track="creative"
                fieldName="creative_editor_id"
                options={editorsFor(profiles, 'is_creative_editor')}
                current={null}
              />
            </Field>
          </Section>

          {/* Stage timeline */}
          <Section title="Stage timeline" subtitle="Target dates per phase — informational, not enforced. All optional.">
            <div className="form-grid-2">
              <Field label="Brief due" optional>
                <input name="stage_brief_due_date" type="date" />
              </Field>
              <Field label="In Progress due" optional>
                <input name="stage_in_progress_due_date" type="date" />
              </Field>
              <Field label="Internal Review due" optional>
                <input name="stage_internal_review_due_date" type="date" />
              </Field>
              <Field label="Client Review due" optional>
                <input name="stage_client_review_due_date" type="date" />
              </Field>
            </div>
          </Section>

          {/* Shared Core Brief */}
          <Section title="Shared brief" subtitle="Used by both LP and Creatives. Brand DNA is read from the brand's Account Notes.">
            <Field label="Offer / Promo" optional>
              <select name="offer_dynamics_type" defaultValue="" style={{ marginBottom: 8 }}>
                <option value="">Select offer type…</option>
                {OFFER_DYNAMICS_OPTIONS.map(o => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
              <input name="offer" type="text" placeholder="Details — e.g. Buy 2 Get 1 Free, 20% off orders $75+, GWP with any $50 order" />
            </Field>
            <Field label="Offer overview" optional>
              <textarea
                name="offer_description"
                rows={4}
                placeholder="What is the offer? Who are we targeting? What's the key buying motivation?"
                style={{ resize: 'vertical' }}
              />
            </Field>

            <Field label="Hero headline" optional>
              <input name="headline" type="text" placeholder="The main hook for this moment" />
            </Field>
            <Field label="Body copy" optional>
              <textarea name="body_copy" rows={3} placeholder="Key claims, product benefits, supporting proof…" style={{ resize: 'vertical' }} />
            </Field>
            <Field label="Supporting message" optional>
              <textarea name="supporting_message" rows={2} placeholder="Secondary line, urgency cue, or subtext…" style={{ resize: 'vertical' }} />
            </Field>
            <Field label="Call to action" optional>
              <input name="cta" type="text" placeholder="e.g. Shop Now, Claim Your Deal" />
            </Field>

            <Field label="Product name" optional>
              <input
                name="product_featured"
                type="text"
                placeholder="e.g. Viking Beard Oil 3-Pack, Summer Collection"
              />
            </Field>
            <Field label="Product description" optional>
              <textarea
                name="product_description"
                rows={2}
                placeholder="What the product is, key ingredients, benefits, or specs…"
                style={{ resize: 'vertical' }}
              />
            </Field>
          </Section>

          {/* LP-only */}
          <Section title="LP-only" subtitle="Fields specific to the landing page.">
            <Field label="Page type" optional>
              <select name="page_type" defaultValue="">
                <option value="">Select page type…</option>
                {PAGE_TYPE_OPTIONS.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </Field>
          </Section>

          {/* Creatives-only */}
          <Section title="Creatives-only" subtitle="Fields specific to ad creatives.">
            <Field label="Headlines (5 variations)" optional>
              <CopyBank name="ad_headlines" count={5} placeholderPrefix="Headline" values={headlines} onChange={setHeadlines} />
            </Field>
            <Field label="Subcopy (5 variations)" optional>
              <CopyBank name="ad_subcopies" count={5} placeholderPrefix="Subcopy" values={subcopies} onChange={setSubcopies} />
            </Field>
            <Field label="Eyebrows (3 variations)" optional>
              <CopyBank name="ad_eyebrows" count={3} placeholderPrefix="Eyebrow" values={eyebrows} onChange={setEyebrows} />
            </Field>

            <Field label="Ad Copy — Primary text" optional>
              <textarea name="ad_copy_primary_text" rows={3} placeholder="The main body of the ad" style={{ resize: 'vertical' }} />
            </Field>
            <Field label="Ad Copy — Description" optional>
              <input name="ad_copy_description" type="text" placeholder="Meta ad description line" />
            </Field>
            <Field label="Ad Copy — URL" optional>
              <input name="ad_copy_url" type="url" placeholder="https://…" />
            </Field>

            <Field label="Retail price / value" optional>
              <input name="retail_price" type="text" placeholder='e.g. $29.99, "$29.99 value"' />
            </Field>

            <Field label="Competitor reference" optional>
              <textarea
                name="competitor_reference"
                rows={2}
                placeholder="Competitors, benchmark ads, or category references to draw from…"
                style={{ resize: 'vertical' }}
              />
            </Field>
            <Field label="Client ad inspiration" optional>
              <textarea
                name="client_ad_inspiration"
                rows={2}
                placeholder="Ads or references the client shared as direction…"
                style={{ resize: 'vertical' }}
              />
            </Field>
          </Section>

          {/* Product Images */}
          <Section title="Product images" subtitle="Optional — 3+ recommended for stronger creative output.">
            <div id="images-section">
              <ImageUploader value={images} onChange={setImages} />
              {images.length > 0 && (
                <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 12 }}>
                  {images.length} image{images.length === 1 ? '' : 's'} attached
                </p>
              )}
              <div style={{ marginTop: 20 }}>
                <Field label="Or link to product assets" optional>
                  <input
                    name="product_images_link"
                    type="url"
                    placeholder="Drive folder URL, Dropbox link, or any external asset location"
                  />
                </Field>
              </div>
            </div>
          </Section>

          {error && (
            <div style={{
              padding: '12px 16px',
              background: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 8,
              color: 'var(--danger)',
              fontSize: 13,
            }}>
              {error}
            </div>
          )}

        </form>
      </main>
    </div>
  )
}
