'use client'

// Offer card detail: stage stepper + the Offer Draft form + delete.
//
// The form is uncontrolled by design (defaultValue + FormData on save),
// following ProjectEditForm's re-render-perf lesson. Field set = the
// signed-off Phase 0 list: strategic + creative-only, no copy fields.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  OFFER_STAGE_LABELS, OFFER_STAGE_ORDER,
  PAGE_TYPE_OPTIONS,
  type OfferCard, type OfferStage,
} from '@/lib/types'
import { OFFER_STAGE_COLORS } from '@/lib/stageColors'
import { deleteOfferCard, updateOfferDetails, updateOfferStage } from '@/lib/offer-actions'

const OFFER_DYNAMICS_OPTIONS = [
  'Percentage Discount',
  'Fixed Amount Off',
  'Bundle',
  'BOGO',
  'Gift With Purchase',
  'Tiered Offer',
  'Free Shipping',
  'Other',
]

export default function OfferCardDetail({
  card,
  isEditor,
}: {
  card: OfferCard
  isEditor: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  function setStage(stage: OfferStage) {
    setError(null)
    startTransition(async () => {
      try {
        await updateOfferStage(card.id, stage)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to move stage.')
      }
    })
  }

  function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSaved(false)
    const fd = new FormData(e.currentTarget)
    const str = (key: string) => (fd.get(key) as string)?.trim() || null
    startTransition(async () => {
      try {
        await updateOfferDetails(card.id, {
          offer_dynamics_type: str('offer_dynamics_type'),
          offer: str('offer'),
          offer_description: str('offer_description'),
          product_featured: str('product_featured'),
          product_description: str('product_description'),
          retail_price: str('retail_price'),
          page_type: str('page_type'),
          competitor_reference: str('competitor_reference'),
          client_ad_inspiration: str('client_ad_inspiration'),
          product_images_link: str('product_images_link'),
        })
        setSaved(true)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save.')
      }
    })
  }

  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 12, fontWeight: 600,
    color: 'var(--text-secondary)', marginBottom: 4,
  }
  const fieldWrap: React.CSSProperties = { marginBottom: 14 }
  const sectionTitle: React.CSSProperties = {
    fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text-muted)',
    textTransform: 'uppercase', letterSpacing: '0.08em',
    margin: '22px 0 12px',
  }

  return (
    <div>
      {/* Stage stepper */}
      <div style={{
        display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center',
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 10, padding: '10px 14px', marginBottom: 20,
      }}>
        {OFFER_STAGE_ORDER.map(stage => {
          const color = OFFER_STAGE_COLORS[stage]
          const active = card.stage === stage
          return (
            <button
              key={stage}
              type="button"
              disabled={!isEditor || isPending || active}
              onClick={() => setStage(stage)}
              className="focus-ring-pill"
              style={{
                padding: '5px 12px', borderRadius: 16, fontSize: 'var(--text-sm)',
                fontWeight: active ? 700 : 500,
                border: `1px solid ${active ? color.border : 'var(--border)'}`,
                background: active ? color.bg : 'transparent',
                color: active ? color.text : 'var(--text-muted)',
                cursor: isEditor && !active ? 'pointer' : 'default',
                opacity: isPending ? 0.6 : 1,
              }}
            >
              {OFFER_STAGE_LABELS[stage]}
            </button>
          )
        })}
      </div>

      <form onSubmit={handleSave}>
        <fieldset disabled={!isEditor || isPending} style={{ border: 'none', padding: 0, margin: 0 }}>
          <h2 style={{ ...sectionTitle, marginTop: 0 }}>The Offer</h2>

          <div style={fieldWrap}>
            <label style={labelStyle}>Offer Dynamics</label>
            <select name="offer_dynamics_type" defaultValue={card.offer_dynamics_type ?? ''} style={{ marginBottom: 8 }}>
              <option value="">Select type…</option>
              {OFFER_DYNAMICS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            <input type="text" name="offer" defaultValue={card.offer ?? ''} placeholder="Details — e.g. Buy 2 Get 1 Free, 20% off orders $75+" />
          </div>

          <div style={fieldWrap}>
            <label style={labelStyle}>Offer Description</label>
            <textarea name="offer_description" defaultValue={card.offer_description ?? ''} rows={4} style={{ resize: 'vertical' }} placeholder="The full mechanics and angle of this offer…" />
          </div>

          <h2 style={sectionTitle}>Product</h2>

          <div style={fieldWrap}>
            <label style={labelStyle}>Product Featured</label>
            <input type="text" name="product_featured" defaultValue={card.product_featured ?? ''} placeholder="e.g. Viking Beard Oil 3-Pack" />
          </div>

          <div style={fieldWrap}>
            <label style={labelStyle}>Product Description</label>
            <textarea name="product_description" defaultValue={card.product_description ?? ''} rows={2} style={{ resize: 'vertical' }} />
          </div>

          <div style={fieldWrap}>
            <label style={labelStyle}>Retail Price</label>
            <input type="text" name="retail_price" defaultValue={card.retail_price ?? ''} placeholder='e.g. $29.99, "$29.99 value"' />
          </div>

          <div style={fieldWrap}>
            <label style={labelStyle}>Page Type</label>
            <select name="page_type" defaultValue={card.page_type ?? ''}>
              <option value="">Select page type…</option>
              {PAGE_TYPE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>

          <h2 style={sectionTitle}>Creative Direction</h2>

          <div style={fieldWrap}>
            <label style={labelStyle}>Competitor Reference</label>
            <textarea name="competitor_reference" defaultValue={card.competitor_reference ?? ''} rows={2} style={{ resize: 'vertical' }} placeholder="Competitor LPs / ads worth referencing…" />
          </div>

          <div style={fieldWrap}>
            <label style={labelStyle}>Client Ad Inspiration</label>
            <textarea name="client_ad_inspiration" defaultValue={card.client_ad_inspiration ?? ''} rows={2} style={{ resize: 'vertical' }} />
          </div>

          <div style={fieldWrap}>
            <label style={labelStyle}>Product Images Link</label>
            <input type="url" name="product_images_link" defaultValue={card.product_images_link ?? ''} placeholder="Drive folder or external URL" />
          </div>

          {isEditor && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 18 }}>
              <button
                type="submit"
                style={{
                  padding: '8px 18px', borderRadius: 8, fontSize: 'var(--text-sm)', fontWeight: 600,
                  background: 'var(--accent)', color: 'white', border: 'none',
                  cursor: isPending ? 'wait' : 'pointer', opacity: isPending ? 0.7 : 1,
                }}
              >
                {isPending ? 'Saving…' : 'Save offer'}
              </button>
              {saved && !isPending && <span style={{ fontSize: 'var(--text-sm)', color: 'var(--success)' }}>Saved ✓</span>}
              {error && <span style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)' }}>{error}</span>}
            </div>
          )}
        </fieldset>
      </form>

      {isEditor && (
        <div style={{ marginTop: 36, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          {confirmingDelete ? (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                Delete this offer card? Its event history is kept, but the card is gone for good.
              </span>
              <button
                type="button"
                disabled={isPending}
                onClick={() => startTransition(async () => { await deleteOfferCard(card.id) })}
                style={{
                  padding: '6px 12px', borderRadius: 8, fontSize: 'var(--text-sm)', fontWeight: 600,
                  background: 'var(--danger)', color: 'white', border: 'none', cursor: 'pointer',
                }}
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                style={{
                  padding: '6px 12px', borderRadius: 8, fontSize: 'var(--text-sm)',
                  background: 'transparent', color: 'var(--text-muted)',
                  border: '1px solid var(--border)', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              style={{
                padding: '6px 12px', borderRadius: 8, fontSize: 'var(--text-sm)',
                background: 'transparent', color: 'var(--danger)',
                border: '1px solid color-mix(in srgb, var(--danger) 35%, transparent)', cursor: 'pointer',
              }}
            >
              Delete offer card
            </button>
          )}
        </div>
      )}
    </div>
  )
}
