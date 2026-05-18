'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import ImageUploader from '@/components/ImageUploader'
import { createProject } from '@/lib/actions'

interface UploadedImage {
  path: string
  url: string
  preview: string
}

const SECTIONS = ['Basics', 'Offer Description', 'Copy & Offer', 'Product Images']

export default function NewProjectPage() {
  const params = useParams()
  const brandId = params.brandId as string
  const router = useRouter()

  const [step, setStep] = useState(0)
  const [offerType, setOfferType] = useState<'flat' | 'tiered' | ''>('')
  const [images, setImages] = useState<UploadedImage[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (images.length < 3) {
      setError('Please upload at least 3 product images.')
      setStep(3)
      return
    }
    setSubmitting(true)
    setError('')

    const fd = new FormData(e.currentTarget)
    fd.set('brand_id', brandId)
    fd.set('offer_type', offerType)
    fd.set('image_urls', JSON.stringify(images.map(({ path, url }) => ({ path, url }))))

    try {
      const result = await createProject(fd)
      router.push(result.redirect)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setSubmitting(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)' }}>
      <div style={{
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        padding: '0 24px',
        height: 56,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
      }}>
        <Link href={`/brands/${brandId}`} style={{ color: 'var(--text-muted)', fontSize: 13, textDecoration: 'none' }}>
          ← Back
        </Link>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>New Marketing Moment</span>
      </div>

      <main style={{ maxWidth: 680, margin: '0 auto', padding: '40px 24px' }}>
        {/* Step tabs */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 36, borderBottom: '1px solid var(--border)' }}>
          {SECTIONS.map((s, i) => (
            <button
              key={s}
              type="button"
              onClick={() => setStep(i)}
              style={{
                padding: '10px 18px',
                background: 'none',
                border: 'none',
                borderBottom: `2px solid ${i === step ? 'var(--accent)' : 'transparent'}`,
                color: i === step ? 'var(--accent)' : i < step ? 'var(--text-secondary)' : 'var(--text-muted)',
                fontSize: 13,
                fontWeight: i === step ? 600 : 400,
                cursor: 'pointer',
                marginBottom: -1,
                transition: 'color 0.15s',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span style={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                background: i < step ? 'var(--success)' : i === step ? 'var(--accent)' : 'var(--border)',
                color: 'white',
                fontSize: 10,
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                {i < step ? '✓' : i + 1}
              </span>
              {s}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit}>

          {/* All steps always rendered; only active one is visible.
              This keeps all inputs in the DOM so FormData picks them up on submit. */}

          {/* Step 0: Basics */}
          <div style={{ display: step === 0 ? 'block' : 'none' }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 24 }}>Project basics</h2>
            <div style={{ marginBottom: 20 }}>
              <label htmlFor="name">Marketing moment name *</label>
              <input id="name" name="name" type="text" placeholder="e.g. Memorial Day Sale 2025" required />
            </div>
            <div>
              <label htmlFor="due_date">Due date *</label>
              <input id="due_date" name="due_date" type="date" required />
            </div>
          </div>

          {/* Step 1: Offer Description */}
          <div style={{ display: step === 1 ? 'block' : 'none' }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>Offer description</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 24 }}>
              Describe the offer in plain language — what it is, who it's for, and why it's compelling.
            </p>
            <div style={{ marginBottom: 20 }}>
              <label htmlFor="offer_description">Offer overview</label>
              <textarea
                id="offer_description"
                name="offer_description"
                rows={5}
                placeholder="What is the offer? Who are we targeting? What's the key buying motivation? What makes this moment relevant right now?"
                style={{ resize: 'vertical' }}
              />
            </div>
            <div>
              <label htmlFor="inspiration">Inspiration <span style={{ color: 'var(--text-muted)', fontWeight: 400, textTransform: 'none', fontSize: 11 }}>— optional</span></label>
              <textarea
                id="inspiration"
                name="inspiration"
                rows={3}
                placeholder="Paste reference URLs, describe a visual direction, or name brands/ads you want us to draw from…"
                style={{ resize: 'vertical' }}
              />
            </div>
          </div>

          {/* Step 2: Copy & Offer */}
          <div style={{ display: step === 2 ? 'block' : 'none' }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 24 }}>Copy & offer</h2>

            <div style={{ marginBottom: 20 }}>
              <label>Offer / Promo</label>
              <input name="offer" type="text" placeholder="e.g. Buy 2 Get 1 Free, Free Shipping, Summer Sale" />
            </div>

            <div style={{ marginBottom: 8 }}>
              <label>Discount structure</label>
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
              {/* Both inputs always in DOM; hidden when not selected */}
              <input
                name="discount"
                type="text"
                placeholder="e.g. 20% off, $15 off orders $75+"
                style={{ display: offerType === 'flat' ? 'block' : 'none' }}
              />
              <textarea
                name="tiered_offer"
                rows={3}
                placeholder="e.g. Spend $50 → 10% off · Spend $100 → 20% off · Spend $150 → 25% off"
                style={{ resize: 'vertical', display: offerType === 'tiered' ? 'block' : 'none' }}
              />
            </div>

            <div style={{ height: 24 }} />

            <div style={{ marginBottom: 20 }}>
              <label htmlFor="headline">Hero headline</label>
              <input id="headline" name="headline" type="text" placeholder="The main hook for this moment" />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label htmlFor="body_copy">Body copy</label>
              <textarea id="body_copy" name="body_copy" rows={3} placeholder="Key claims, product benefits, supporting proof…" style={{ resize: 'vertical' }} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label htmlFor="supporting_message">Supporting message</label>
              <textarea id="supporting_message" name="supporting_message" rows={2} placeholder="Secondary line, urgency cue, or subtext…" style={{ resize: 'vertical' }} />
            </div>
            <div>
              <label htmlFor="cta">Call to action</label>
              <input id="cta" name="cta" type="text" placeholder="e.g. Shop Now, Claim Your Deal, Get 20% Off" />
            </div>
          </div>

          {/* Step 3: Product Images */}
          <div style={{ display: step === 3 ? 'block' : 'none' }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>Product images</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 4 }}>
              Upload <strong>at least 3</strong> clean product images (no background clutter) for the static studio.
            </p>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>
              The more you provide, the better — more options means stronger creative output.
            </p>
              <ImageUploader value={images} onChange={setImages} />
              {images.length > 0 && images.length < 3 && (
                <p style={{ color: 'var(--warning)', fontSize: 13, marginTop: 12 }}>
                  ⚠ Need {3 - images.length} more image{3 - images.length !== 1 ? 's' : ''} to continue
                </p>
              )}
              {images.length >= 3 && (
                <p style={{ color: 'var(--success)', fontSize: 13, marginTop: 12 }}>
                  ✓ {images.length} images uploaded — good to go!
                </p>
              )}
          </div>

          {error && (
            <div style={{
              marginTop: 20,
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

          {/* Navigation */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 36, paddingTop: 24, borderTop: '1px solid var(--border)' }}>
            <button
              type="button"
              onClick={() => setStep(s => Math.max(0, s - 1))}
              disabled={step === 0}
              className="btn-secondary"
            >
              ← Back
            </button>

            {step < SECTIONS.length - 1 ? (
              <button
                type="button"
                onClick={() => setStep(s => s + 1)}
                className="btn-primary"
              >
                Next: {SECTIONS[step + 1]} →
              </button>
            ) : (
              <button
                type="submit"
                className="btn-primary"
                disabled={submitting || images.length < 3}
              >
                {submitting ? 'Submitting…' : '🚀 Submit project'}
              </button>
            )}
          </div>
        </form>
      </main>
    </div>
  )
}
