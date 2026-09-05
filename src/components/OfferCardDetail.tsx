'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  OFFER_STAGE_LABELS,
  OFFER_STAGE_ORDER,
  PAGE_TYPE_OPTIONS,
  offerMonthLabel,
  profileName,
  type Brand,
  type BrandDna,
  type OfferCard,
  type OfferStage,
  type Profile,
} from '@/lib/types'
import { OFFER_STAGE_COLORS } from '@/lib/stageColors'
import {
  assignOfferCard,
  deleteOfferCard,
  updateOfferDetails,
  updateOfferStage,
  type OfferDetailValues,
} from '@/lib/offer-actions'
import { offerCompletion, type OfferHistoryEntry } from '@/lib/offer-history'
import { offerCardMarkdown } from '@/lib/markdown-export'
import Avatar from '@/components/Avatar'
import ClientApprovalMessage from '@/components/ClientApprovalMessage'
import MarkdownActions from '@/components/MarkdownActions'
import OfferLibrary from '@/components/OfferLibrary'

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

type WorkspaceTab = 'overview' | 'offer' | 'product' | 'context' | 'history' | 'approval'

const TABS: Array<{ id: WorkspaceTab; label: string; short: string }> = [
  { id: 'overview', label: 'Overview', short: 'Overview' },
  { id: 'offer', label: 'Offer brief', short: 'Offer' },
  { id: 'product', label: 'Product + creative', short: 'Creative' },
  { id: 'context', label: 'Brand context', short: 'Context' },
  { id: 'history', label: 'Offer history', short: 'History' },
  { id: 'approval', label: 'Client approval', short: 'Approval' },
]

type OfferBrand = Pick<Brand,
  'id' | 'name' | 'website' | 'brand_notes' | 'growth_strategist' | 'profit_engineer' | 'start_date'
>

type OfferDna = Pick<BrandDna,
  'tagline' | 'positioning' | 'competitive_differentiation' | 'core_value_prop' |
  'top_pain_points' | 'proof_points' | 'common_offers' | 'price_anchor' |
  'top_objections' | 'winning_hooks' | 'offer_presentation'
>

const sectionTitle: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  fontWeight: 700,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  margin: '0 0 16px',
}

const field: React.CSSProperties = { marginBottom: 16 }
const hint: React.CSSProperties = {
  display: 'block',
  marginTop: 6,
  fontSize: 'var(--text-xs)',
  color: 'var(--text-muted)',
  lineHeight: 1.45,
}

