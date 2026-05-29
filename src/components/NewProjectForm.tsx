'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import ImageUploader from '@/components/ImageUploader'
import { createProject } from '@/lib/actions'
import { PAGE_TYPE_OPTIONS } from '@/lib/types'
import type { Journey } from '@/lib/types'

interface UploadedImage {
  path: string
  url: string
  preview: string
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: '24px',
      marginBottom: 16,
    }}>
      <h2 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 20 }}>
        {title}
      </h2>
      {children}
    </div>
  )
}

function Field({ label, optional, children }: { label: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span>{label}</span>
        {optional && <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>optional</span>}
      </label>
      {children}
    </div>
  )
}

export default function NewProjectForm({
  brandId,
  journeys,
}: {
  brandId: string
  journeys: Journey[]
}) {
  const router = useRouter()

  const [offerType, setOfferType] = useState<'flat' | 'tiered' | ''>('')
  const [images, setImages] = useState<UploadedImage[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Journey state
  const [journeyMode, setJourneyMode] = useState<'existing' | 'new'>(
    journeys.length > 0 ? 'existing' : 'new'
  )
  const [selectedJourneyId, setSelectedJourneyId] = useState(journeys[0]?.id ?? '')
  const [newJourneyName, setNewJourneyName] = useState('')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (images.length < 3) {
      setError('Please upload at least 3 product images before submitting.')
      document.getElementById('images-section')?.scrollIntoView({ behavior: 'smooth' })
      return
    }
    setSubmitting(true)
    setError('')

    const fd = new FormData(e.currentTarget)
    fd.set('brand_id', brandId)
    fd.set('offer_type', offerType)
    fd.set('image_urls', JSON.stringify(images.map(({ path, url }) => ({ path, url }))))

    // Set journey fields based on mode
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
          style={{ padding: '8px 20px' }}
        >
          {submitting ? 'Submitting…' : '🚀 Submit project'}
        </button>
      </div>

      <main style={{ maxWidth: 720, margin: '0 auto', padding: '32px 24px 80px' }}>
        <form id="project-form" onSubmit={handleSubmit}>

          {/* Basics */}
          <Section title="Basics">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 4 }}>
              <Field label="Marketing moment name *">
                <input name="name" type="text" placeholder="e.g. Memorial Day Sale 2025" required autoFocus />
              </Field>
              <Field label="Due date *">
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

            {/* Page type */}
            <Field label="Page Type" optional>
              <select name="page_type">
                <option value="">Select page type…</option>
                {PAGE_TYPE_OPTIONS.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </Field>

            {/* Product featured */}
            <Field label="Product Featured" optional>
              <input
                name="product_featured"
                type="text"
                placeholder="e.g. Viking Beard Oil 3-Pack, Summer Collection"
              />
            </Field>
          </Section>

          {/* Offer Description */}
          <Section title="Offer Description">
            <Field label="Offer overview" optional>
              <textarea
                name="offer_description"
                rows={4}
                placeholder="What is the offer? Who are we targeting? What's the key buying motivation? What makes this moment relevant right now?"
                style={{ resize: 'vertical' }}
              />
            </Field>
            <Field label="Inspiration" optional>
              <textarea
                name="inspiration"
                rows={2}
                placeholder="Reference URLs, visual direction, brands or ads to draw from…"
                style={{ resize: 'vertical' }}
              />
            </Field>
          </Section>

          {/* Copy & Offer */}
          <Section title="Copy & Offer">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Field label="Offer / Promo" optional>
                <input name="offer" type="text" placeholder="e.g. Buy 2 Get 1 Free" />
              </Field>
              <Field label="Call to action" optional>
                <input name="cta" type="text" placeholder="e.g. Shop Now, Claim Your Deal" />
              </Field>
            </div>

            <Field label="Discount structure" optional>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                {(['flat', 'tiered'] as const).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setOfferType(prev => prev === t ? '' : t)}
                    style={{
                      padding: '7px 16px',
                      borderRadius: 8,
                      border: `1px solid ${offerType === t ? 'var(--accent)' : 'var(--border)'}`,
                      background: offerType === t ? 'var(--accent-muted)' : 'transparent',
                      color: offerType === t ? 'var(--accent)' : 'var(--text-secondary)',
                      fontSize: 13,
                      fontWeight: offerType === t ? 600 : 400,
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >
                    {t === 'flat' ? 'Flat discount' : 'Tiered discount'}
                  </button>
                ))}
              </div>
              <input
                name="discount"
                type="text"
                placeholder="e.g. 20% off, $15 off orders $75+"
                style={{ display: offerType === 'flat' ? 'block' : 'none' }}
              />
              <textarea
                name="tiered_offer"
                rows={2}
                placeholder="e.g. Spend $50 → 10% off · Spend $100 → 20% off · Spend $150 → 25% off"
                style={{ resize: 'vertical', display: offerType === 'tiered' ? 'block' : 'none' }}
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
          </Section>

          {/* Product Images */}
          <Section title="Product Images">
            <div id="images-section">
              <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 4 }}>
                Upload <strong>at least 3</strong> clean product images (no background clutter).
              </p>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>
                The more you provide, the better — more options means stronger creative output.
              </p>
              <ImageUploader value={images} onChange={setImages} />
              {images.length > 0 && images.length < 3 && (
                <p style={{ color: 'var(--warning)', fontSize: 13, marginTop: 12 }}>
                  ⚠ Need {3 - images.length} more image{3 - images.length !== 1 ? 's' : ''}
                </p>
              )}
              {images.length >= 3 && (
                <p style={{ color: 'var(--success)', fontSize: 13, marginTop: 12 }}>
                  ✓ {images.length} images ready
                </p>
              )}
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
