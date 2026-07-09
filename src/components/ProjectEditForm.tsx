'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { updateProjectDetails } from '@/lib/actions'
import { PAGE_TYPE_OPTIONS } from '@/lib/types'
import type { Journey } from '@/lib/types'

const OFFER_DYNAMICS_OPTIONS = [
  'BOGO',
  'GWP',
  'Buy X Get Y',
  'Flat Discount',
  'Tiered Discount',
  'Other',
] as const

interface Props {
  projectId: string
  brandId: string
  journeys: Journey[]
  initial: {
    name: string
    due_date: string | null
    stage_brief_due_date: string | null
    stage_in_progress_due_date: string | null
    stage_internal_review_due_date: string | null
    stage_client_review_due_date: string | null
    offer_description: string | null
    offer: string | null
    cta: string | null
    headline: string | null
    body_copy: string | null
    supporting_message: string | null
    journey_id: string | null
    marketing_moment: 1 | 2 | null
    page_type: string | null
    product_featured: string | null
    product_description: string | null
    retail_price: string | null
    offer_dynamics_type: string | null
    competitor_reference: string | null
    client_ad_inspiration: string | null
    ad_copy_primary_text: string | null
    ad_copy_description: string | null
    ad_copy_url: string | null
    ad_headlines: string[] | null
    ad_subcopies: string[] | null
    ad_eyebrows: string[] | null
    product_images_link: string | null
    lp_url: string | null
    creatives_notes: string | null
    shopify_coupon_code: string | null
  }
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 20, marginTop: 20 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: subtitle ? 4 : 16 }}>
        {title}
      </div>
      {subtitle && <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>{subtitle}</p>}
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

function padArray(values: string[] | null, size: number): string[] {
  const src = values ?? []
  return Array.from({ length: size }).map((_, i) => src[i] ?? '')
}

function cleanBank(values: string[]): string[] | null {
  const cleaned = values.map(v => v.trim()).filter(Boolean)
  return cleaned.length > 0 ? cleaned : null
}