export default function OfferCardDetail({
  card,
  brand,
  dna,
  history,
  isEditor,
  assignees,
}: {
  card: OfferCard
  brand: OfferBrand
  dna: OfferDna | null
  history: OfferHistoryEntry[]
  isEditor: boolean
  assignees: Profile[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [tab, setTab] = useState<WorkspaceTab>('overview')
  const [savedTab, setSavedTab] = useState<WorkspaceTab | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [owner, setOwnerLocal] = useState<string | null>(card.assigned_to)

  const stageColor = OFFER_STAGE_COLORS[card.stage]
  const ownerProfile = owner ? assignees.find(profile => profile.id === owner) : undefined
  const completion = offerCompletion(card)
  const markdown = () => offerCardMarkdown(
    card,
    ownerProfile ? profileName(ownerProfile) : null,
    {
      brandName: brand.name,
      website: brand.website,
      brandNotes: brand.brand_notes,
      dna,
      history,
    },
  )

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
    const previous = owner
    setOwnerLocal(profileId)
    setError(null)
    startTransition(async () => {
      try {
        await assignOfferCard(card.id, profileId)
        router.refresh()
      } catch (err) {
        setOwnerLocal(previous)
        setError(err instanceof Error ? err.message : 'Failed to assign owner.')
      }
    })
  }

  function saveForm(
    event: React.FormEvent<HTMLFormElement>,
    panel: 'offer' | 'product',
    keys: Array<keyof OfferDetailValues>,
  ) {
    event.preventDefault()
    setError(null)
    setSavedTab(null)
    const data = new FormData(event.currentTarget)
    const values = Object.fromEntries(keys.map(key => {
      const raw = String(data.get(key) ?? '').trim()
      if (key === 'success_target') {
        const parsed = raw ? Number(raw) : null
        return [key, parsed !== null && Number.isFinite(parsed) ? parsed : null]
      }
      return [key, raw || null]
    })) as Partial<OfferDetailValues>

    startTransition(async () => {
      try {
        await updateOfferDetails(card.id, values)
        setSavedTab(panel)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save the offer.')
      }
    })
  }

  return (
    <div>
      <section
        className="card"
        style={{
          padding: 0,
          overflow: 'hidden',
          borderTop: `3px solid ${stageColor.border}`,
          marginBottom: 16,
        }}
      >
        <div style={{ padding: '20px 22px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                <span style={{
                  fontSize: 'var(--text-2xs)', fontWeight: 700, color: stageColor.text,
                  background: stageColor.bg, border: `1px solid ${stageColor.border}`,
                  borderRadius: 20, padding: '3px 9px', textTransform: 'uppercase', letterSpacing: '0.06em',
                }}>
                  {OFFER_STAGE_LABELS[card.stage]}
                </span>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                  {offerMonthLabel(card.target_month)} · Moment {card.moment_slot}
                </span>
              </div>
              <h2 style={{
                fontSize: 21, fontWeight: 800, color: card.offer ? 'var(--text-primary)' : 'var(--text-muted)',
                letterSpacing: '-0.02em', lineHeight: 1.3, marginBottom: 7,
              }}>
                {card.offer?.trim() || 'Define this offer'}
              </h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-base)', lineHeight: 1.55, maxWidth: 700 }}>
                {card.offer_description?.trim() || 'Build the strategic rationale, mechanics, product story, and approval message in one place.'}
              </p>
            </div>
            <MarkdownActions
              markdown={markdown}
              filename={`${brand.name}-${offerMonthLabel(card.target_month)}-M${card.moment_slot}-offer`}
              copyLabel="Copy full brief"
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 18 }}>
            <div style={{ flex: 1, height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${completion.percent}%`, borderRadius: 3,
                background: completion.percent === 100 ? 'var(--success)' : 'var(--accent)',
                transition: 'width 0.25s ease',
              }} />
            </div>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', fontWeight: 650, whiteSpace: 'nowrap' }}>
              {completion.percent}% brief complete
            </span>
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--border)', padding: '13px 22px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', background: 'var(--surface-2)' }}>
          <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Owner</span>
          {ownerProfile && <Avatar name={profileName(ownerProfile)} size={24} title={profileName(ownerProfile)} />}
          <select
            value={owner ?? ''}
            onChange={event => setOwner(event.target.value || null)}
            disabled={!isEditor || isPending}
            aria-label="Offer owner"
            style={{ width: 'auto', minWidth: 150, fontSize: 'var(--text-sm)', padding: '6px 10px', fontWeight: owner ? 600 : 400 }}
          >
            <option value="">Unassigned</option>
            {assignees.map(profile => <option key={profile.id} value={profile.id}>{profileName(profile)}</option>)}
            {owner && !ownerProfile && <option value={owner}>Assigned (off roster)</option>}
          </select>
          <Link href={`/brands/${brand.id}`} style={{ marginLeft: 'auto', color: 'var(--accent)', fontSize: 'var(--text-sm)', textDecoration: 'none', fontWeight: 600 }}>
            Open brand →
          </Link>
        </div>
      </section>

      <section className="card" style={{ padding: '13px 16px', marginBottom: 16, overflowX: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', minWidth: 760 }}>
          {OFFER_STAGE_ORDER.map((stage, index) => {
            const color = OFFER_STAGE_COLORS[stage]
            const active = card.stage === stage
            const complete = OFFER_STAGE_ORDER.indexOf(card.stage) > index
            return (
              <div key={stage} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                <button
                  type="button"
                  disabled={!isEditor || isPending || active}
                  onClick={() => setStage(stage)}
                  className="focus-ring-pill"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 10px',
                    borderRadius: 20, border: `1px solid ${active ? color.border : 'transparent'}`,
                    background: active ? color.bg : 'transparent', color: active ? color.text : complete ? 'var(--text-secondary)' : 'var(--text-muted)',
                    fontSize: 'var(--text-sm)', fontWeight: active ? 700 : 500, cursor: isEditor && !active ? 'pointer' : 'default', whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{
                    width: 18, height: 18, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 9, fontWeight: 800, color: active || complete ? '#fff' : 'var(--text-muted)',
                    background: active ? color.border : complete ? 'var(--success)' : 'var(--surface-raised)', border: `1px solid ${active ? color.border : complete ? 'var(--success)' : 'var(--border)'}`,
                  }}>
                    {complete ? '✓' : index + 1}
                  </span>
                  {OFFER_STAGE_LABELS[stage]}
                </button>
                {index < OFFER_STAGE_ORDER.length - 1 && <div style={{ height: 1, flex: 1, minWidth: 12, background: complete ? 'var(--success)' : 'var(--border)', margin: '0 3px' }} />}
              </div>
            )
          })}
        </div>
      </section>

      {card.derived_production_card_id && (
        <div style={{
          display: 'flex', gap: 9, alignItems: 'center', background: 'color-mix(in srgb, var(--success) 8%, var(--surface))',
          border: '1px solid color-mix(in srgb, var(--success) 30%, transparent)', borderRadius: 10,
          padding: '11px 15px', marginBottom: 16, fontSize: 'var(--text-sm)',
        }}>
          <span style={{ color: 'var(--success)', fontWeight: 700 }}>✓ Production card created</span>
          <Link href={`/brands/${card.brand_id}/projects/${card.derived_production_card_id}`} style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>
            Open production →
          </Link>
        </div>
      )}

      {error && (
        <div role="alert" style={{ color: 'var(--danger)', background: 'color-mix(in srgb, var(--danger) 8%, var(--surface))', border: '1px solid color-mix(in srgb, var(--danger) 25%, transparent)', borderRadius: 9, padding: '10px 14px', marginBottom: 14, fontSize: 'var(--text-sm)' }}>
          {error}
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <nav role="tablist" aria-label="Offer workspace" className="offer-workspace-tabs" style={{ display: 'flex', gap: 2, overflowX: 'auto', borderBottom: '1px solid var(--border)', padding: '0 12px', background: 'var(--surface-2)' }}>
          {TABS.map(item => {
            const active = tab === item.id
            const count = item.id === 'history' ? history.length : item.id === 'context' && dna ? 1 : null
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(item.id)}
                style={{
                  position: 'relative', flexShrink: 0, border: 0, background: 'transparent',
                  color: active ? 'var(--text-primary)' : 'var(--text-muted)', padding: '14px 13px',
                  fontSize: 'var(--text-sm)', fontWeight: active ? 700 : 550, cursor: 'pointer',
                }}
              >
                <span className="offer-tab-label-long">{item.label}</span>
                <span className="offer-tab-label-short" style={{ display: 'none' }}>{item.short}</span>
                {count !== null && <span style={{ marginLeft: 6, fontSize: 9, color: active ? 'var(--accent)' : 'var(--text-muted)' }}>{count}</span>}
                {active && <span style={{ position: 'absolute', height: 2, left: 10, right: 10, bottom: -1, borderRadius: 2, background: 'var(--accent)' }} />}
              </button>
            )
          })}
        </nav>

        <div role="tabpanel" style={{ padding: '22px' }}>
          {tab === 'overview' && (
            <OverviewPanel
              card={card}
              brand={brand}
              dna={dna}
              history={history}
              completion={completion}
              onOpenTab={setTab}
              isEditor={isEditor}
              isPending={isPending}
              confirmingDelete={confirmingDelete}
              setConfirmingDelete={setConfirmingDelete}
              onDelete={() => startTransition(async () => { await deleteOfferCard(card.id) })}
            />
          )}

          {tab === 'offer' && (
            <form onSubmit={event => saveForm(event, 'offer', [
              'problem_statement', 'success_metric', 'success_target',
              'offer_dynamics_type', 'offer', 'offer_description', 'guardrails',
            ])}>
              <fieldset disabled={!isEditor || isPending} style={{ border: 0, padding: 0, margin: 0 }}>
                <div className="offer-form-columns" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, alignItems: 'start' }}>
                  <div>
                    <FormSection title="Strategy">
                      <Field label="Problem we’re solving">
                        <textarea name="problem_statement" defaultValue={card.problem_statement ?? ''} rows={3} placeholder="The specific customer or business problem this offer addresses." />
                      </Field>
                      <Field label="Success criteria" hint="Use the label to carry the unit: %, $, count, or ROAS.">
                        <div className="form-grid-2">
                          <input name="success_metric" defaultValue={card.success_metric ?? ''} placeholder="e.g. Purchase CVR (%)" />
                          <input type="number" name="success_target" step="any" defaultValue={card.success_target ?? ''} placeholder="Target, e.g. 3.5" />
                        </div>
                      </Field>
                    </FormSection>
                  </div>

                  <div>
                    <FormSection title="Offer mechanics">
                      <Field label="Offer dynamics">
                        <select name="offer_dynamics_type" defaultValue={card.offer_dynamics_type ?? ''}>
                          <option value="">Select type…</option>
                          {OFFER_DYNAMICS_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                        </select>
                      </Field>
                      <Field label="The offer" hint="The short, unambiguous version a client can approve.">
                        <input name="offer" defaultValue={card.offer ?? ''} placeholder="e.g. Buy 2, get 1 free" />
                      </Field>
                      <Field label="Full mechanics">
                        <textarea name="offer_description" defaultValue={card.offer_description ?? ''} rows={5} placeholder="Thresholds, eligible products, stacking rules, fulfillment, and customer experience." />
                      </Field>
                    </FormSection>

                    <FormSection title="Constraints">
                      <Field label="Guardrails" hint="Margin, inventory, legal, channel, and brand constraints. One per line.">
                        <textarea name="guardrails" defaultValue={card.guardrails ?? ''} rows={5} placeholder={'Protect a 55% contribution margin\nCap redemptions at 2,000 orders\nNo sitewide language'} />
                      </Field>
                    </FormSection>
                  </div>
                </div>
                <SaveBar pending={isPending} saved={savedTab === 'offer'} />
              </fieldset>
            </form>
          )}

          {tab === 'product' && (
            <form onSubmit={event => saveForm(event, 'product', [
              'product_featured', 'product_description', 'retail_price', 'page_type',
              'competitor_reference', 'client_ad_inspiration', 'product_images_link',
            ])}>
              <fieldset disabled={!isEditor || isPending} style={{ border: 0, padding: 0, margin: 0 }}>
                <div className="offer-form-columns" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, alignItems: 'start' }}>
                  <div>
                    <FormSection title="Product">
                      <Field label="Product featured">
                        <input name="product_featured" defaultValue={card.product_featured ?? ''} placeholder="Hero product, collection, or bundle" />
                      </Field>
                      <Field label="Product context" hint="What it is, why it matters, and any merchandising or inventory context.">
                        <textarea name="product_description" defaultValue={card.product_description ?? ''} rows={5} />
                      </Field>
                      <div className="form-grid-2">
                        <Field label="Retail price">
                          <input name="retail_price" defaultValue={card.retail_price ?? ''} placeholder="$29.99 / $90 value" />
                        </Field>
                        <Field label="Page type">
                          <select name="page_type" defaultValue={card.page_type ?? ''}>
                            <option value="">Select type…</option>
                            {PAGE_TYPE_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                          </select>
                        </Field>
                      </div>
                    </FormSection>
                  </div>

                  <div>
                    <FormSection title="Creative direction">
                      <Field label="Competitor reference" hint="URLs or notes on comparable offers and how this one should differ.">
                        <textarea name="competitor_reference" defaultValue={card.competitor_reference ?? ''} rows={4} />
                      </Field>
                      <Field label="Client ad inspiration">
                        <textarea name="client_ad_inspiration" defaultValue={card.client_ad_inspiration ?? ''} rows={4} placeholder="Existing ads, creative territories, or visual cues the client wants carried forward." />
                      </Field>
                      <Field label="Product images link">
                        <input type="url" name="product_images_link" defaultValue={card.product_images_link ?? ''} placeholder="Drive folder or external asset URL" />
                      </Field>
                      {card.product_images_link && (
                        <a href={card.product_images_link} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', color: 'var(--accent)', fontSize: 'var(--text-sm)', fontWeight: 600, textDecoration: 'none' }}>
                          Open product assets ↗
                        </a>
                      )}
                    </FormSection>
                  </div>
                </div>
                <SaveBar pending={isPending} saved={savedTab === 'product'} />
              </fieldset>
            </form>
          )}

          {tab === 'context' && <BrandContextPanel brand={brand} dna={dna} />}

          {tab === 'history' && (
            <div>
              <PanelIntro title={`${brand.name} offer history`} body="Offer Cycle cards and older Production briefs are combined here. Linked records appear once, with a shortcut to Production." />
              <OfferLibrary entries={history} assignees={assignees} currentOfferId={card.id} compact />
            </div>
          )}

          {tab === 'approval' && (
            <div>
              <PanelIntro title="Client approval" body="Generate the client-ready message from the saved brief, edit it in place, then copy the exact final version you send." />
              {card.stage === 'auto_generated' && (
                <div style={{ padding: '10px 13px', marginBottom: 14, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                  Finish the Offer brief first for a stronger approval message.
                </div>
              )}
              <ClientApprovalMessage cardId={card.id} initialMessage={card.client_approval_message} isEditor={isEditor} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function OverviewPanel({
  card,
  brand,
  dna,
  history,
  completion,
  onOpenTab,
  isEditor,
  isPending,
  confirmingDelete,
  setConfirmingDelete,
  onDelete,
}: {
  card: OfferCard
  brand: OfferBrand
  dna: OfferDna | null
  history: OfferHistoryEntry[]
  completion: ReturnType<typeof offerCompletion>
  onOpenTab: (tab: WorkspaceTab) => void
  isEditor: boolean
  isPending: boolean
  confirmingDelete: boolean
  setConfirmingDelete: (value: boolean) => void
  onDelete: () => void
}) {
  const facts = [
    ['Problem', card.problem_statement],
    ['Offer', card.offer],
    ['Mechanics', card.offer_dynamics_type],
    ['Product', card.product_featured],
    ['Success', card.success_metric ? `${card.success_metric}${card.success_target != null ? ` · ${card.success_target}` : ''}` : null],
  ]
  const missing = completion.items.filter(item => !item.done)

  return (
    <div>
      <div className="offer-overview-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.45fr) minmax(280px, .75fr)', gap: 18, alignItems: 'start' }}>
        <div>
          <h3 style={sectionTitle}>Decision snapshot</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
            {facts.map(([label, value], index) => (
              <div key={label} style={{ padding: '14px 15px', minHeight: 82, borderRight: index % 2 === 0 ? '1px solid var(--border)' : undefined, borderBottom: index < facts.length - 2 ? '1px solid var(--border)' : undefined }}>
                <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, marginBottom: 7 }}>{label}</div>
                <div style={{ fontSize: 'var(--text-base)', color: value ? 'var(--text-primary)' : 'var(--text-muted)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{value || 'Not defined yet'}</div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 18 }}>
            <h3 style={sectionTitle}>Available context</h3>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <ContextShortcut label="Brand DNA" detail={dna ? 'Ready to use' : 'Not built yet'} ready={Boolean(dna)} onClick={() => onOpenTab('context')} />
              <ContextShortcut label="Offer history" detail={`${history.length} record${history.length === 1 ? '' : 's'}`} ready={history.length > 0} onClick={() => onOpenTab('history')} />
              <ContextShortcut label="Account notes" detail={brand.brand_notes ? 'Context available' : 'No notes yet'} ready={Boolean(brand.brand_notes)} onClick={() => onOpenTab('context')} />
              <ContextShortcut label="Approval message" detail={card.client_approval_message ? 'Draft saved' : 'Not generated'} ready={Boolean(card.client_approval_message)} onClick={() => onOpenTab('approval')} />
            </div>
          </div>
        </div>

        <aside style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '13px 15px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text-primary)' }}>Brief readiness</div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 3 }}>{completion.complete} of {completion.total} checkpoints complete</div>
          </div>
          <div style={{ padding: '6px 0' }}>
            {completion.items.map(item => (
              <button
                key={item.label}
                type="button"
                onClick={() => onOpenTab(item.tab)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, border: 0, background: 'transparent', color: item.done ? 'var(--text-secondary)' : 'var(--text-primary)', padding: '8px 14px', cursor: 'pointer', textAlign: 'left', fontSize: 'var(--text-sm)' }}
              >
                <span style={{ width: 18, height: 18, display: 'inline-flex', justifyContent: 'center', alignItems: 'center', borderRadius: '50%', fontSize: 10, fontWeight: 800, flexShrink: 0, color: item.done ? '#fff' : 'var(--text-muted)', background: item.done ? 'var(--success)' : 'var(--surface-raised)', border: `1px solid ${item.done ? 'var(--success)' : 'var(--border)'}` }}>
                  {item.done ? '✓' : '·'}
                </span>
                <span style={{ flex: 1 }}>{item.label}</span>
                {!item.done && <span style={{ color: 'var(--accent)', fontSize: 10 }}>Add →</span>}
              </button>
            ))}
          </div>
          {missing.length === 0 && <div style={{ margin: '4px 12px 12px', padding: '9px 11px', borderRadius: 7, color: 'var(--success)', background: 'color-mix(in srgb, var(--success) 9%, transparent)', fontSize: 'var(--text-sm)', fontWeight: 650 }}>Ready for review</div>}
        </aside>
      </div>

      {isEditor && (
        <div style={{ marginTop: 30, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          {confirmingDelete ? (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Delete this offer? Historical events remain, but the card cannot be recovered.</span>
              <button type="button" className="btn-danger btn-sm" disabled={isPending} onClick={onDelete}>Delete</button>
              <button type="button" className="btn-secondary btn-sm" onClick={() => setConfirmingDelete(false)}>Cancel</button>
            </div>
          ) : (
            <button type="button" className="btn-danger btn-sm" onClick={() => setConfirmingDelete(true)}>Delete offer</button>
          )}
        </div>
      )}
    </div>
  )
}

function BrandContextPanel({ brand, dna }: { brand: OfferBrand; dna: OfferDna | null }) {
  return (
    <div>
      <PanelIntro title={`${brand.name} context`} body="Reusable brand truth lives here beside the offer so you can make the decision without bouncing between pages." />

      <div className="offer-context-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 }}>
        <ContextCard title="Positioning">
          <ContextValue label="Tagline" value={dna?.tagline} />
          <ContextValue label="Positioning" value={dna?.positioning} />
          <ContextValue label="Core value proposition" value={dna?.core_value_prop} />
          <ContextValue label="Differentiation" value={dna?.competitive_differentiation} />
        </ContextCard>
        <ContextCard title="Offer patterns">
          <ContextValue label="Common offers" value={dna?.common_offers} list />
          <ContextValue label="Price anchor" value={dna?.price_anchor} />
          <ContextValue label="Offer presentation" value={dna?.offer_presentation} />
        </ContextCard>
        <ContextCard title="Customer truth">
          <ContextValue label="Top pain points" value={dna?.top_pain_points} list />
          <ContextValue label="Top objections" value={dna?.top_objections} list />
        </ContextCard>
        <ContextCard title="Proof + hooks">
          <ContextValue label="Brand proof points" value={dna?.proof_points} list />
          <ContextValue label="Winning hooks" value={dna?.winning_hooks} list />
        </ContextCard>
      </div>

      <div className="card" style={{ marginTop: 14, padding: '17px 18px' }}>
        <h3 style={{ ...sectionTitle, marginBottom: 12 }}>Account context</h3>
        <div className="offer-account-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 14, marginBottom: brand.brand_notes ? 16 : 0 }}>
          <ContextValue label="Website" value={brand.website} link />
          <ContextValue label="Growth strategist" value={brand.growth_strategist} />
          <ContextValue label="Profit engineer" value={brand.profit_engineer} />
        </div>
        {brand.brand_notes && <ContextValue label="Account notes" value={brand.brand_notes} />}
        {!dna && (
          <div style={{ marginTop: 15, padding: '11px 13px', border: '1px dashed var(--border-strong)', borderRadius: 8, color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
            Brand DNA has not been built yet. <Link href={`/brands/${brand.id}`} style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>Build it on the brand page →</Link>
          </div>
        )}
      </div>
    </div>
  )
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '17px 18px', marginBottom: 18 }}>
      <h3 style={sectionTitle}>{title}</h3>
      {children}
    </section>
  )
}

function Field({ label, hint: help, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={field}>
      <label>{label}</label>
      {children}
      {help && <span style={hint}>{help}</span>}
    </div>
  )
}

function SaveBar({ pending, saved }: { pending: boolean; saved: boolean }) {
  return (
    <div style={{ position: 'sticky', bottom: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0 0', background: 'var(--surface)', borderTop: '1px solid var(--border)' }}>
      <button type="submit" className="btn-primary">{pending ? 'Saving…' : 'Save changes'}</button>
      {saved && !pending && <span style={{ color: 'var(--success)', fontSize: 'var(--text-sm)', fontWeight: 600 }}>Saved ✓</span>}
      <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>Markdown uses saved values</span>
    </div>
  )
}

function PanelIntro({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <h3 style={{ fontSize: 'var(--text-md)', color: 'var(--text-primary)', fontWeight: 750, marginBottom: 5 }}>{title}</h3>
      <p style={{ fontSize: 'var(--text-base)', color: 'var(--text-muted)', lineHeight: 1.55 }}>{body}</p>
    </div>
  )
}

function ContextShortcut({ label, detail, ready, onClick }: { label: string; detail: string; ready: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ minWidth: 150, flex: '1 1 150px', textAlign: 'left', padding: '11px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', cursor: 'pointer' }}>
      <span style={{ display: 'block', fontSize: 'var(--text-sm)', color: 'var(--text-primary)', fontWeight: 650 }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--text-xs)', color: ready ? 'var(--success)' : 'var(--text-muted)', marginTop: 4 }}>
        <span>{ready ? '●' : '○'}</span>{detail}
      </span>
    </button>
  )
}

function ContextCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '16px 17px', background: 'var(--surface-2)' }}>
      <h3 style={{ ...sectionTitle, color: 'var(--text-secondary)', marginBottom: 13 }}>{title}</h3>
      {children}
    </section>
  )
}

function ContextValue({ label, value, list = false, link = false }: { label: string; value: string | string[] | null | undefined; list?: boolean; link?: boolean }) {
  const values = Array.isArray(value) ? value.filter(Boolean) : []
  const empty = Array.isArray(value) ? values.length === 0 : !value?.trim()
  return (
    <div style={{ marginBottom: 13 }}>
      <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5 }}>{label}</div>
      {empty ? (
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>Not captured</div>
      ) : list || Array.isArray(value) ? (
        <ul style={{ margin: 0, paddingLeft: 17, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {(Array.isArray(value) ? values : String(value).split('\n').filter(Boolean)).map((item, index) => <li key={`${item}-${index}`} style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.45 }}>{item}</li>)}
        </ul>
      ) : link ? (
        <a href={String(value)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', fontSize: 'var(--text-sm)', textDecoration: 'none', overflowWrap: 'anywhere' }}>{String(value)} ↗</a>
      ) : (
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{String(value)}</div>
      )}
    </div>
  )
}



