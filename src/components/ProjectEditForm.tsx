'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { updateProjectDetails } from '@/lib/actions'
import { PAGE_TYPE_OPTIONS } from '@/lib/types'
import type { Journey } from '@/lib/types'

interface Props {
  projectId: string
  brandId: string
  journeys: Journey[]
  initial: {
    name: string
    due_date: string | null
    offer_description: string | null
    inspiration: string | null
    offer: string | null
    cta: string | null
    discount: string | null
    tiered_offer: string | null
    offer_type: string | null
    headline: string | null
    body_copy: string | null
    supporting_message: string | null
    journey_id: string | null
    marketing_moment: 1 | 2 | null
    page_type: string | null
    product_featured: string | null
    lp_url: string | null
    creatives_notes: string | null
    shopify_coupon_code: string | null
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 20, marginTop: 20 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 16 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function Field({ label, optional, children }: { label: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span>{label}</span>
        {optional && <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>optional</span>}
      </label>
      {children}
    </div>
  )
}

export default function ProjectEditForm({ projectId, brandId, journeys, initial }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const formRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleOpen() {
      setEditing(true)
      setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
    }
    window.addEventListener('prometheus-open-edit', handleOpen)
    return () => window.removeEventListener('prometheus-open-edit', handleOpen)
  }, [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [name, setName] = useState(initial.name)
  const [dueDate, setDueDate] = useState(initial.due_date ?? '')
  const [journeyId, setJourneyId] = useState(initial.journey_id ?? '')
  const [moment, setMoment] = useState<'' | '1' | '2'>(
    initial.marketing_moment ? String(initial.marketing_moment) as '1' | '2' : ''
  )
  const [pageType, setPageType] = useState(initial.page_type ?? '')
  const [productFeatured, setProductFeatured] = useState(initial.product_featured ?? '')

  const [offerDescription, setOfferDescription] = useState(initial.offer_description ?? '')
  const [inspiration, setInspiration] = useState(initial.inspiration ?? '')

  const [offer, setOffer] = useState(initial.offer ?? '')
  const [cta, setCta] = useState(initial.cta ?? '')
  const [offerType, setOfferType] = useState<'flat' | 'tiered' | ''>(
    initial.offer_type === 'flat' ? 'flat' : initial.offer_type === 'tiered' ? 'tiered' : ''
  )
  const [discount, setDiscount] = useState(initial.discount ?? '')
  const [tieredOffer, setTieredOffer] = useState(initial.tiered_offer ?? '')
  const [headline, setHeadline] = useState(initial.headline ?? '')
  const [bodyCopy, setBodyCopy] = useState(initial.body_copy ?? '')
  const [supportingMessage, setSupportingMessage] = useState(initial.supporting_message ?? '')

  const [lpUrl, setLpUrl] = useState(initial.lp_url ?? '')
  const [creativesNotes, setCreativesNotes] = useState(initial.creatives_notes ?? '')
  const [shopifyCouponCode, setShopifyCouponCode] = useState(initial.shopify_coupon_code ?? '')

  function cancel() {
    setName(initial.name)
    setDueDate(initial.due_date ?? '')
    setJourneyId(initial.journey_id ?? '')
    setMoment(initial.marketing_moment ? String(initial.marketing_moment) as '1' | '2' : '')
    setPageType(initial.page_type ?? '')
    setProductFeatured(initial.product_featured ?? '')
    setOfferDescription(initial.offer_description ?? '')
    setInspiration(initial.inspiration ?? '')
    setOffer(initial.offer ?? '')
    setCta(initial.cta ?? '')
    setOfferType(initial.offer_type === 'flat' ? 'flat' : initial.offer_type === 'tiered' ? 'tiered' : '')
    setDiscount(initial.discount ?? '')
    setTieredOffer(initial.tiered_offer ?? '')
    setHeadline(initial.headline ?? '')
    setBodyCopy(initial.body_copy ?? '')
    setSupportingMessage(initial.supporting_message ?? '')
    setLpUrl(initial.lp_url ?? '')
    setCreativesNotes(initial.creatives_notes ?? '')
    setShopifyCouponCode(initial.shopify_coupon_code ?? '')
    setError('')
    setEditing(false)
  }

  async function save() {
    if (!name.trim()) {
      setError('Project name is required.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await updateProjectDetails(projectId, brandId, {
        name: name.trim(),
        due_date: dueDate || null,
        offer_description: offerDescription.trim() || null,
        inspiration: inspiration.trim() || null,
        offer: offer.trim() || null,
        cta: cta.trim() || null,
        offer_type: offerType || null,
        discount: offerType === 'flat' ? (discount.trim() || null) : null,
        tiered_offer: offerType === 'tiered' ? (tieredOffer.trim() || null) : null,
        headline: headline.trim() || null,
        body_copy: bodyCopy.trim() || null,
        supporting_message: supportingMessage.trim() || null,
        journey_id: journeyId || null,
        marketing_moment: moment === '1' ? 1 : moment === '2' ? 2 : null,
        page_type: pageType || null,
        product_featured: productFeatured.trim() || null,
        lp_url: lpUrl.trim() || null,
        creatives_notes: creativesNotes.trim() || null,
        shopify_coupon_code: shopifyCouponCode.trim() || null,
      })
      setEditing(false)
      router.refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <div ref={formRef} style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 24 }}>
        <button
          onClick={() => setEditing(true)}
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--text-muted)',
            background: 'none',
            border: '1px solid var(--border)',
            borderRadius: 7,
            padding: '6px 12px',
            cursor: 'pointer',
          }}
        >
          ✏ Edit details
        </button>
      </div>
    )
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      save()
    } else if (e.key === 'Escape') {
      cancel()
    }
  }

  return (
    <div ref={formRef} className="card" style={{ marginBottom: 24 }} onKeyDown={handleKeyDown}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <h3 style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>Edit Project</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={save} disabled={saving} className="btn-primary" style={{ fontSize: 13 }}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <button onClick={cancel} disabled={saving} className="btn-secondary" style={{ fontSize: 13 }}>
            Cancel
          </button>
        </div>
      </div>

      {error && (
        <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, color: 'var(--danger)', fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* ── Basics ── */}
      <Section title="Basics">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Field label="Project name">
            <input type="text" value={name} onChange={e => setName(e.target.value)} />
          </Field>
          <Field label="Due date" optional>
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </Field>
        </div>

        <Field label="Journey" optional>
          <select value={journeyId} onChange={e => setJourneyId(e.target.value)}>
            <option value="">(No journey)</option>
            {journeys.map(j => (
              <option key={j.id} value={j.id}>{j.name}</option>
            ))}
          </select>
        </Field>

        <Field label="Marketing Moment" optional>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['', '1', '2'] as const).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => setMoment(m)}
                style={{
                  padding: '7px 14px', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontWeight: 500,
                  border: `1px solid ${moment === m ? 'var(--accent)' : 'var(--border)'}`,
                  background: moment === m ? 'var(--accent-muted)' : 'transparent',
                  color: moment === m ? 'var(--accent)' : 'var(--text-secondary)',
                  transition: 'all 0.15s',
                }}
              >
                {m === '' ? 'None' : m === '1' ? 'Moment 1 (1st half)' : 'Moment 2 (2nd half)'}
              </button>
            ))}
          </div>
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Field label="Page Type" optional>
            <select value={pageType} onChange={e => setPageType(e.target.value)}>
              <option value="">Select page type…</option>
              {PAGE_TYPE_OPTIONS.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Product Featured" optional>
            <input type="text" value={productFeatured} onChange={e => setProductFeatured(e.target.value)} placeholder="e.g. Viking Beard Oil 3-Pack" />
          </Field>
        </div>
      </Section>

      {/* ── Offer Description ── */}
      <Section title="Offer Description">
        <Field label="Offer overview" optional>
          <textarea value={offerDescription} onChange={e => setOfferDescription(e.target.value)} rows={4} style={{ resize: 'vertical' }} placeholder="What is the offer? Who are we targeting? What's the key buying motivation?" />
        </Field>
        <Field label="Inspiration" optional>
          <textarea value={inspiration} onChange={e => setInspiration(e.target.value)} rows={2} style={{ resize: 'vertical' }} placeholder="Reference URLs, visual direction, brands or ads to draw from…" />
        </Field>
      </Section>

      {/* ── Copy & Offer ── */}
      <Section title="Copy & Offer">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Field label="Offer / Promo" optional>
            <input type="text" value={offer} onChange={e => setOffer(e.target.value)} placeholder="e.g. Buy 2 Get 1 Free" />
          </Field>
          <Field label="Call to action" optional>
            <input type="text" value={cta} onChange={e => setCta(e.target.value)} placeholder="e.g. Shop Now, Claim Your Deal" />
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
                  padding: '7px 16px', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontWeight: offerType === t ? 600 : 400,
                  border: `1px solid ${offerType === t ? 'var(--accent)' : 'var(--border)'}`,
                  background: offerType === t ? 'var(--accent-muted)' : 'transparent',
                  color: offerType === t ? 'var(--accent)' : 'var(--text-secondary)',
                  transition: 'all 0.15s',
                }}
              >
                {t === 'flat' ? 'Flat discount' : 'Tiered discount'}
              </button>
            ))}
          </div>
          {offerType === 'flat' && (
            <input type="text" value={discount} onChange={e => setDiscount(e.target.value)} placeholder="e.g. 20% off, $15 off orders $75+" />
          )}
          {offerType === 'tiered' && (
            <textarea value={tieredOffer} onChange={e => setTieredOffer(e.target.value)} rows={2} style={{ resize: 'vertical' }} placeholder="e.g. Spend $50 → 10% off · Spend $100 → 20% off" />
          )}
        </Field>

        <Field label="Hero headline" optional>
          <input type="text" value={headline} onChange={e => setHeadline(e.target.value)} placeholder="The main hook for this moment" />
        </Field>
        <Field label="Body copy" optional>
          <textarea value={bodyCopy} onChange={e => setBodyCopy(e.target.value)} rows={4} style={{ resize: 'vertical' }} placeholder="Key claims, product benefits, supporting proof…" />
        </Field>
        <Field label="Supporting message" optional>
          <textarea value={supportingMessage} onChange={e => setSupportingMessage(e.target.value)} rows={2} style={{ resize: 'vertical' }} placeholder="Secondary line, urgency cue, or subtext…" />
        </Field>
      </Section>

      {/* ── Deliverables ── */}
      <Section title="Deliverables">
        <Field label="Landing page URL" optional>
          <input type="url" value={lpUrl} onChange={e => setLpUrl(e.target.value)} placeholder="https://…" />
        </Field>
        <Field label="Shopify coupon code" optional>
          <input
            type="text"
            value={shopifyCouponCode}
            onChange={e => setShopifyCouponCode(e.target.value)}
            placeholder="e.g. SUMMER20"
            style={{ textTransform: 'uppercase' }}
          />
        </Field>
        <Field label="Creatives link / notes" optional>
          <textarea value={creativesNotes} onChange={e => setCreativesNotes(e.target.value)} rows={2} style={{ resize: 'vertical' }} placeholder="Drive link, Figma link, or delivery notes…" />
        </Field>
      </Section>

      <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
        <button onClick={save} disabled={saving} className="btn-primary" style={{ fontSize: 13 }}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button onClick={cancel} disabled={saving} className="btn-secondary" style={{ fontSize: 13 }}>
          Cancel
        </button>
      </div>
    </div>
  )
}