function CopyBank({
  count,
  placeholderPrefix,
  values,
  onChange,
}: {
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
    </>
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
  const [stageBrief, setStageBrief] = useState(initial.stage_brief_due_date ?? '')
  const [stageInProgress, setStageInProgress] = useState(initial.stage_in_progress_due_date ?? '')
  const [stageInternal, setStageInternal] = useState(initial.stage_internal_review_due_date ?? '')
  const [stageClient, setStageClient] = useState(initial.stage_client_review_due_date ?? '')

  const [journeyId, setJourneyId] = useState(initial.journey_id ?? '')
  const [moment, setMoment] = useState<'' | '1' | '2'>(
    initial.marketing_moment ? String(initial.marketing_moment) as '1' | '2' : ''
  )
  const [pageType, setPageType] = useState(initial.page_type ?? '')
  const [productFeatured, setProductFeatured] = useState(initial.product_featured ?? '')
  const [productDescription, setProductDescription] = useState(initial.product_description ?? '')

  const [offerDescription, setOfferDescription] = useState(initial.offer_description ?? '')
  const [offer, setOffer] = useState(initial.offer ?? '')
  const [cta, setCta] = useState(initial.cta ?? '')
  const [headline, setHeadline] = useState(initial.headline ?? '')
  const [bodyCopy, setBodyCopy] = useState(initial.body_copy ?? '')
  const [supportingMessage, setSupportingMessage] = useState(initial.supporting_message ?? '')

  // Creatives-only
  const [retailPrice, setRetailPrice] = useState(initial.retail_price ?? '')
  const [offerDynamicsType, setOfferDynamicsType] = useState(initial.offer_dynamics_type ?? '')
  const [competitorReference, setCompetitorReference] = useState(initial.competitor_reference ?? '')
  const [clientAdInspiration, setClientAdInspiration] = useState(initial.client_ad_inspiration ?? '')
  const [adCopyPrimary, setAdCopyPrimary] = useState(initial.ad_copy_primary_text ?? '')
  const [adCopyDescription, setAdCopyDescription] = useState(initial.ad_copy_description ?? '')
  const [adCopyUrl, setAdCopyUrl] = useState(initial.ad_copy_url ?? '')
  const [headlines, setHeadlines] = useState<string[]>(padArray(initial.ad_headlines, 5))
  const [subcopies, setSubcopies] = useState<string[]>(padArray(initial.ad_subcopies, 5))
  const [eyebrows, setEyebrows]  = useState<string[]>(padArray(initial.ad_eyebrows, 3))
  const [productImagesLink, setProductImagesLink] = useState(initial.product_images_link ?? '')

  // Deliverables
  const [lpUrl, setLpUrl] = useState(initial.lp_url ?? '')
  const [creativesNotes, setCreativesNotes] = useState(initial.creatives_notes ?? '')
  const [shopifyCouponCode, setShopifyCouponCode] = useState(initial.shopify_coupon_code ?? '')

  function cancel() {
    setName(initial.name)
    setDueDate(initial.due_date ?? '')
    setStageBrief(initial.stage_brief_due_date ?? '')
    setStageInProgress(initial.stage_in_progress_due_date ?? '')
    setStageInternal(initial.stage_internal_review_due_date ?? '')
    setStageClient(initial.stage_client_review_due_date ?? '')
    setJourneyId(initial.journey_id ?? '')
    setMoment(initial.marketing_moment ? String(initial.marketing_moment) as '1' | '2' : '')
    setPageType(initial.page_type ?? '')
    setProductFeatured(initial.product_featured ?? '')
    setProductDescription(initial.product_description ?? '')
    setOfferDescription(initial.offer_description ?? '')
    setOffer(initial.offer ?? '')
    setCta(initial.cta ?? '')
    setHeadline(initial.headline ?? '')
    setBodyCopy(initial.body_copy ?? '')
    setSupportingMessage(initial.supporting_message ?? '')
    setRetailPrice(initial.retail_price ?? '')
    setOfferDynamicsType(initial.offer_dynamics_type ?? '')
    setCompetitorReference(initial.competitor_reference ?? '')
    setClientAdInspiration(initial.client_ad_inspiration ?? '')
    setAdCopyPrimary(initial.ad_copy_primary_text ?? '')
    setAdCopyDescription(initial.ad_copy_description ?? '')
    setAdCopyUrl(initial.ad_copy_url ?? '')
    setHeadlines(padArray(initial.ad_headlines, 5))
    setSubcopies(padArray(initial.ad_subcopies, 5))
    setEyebrows(padArray(initial.ad_eyebrows, 3))
    setProductImagesLink(initial.product_images_link ?? '')
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
        stage_brief_due_date: stageBrief || null,
        stage_in_progress_due_date: stageInProgress || null,
        stage_internal_review_due_date: stageInternal || null,
        stage_client_review_due_date: stageClient || null,
        offer_description: offerDescription.trim() || null,
        offer: offer.trim() || null,
        cta: cta.trim() || null,
        headline: headline.trim() || null,
        body_copy: bodyCopy.trim() || null,
        supporting_message: supportingMessage.trim() || null,
        journey_id: journeyId || null,
        marketing_moment: moment === '1' ? 1 : moment === '2' ? 2 : null,
        page_type: pageType || null,
        product_featured: productFeatured.trim() || null,
        product_description: productDescription.trim() || null,
        retail_price: retailPrice.trim() || null,
        offer_dynamics_type: offerDynamicsType || null,
        competitor_reference: competitorReference.trim() || null,
        client_ad_inspiration: clientAdInspiration.trim() || null,
        ad_copy_primary_text: adCopyPrimary.trim() || null,
        ad_copy_description: adCopyDescription.trim() || null,
        ad_copy_url: adCopyUrl.trim() || null,
        ad_headlines: cleanBank(headlines),
        ad_subcopies: cleanBank(subcopies),
        ad_eyebrows: cleanBank(eyebrows),
        product_images_link: productImagesLink.trim() || null,
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
          <Field label="Launch date (Live)" optional>
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
      </Section>

      {/* ── Stage timeline ── */}
      <Section title="Stage timeline" subtitle="Target dates per phase — informational, not enforced.">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Field label="Brief due" optional>
            <input type="date" value={stageBrief} onChange={e => setStageBrief(e.target.value)} />
          </Field>
          <Field label="In Progress due" optional>
            <input type="date" value={stageInProgress} onChange={e => setStageInProgress(e.target.value)} />
          </Field>
          <Field label="Internal Review due" optional>
            <input type="date" value={stageInternal} onChange={e => setStageInternal(e.target.value)} />
          </Field>
          <Field label="Client Review due" optional>
            <input type="date" value={stageClient} onChange={e => setStageClient(e.target.value)} />
          </Field>
        </div>
      </Section>

      {/* ── Shared brief ── */}
      <Section title="Shared brief" subtitle="Used by both LP and Creatives.">
        <Field label="Offer / Promo" optional>
          <select value={offerDynamicsType} onChange={e => setOfferDynamicsType(e.target.value)} style={{ marginBottom: 8 }}>
            <option value="">Select offer type…</option>
            {OFFER_DYNAMICS_OPTIONS.map(o => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          <input type="text" value={offer} onChange={e => setOffer(e.target.value)} placeholder="Details — e.g. Buy 2 Get 1 Free, 20% off orders $75+" />
        </Field>
        <Field label="Offer overview" optional>
          <textarea value={offerDescription} onChange={e => setOfferDescription(e.target.value)} rows={4} style={{ resize: 'vertical' }} />
        </Field>

        <Field label="Hero headline" optional>
          <input type="text" value={headline} onChange={e => setHeadline(e.target.value)} placeholder="The main hook for this moment" />
        </Field>
        <Field label="Body copy" optional>
          <textarea value={bodyCopy} onChange={e => setBodyCopy(e.target.value)} rows={4} style={{ resize: 'vertical' }} />
        </Field>
        <Field label="Supporting message" optional>
          <textarea value={supportingMessage} onChange={e => setSupportingMessage(e.target.value)} rows={2} style={{ resize: 'vertical' }} />
        </Field>
        <Field label="Call to action" optional>
          <input type="text" value={cta} onChange={e => setCta(e.target.value)} placeholder="e.g. Shop Now, Claim Your Deal" />
        </Field>

        <Field label="Product name" optional>
          <input type="text" value={productFeatured} onChange={e => setProductFeatured(e.target.value)} placeholder="e.g. Viking Beard Oil 3-Pack" />
        </Field>
        <Field label="Product description" optional>
          <textarea value={productDescription} onChange={e => setProductDescription(e.target.value)} rows={2} style={{ resize: 'vertical' }} />
        </Field>
      </Section>

      {/* ── LP-only ── */}
      <Section title="LP-only">
        <Field label="Page type" optional>
          <select value={pageType} onChange={e => setPageType(e.target.value)}>
            <option value="">Select page type…</option>
            {PAGE_TYPE_OPTIONS.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </Field>
      </Section>

      {/* ── Creatives-only ── */}
      <Section title="Creatives-only">
        <Field label="Headlines (5 variations)" optional>
          <CopyBank count={5} placeholderPrefix="Headline" values={headlines} onChange={setHeadlines} />
        </Field>
        <Field label="Subcopy (5 variations)" optional>
          <CopyBank count={5} placeholderPrefix="Subcopy" values={subcopies} onChange={setSubcopies} />
        </Field>
        <Field label="Eyebrows (3 variations)" optional>
          <CopyBank count={3} placeholderPrefix="Eyebrow" values={eyebrows} onChange={setEyebrows} />
        </Field>

        <Field label="Ad Copy — Primary text" optional>
          <textarea value={adCopyPrimary} onChange={e => setAdCopyPrimary(e.target.value)} rows={3} style={{ resize: 'vertical' }} />
        </Field>
        <Field label="Ad Copy — Description" optional>
          <input type="text" value={adCopyDescription} onChange={e => setAdCopyDescription(e.target.value)} />
        </Field>
        <Field label="Ad Copy — URL" optional>
          <input type="url" value={adCopyUrl} onChange={e => setAdCopyUrl(e.target.value)} placeholder="https://…" />
        </Field>

        <Field label="Retail price / value" optional>
          <input type="text" value={retailPrice} onChange={e => setRetailPrice(e.target.value)} placeholder='e.g. $29.99, "$29.99 value"' />
        </Field>

        <Field label="Competitor reference" optional>
          <textarea value={competitorReference} onChange={e => setCompetitorReference(e.target.value)} rows={2} style={{ resize: 'vertical' }} />
        </Field>
        <Field label="Client ad inspiration" optional>
          <textarea value={clientAdInspiration} onChange={e => setClientAdInspiration(e.target.value)} rows={2} style={{ resize: 'vertical' }} />
        </Field>

        <Field label="Product images link" optional>
          <input type="url" value={productImagesLink} onChange={e => setProductImagesLink(e.target.value)} placeholder="Drive folder or external URL" />
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
          <textarea value={creativesNotes} onChange={e => setCreativesNotes(e.target.value)} rows={2} style={{ resize: 'vertical' }} />
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
