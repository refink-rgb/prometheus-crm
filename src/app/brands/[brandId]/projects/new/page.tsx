'use client'

import { useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import ImageUploader from '@/components/ImageUploader'
import { createProject } from '@/lib/actions'

interface UploadedImage {
  path: string
  url: string
  preview: string
}

const SECTIONS = ['Basics', 'Creative Brief', 'Copy & Offer', 'Product Images']

export default function NewProjectPage() {
  const params = useParams()
  const brandId = params.brandId as string
  const router = useRouter()

  const [step, setStep] = useState(0)
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
    fd.set('image_urls', JSON.stringify(images.map(({ path, url }) => ({ path, url }))))

    try {
      await createProject(fd)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setSubmitting(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)' }}>
      {/* Minimal top bar */}
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
          {/* Step 0: Basics */}
          {step === 0 && (
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 24 }}>Project basics</h2>
              <div style={{ marginBottom: 20 }}>
                <label htmlFor="name">Project / Moment name *</label>
                <input id="name" name="name" type="text" placeholder="e.g. Memorial Day Sale 2025" required />
              </div>
              <div style={{ marginBottom: 20 }}>
                <label htmlFor="due_date">Due date *</label>
                <input id="due_date" name="due_date" type="date" required />
              </div>
              <div style={{ marginBottom: 20 }}>
                <label htmlFor="assigned_designer">Assigned designer</label>
                <input id="assigned_designer" name="assigned_designer" type="text" placeholder="e.g. Roberto Fink" />
              </div>
              <div>
                <label htmlFor="author">Copywriter / Author</label>
                <input id="author" name="author" type="text" placeholder="Who wrote the copy?" />
              </div>
            </div>
          )}

          {/* Step 1: Creative Brief */}
          {step === 1 && (
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 24 }}>Creative brief</h2>
              <div style={{ marginBottom: 20 }}>
                <label htmlFor="font">Primary font used in ads</label>
                <input id="font" name="font" type="text" placeholder="e.g. Canela Display, Helvetica Neue" />
              </div>
              <div style={{ marginBottom: 20 }}>
                <label htmlFor="target_audience">Target audience</label>
                <textarea id="target_audience" name="target_audience" rows={3} placeholder="Who are we targeting? Age, interests, buying behavior…" style={{ resize: 'vertical' }} />
              </div>
              <div>
                <label htmlFor="notes">Additional notes / creative direction</label>
                <textarea id="notes" name="notes" rows={4} placeholder="Any specific requests, references, or things to avoid…" style={{ resize: 'vertical' }} />
              </div>
            </div>
          )}

          {/* Step 2: Copy & Offer */}
          {step === 2 && (
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 24 }}>Copy & offer</h2>
              <div style={{ marginBottom: 20 }}>
                <label htmlFor="offer">Offer / Promo</label>
                <input id="offer" name="offer" type="text" placeholder="e.g. Buy 2 Get 1 Free, Free Shipping" />
              </div>
              <div style={{ marginBottom: 20 }}>
                <label htmlFor="discount">Discount amount</label>
                <input id="discount" name="discount" type="text" placeholder="e.g. 20% off, $15 off $75+" />
              </div>
              <div style={{ marginBottom: 20 }}>
                <label htmlFor="headline">Hero headline</label>
                <input id="headline" name="headline" type="text" placeholder="The main hook / headline for this moment" />
              </div>
              <div style={{ marginBottom: 20 }}>
                <label htmlFor="body_copy">Body copy / supporting message</label>
                <textarea id="body_copy" name="body_copy" rows={4} placeholder="Supporting copy, key claims, product benefits…" style={{ resize: 'vertical' }} />
              </div>
              <div>
                <label htmlFor="cta">Call to action</label>
                <input id="cta" name="cta" type="text" placeholder="e.g. Shop Now, Claim Your Deal" />
              </div>
            </div>
          )}

          {/* Step 3: Product Images */}
          {step === 3 && (
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>Product images</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 24 }}>
                Upload <strong>at least 3</strong> clean product images (no background clutter) for the static studio.
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
          )}

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
