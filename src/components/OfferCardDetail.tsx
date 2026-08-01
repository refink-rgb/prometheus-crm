'use client'

// Offer card detail: stage stepper + the Offer Draft form + delete.
//
// The form is uncontrolled by design (defaultValue + FormData on save),
// following ProjectEditForm's re-render-perf lesson. Field set = the
// signed-off Phase 0 list: strategic + creative-only, no copy fields.
//
// Presentation reuses the shared design system (.card, global label/input
// styling, .form-grid-2, .btn-* classes) and the OFFER_STAGE_COLORS ramp so
// this detail view reads as the same product as the Offer Cycle / pipeline
// boards, not a bespoke settings form.

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  OFFER_STAGE_LABELS, OFFER_STAGE_ORDER,
  PAGE_TYPE_OPTIONS, profileName,
  type OfferCard, type OfferStage, type Profile,
} from '@/lib/types'
import { OFFER_STAGE_COLORS } from '@/lib/stageColors'
import { assignOfferCard, deleteOfferCard, updateOfferDetails, updateOfferStage } from '@/lib/offer-actions'
import Avatar from '@/components/Avatar'

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
  assignees,
}: {
  card: OfferCard
  isEditor: boolean
  /** Roster the owner picker offers — the strategist/management set. */
  assignees: Profile[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  // Optimistic owner: reflect the pick immediately, roll back on failure.
  const [owner, setOwnerLocal] = useState<string | null>(card.assigned_to)

  const stageColor = OFFER_STAGE_COLORS[card.stage]
  const ownerProfile = owner ? assignees.find(p => p.id === owner) : undefined

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

  function setOwner(profileId: string | null) {
    const prev = owner
    setOwnerLocal(profileId)
    setError(null)
    startTransition(async () => {
      try {
        await assignOfferCard(card.id, profileId)
        router.refresh()
      } catch (err) {
        setOwnerLocal(prev)
        setError(err instanceof Error ? err.message : 'Failed to assign owner.')
      }
    })
  }

  function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSaved(false)
    const fd = new FormData(e.currentTarget)
    const str = (key: string) => (fd.get(key) as string)?.trim() || null
    // Blank stays NULL rather than becoming 0 — an unset target and a target of
    // zero are different answers.
    const num = (key: string) => {
      const raw = str(key)
      if (raw === null) return null
      const n = Number(raw)
      return Number.isFinite(n) ? n : null
    }
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
          problem_statement: str('problem_statement'),
          success_metric: str('success_metric'),
          success_target: num('success_target'),
          guardrails: str('guardrails'),
        })
        setSaved(true)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save.')
      }
    })
  }

  const sectionTitle: React.CSSProperties = {
    fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text-muted)',
    textTransform: 'uppercase', letterSpacing: '0.08em',
    margin: '0 0 16px',
  }
  const field: React.CSSProperties = { marginBottom: 14 }
  const hint: React.CSSProperties = {
    display: 'block', marginTop: 6,
    fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
  }

  return (
    <div>
      {/* Stage stepper — carries the offer's stage color as a left accent so it
          echoes the board card it came from. */}
      <div
        className="card"
        style={{
          display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center',
          borderLeft: `3px solid ${stageColor.border}`,
          padding: '12px 16px', marginBottom: 16,
        }}
      >
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

      {/* Owner — who's driving this offer. Restricted to the strategist roster. */}
      <div
        className="card"
        style={{
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          padding: '12px 16px', marginBottom: 16,
        }}
      >
        <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Owner
        </span>
        {ownerProfile && <Avatar name={profileName(ownerProfile)} size={24} title={profileName(ownerProfile)} />}
        <select
          value={owner ?? ''}
          onChange={e => setOwner(e.target.value || null)}
          disabled={!isEditor || isPending}
          aria-label="Offer owner"
          style={{
            width: 'auto',
            fontSize: 'var(--text-sm)', fontWeight: owner ? 600 : 400,
            color: owner ? 'var(--text-primary)' : 'var(--text-muted)',
            background: 'var(--surface-raised)', border: '1px solid var(--border)',
            borderRadius: 7, padding: '5px 10px', cursor: isEditor ? 'pointer' : 'default',
            opacity: isPending ? 0.6 : 1,
          }}
        >
          <option value="">Unassigned</option>
          {assignees.map(p => <option key={p.id} value={p.id}>{profileName(p)}</option>)}
          {owner && !ownerProfile && <option value={owner}>Assigned (off roster)</option>}
        </select>
      </div>

      {/* Trigger B outcome: approval auto-creates the production card. */}
      {card.derived_production_card_id && (
        <div style={{
          display: 'flex', gap: 8, alignItems: 'center',
          background: 'color-mix(in srgb, var(--success) 8%, var(--surface))',
          border: '1px solid color-mix(in srgb, var(--success) 30%, transparent)',
          borderRadius: 12, padding: '12px 16px', marginBottom: 16,
          fontSize: 'var(--text-sm)',
        }}>
          <span style={{ color: 'var(--success)', fontWeight: 600 }}>✓ Production card created</span>
          <Link
            href={`/brands/${card.brand_id}/projects/${card.derived_production_card_id}`}
            style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}
          >
            Open it →
          </Link>
        </div>
      )}

      <form onSubmit={handleSave}>
        <fieldset disabled={!isEditor || isPending} style={{ border: 'none', padding: 0, margin: 0 }}>
          <section className="card" style={{ marginBottom: 16 }}>
            <h2 style={sectionTitle}>The Offer</h2>

            <div style={field}>
              <label>Offer Dynamics</label>
              <select name="offer_dynamics_type" defaultValue={card.offer_dynamics_type ?? ''} style={{ marginBottom: 8 }}>
                <option value="">Select type…</option>
                {OFFER_DYNAMICS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
              <input type="text" name="offer" defaultValue={card.offer ?? ''} placeholder="Details — e.g. Buy 2 Get 1 Free, 20% off orders $75+" />
            </div>

            <div style={{ ...field, marginBottom: 0 }}>
              <label>Offer Description</label>
              <textarea name="offer_description" defaultValue={card.offer_description ?? ''} rows={4} style={{ resize: 'vertical' }} placeholder="The full mechanics and angle of this offer…" />
            </div>
          </section>

          {/* Rationale — why this offer exists and how it gets judged. All
              optional: cards are auto-generated empty and a half-written draft
              must stay saveable. */}
          <section className="card" style={{ marginBottom: 16 }}>
            <h2 style={sectionTitle}>Rationale</h2>

            <div style={field}>
              <label>Problem we&apos;re solving</label>
              <textarea
                name="problem_statement"
                defaultValue={card.problem_statement ?? ''}
                rows={2}
                style={{ resize: 'vertical' }}
                placeholder="The specific problem this moment exists to solve — two lines is plenty."
              />
            </div>

            <div style={field}>
              <label>How we&apos;ll judge it</label>
              <div className="form-grid-2">
                <input
                  type="text"
                  name="success_metric"
                  defaultValue={card.success_metric ?? ''}
                  placeholder="e.g. Purchase conversion rate"
                />
                <input
                  type="number"
                  name="success_target"
                  step="any"
                  defaultValue={card.success_target ?? ''}
                  placeholder="Target — e.g. 3.5"
                />
              </div>
              <span style={hint}>The metric, and the number that means it worked.</span>
            </div>

            <div style={{ ...field, marginBottom: 0 }}>
              <label>Guardrails</label>
              <textarea
                name="guardrails"
                defaultValue={card.guardrails ?? ''}
                rows={4}
                style={{ resize: 'vertical' }}
                placeholder={'Never discount below 20% margin\nNo sitewide code — collection only\nStays off the homepage hero'}
              />
              <span style={hint}>One per line.</span>
            </div>
          </section>

          <section className="card" style={{ marginBottom: 16 }}>
            <h2 style={sectionTitle}>Product</h2>

            <div style={field}>
              <label>Product Featured</label>
              <input type="text" name="product_featured" defaultValue={card.product_featured ?? ''} placeholder="e.g. Viking Beard Oil 3-Pack" />
            </div>

            <div style={field}>
              <label>Product Description</label>
              <textarea name="product_description" defaultValue={card.product_description ?? ''} rows={2} style={{ resize: 'vertical' }} />
            </div>

            <div className="form-grid-2" style={{ marginBottom: 0 }}>
              <div>
                <label>Retail Price</label>
                <input type="text" name="retail_price" defaultValue={card.retail_price ?? ''} placeholder='e.g. $29.99, "$29.99 value"' />
              </div>
              <div>
                <label>Page Type</label>
                <select name="page_type" defaultValue={card.page_type ?? ''}>
                  <option value="">Select page type…</option>
                  {PAGE_TYPE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            </div>
          </section>

          <section className="card" style={{ marginBottom: 16 }}>
            <h2 style={sectionTitle}>Creative Direction</h2>

            <div style={field}>
              <label>Competitor Reference</label>
              <textarea name="competitor_reference" defaultValue={card.competitor_reference ?? ''} rows={2} style={{ resize: 'vertical' }} placeholder="Competitor LPs / ads worth referencing…" />
            </div>

            <div style={field}>
              <label>Client Ad Inspiration</label>
              <textarea name="client_ad_inspiration" defaultValue={card.client_ad_inspiration ?? ''} rows={2} style={{ resize: 'vertical' }} />
            </div>

            <div style={{ ...field, marginBottom: 0 }}>
              <label>Product Images Link</label>
              <input type="url" name="product_images_link" defaultValue={card.product_images_link ?? ''} placeholder="Drive folder or external URL" />
            </div>
          </section>

          {isEditor && (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 4 }}>
              <button type="submit" className="btn-primary">
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
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                Delete this offer card? Its event history is kept, but the card is gone for good.
              </span>
              <button
                type="button"
                className="btn-danger btn-sm"
                disabled={isPending}
                onClick={() => startTransition(async () => { await deleteOfferCard(card.id) })}
              >
                Delete
              </button>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => setConfirmingDelete(false)}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn-danger btn-sm"
              onClick={() => setConfirmingDelete(true)}
            >
              Delete offer card
            </button>
          )}
        </div>
      )}
    </div>
  )
}
