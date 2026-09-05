import OfferCardDetail from '@/components/OfferCardDetail'
import type { Brand, BrandDna, OfferCard, Profile } from '@/lib/types'
import type { OfferHistoryEntry } from '@/lib/offer-history'

export default function OfferPreviewPage() {
  const card = {
    id: 'preview-offer', brand_id: 'preview-brand', target_month: '2026-09-01', moment_slot: 1,
    name: 'Evergreen Goods · September 2026 · M1 Offer', stage: 'offer_draft', assigned_to: 'preview-owner',
    offer_dynamics_type: 'Bundle', offer: 'Build Your Fall Routine — Save 20%',
    offer_description: 'Choose any three daily essentials and save 20%. Free shipping applies above $75.',
    product_featured: 'Daily Essentials Collection', product_description: 'The brand’s high-repeat core range with strong cross-sell behavior.',
    retail_price: '$72–$96 bundle value', page_type: 'Bundle Builder',
    competitor_reference: 'Position against category-wide site sales by emphasizing routine-building.',
    client_ad_inspiration: 'Carry forward the clean product-stack framing from the summer campaign.',
    product_images_link: 'https://example.com/assets', problem_statement: 'New visitors understand individual products but struggle to build a complete routine.',
    success_metric: 'First-order AOV ($)', success_target: 84, guardrails: 'Protect 55% contribution margin\nCap at 2,000 redemptions',
    client_approval_message: 'For September M1, we recommend a Build Your Fall Routine bundle.',
    derived_production_card_id: null, created_at: '2026-08-20T12:00:00Z', created_by: null,
  } as OfferCard
  const brand = {
    id: 'preview-brand', name: 'Evergreen Goods', website: 'https://example.com',
    brand_notes: 'Protect the premium position. The client prefers value-add language over sale language.',
    growth_strategist: 'Lucas', profit_engineer: 'Roberto', start_date: '2025-04-01',
  } as Pick<Brand, 'id' | 'name' | 'website' | 'brand_notes' | 'growth_strategist' | 'profit_engineer' | 'start_date'>
  const dna = {
    tagline: 'Better rituals, every day.', positioning: 'Premium daily essentials designed to simplify high-quality routines.',
    competitive_differentiation: 'A tight, interoperable system instead of a sprawling catalog.',
    core_value_prop: 'Fewer, better products that work naturally together.',
    top_pain_points: ['Too many choices', 'Unsure which products work together'],
    proof_points: ['50,000+ five-star reviews', '30-day satisfaction guarantee'],
    common_offers: ['Starter bundles', 'Gift with purchase'], price_anchor: '$90 routine value',
    top_objections: ['Premium price', 'Unclear routine order'], winning_hooks: ['Your routine, simplified', 'Three steps. Every day.'],
    offer_presentation: 'Lead with the complete-routine value before the discount.',
  } as Pick<BrandDna, 'tagline' | 'positioning' | 'competitive_differentiation' | 'core_value_prop' | 'top_pain_points' | 'proof_points' | 'common_offers' | 'price_anchor' | 'top_objections' | 'winning_hooks' | 'offer_presentation'>
  const history: OfferHistoryEntry[] = [
    { key: 'offer:preview-offer', source: 'offer_cycle', id: 'preview-offer', brandId: 'preview-brand', brandName: 'Evergreen Goods', title: 'Build Your Fall Routine — Save 20%', description: null, objective: 'New visitors understand individual products but struggle to build a complete routine.', mechanics: 'Bundle', product: 'Daily Essentials Collection', retailPrice: '$72–$96', pageType: 'Bundle Builder', targetMonth: '2026-09-01', momentSlot: 1, status: 'Offer Draft', offerStage: 'offer_draft', ownerId: 'preview-owner', href: '#', productionProjectId: null, productionHref: null, createdAt: '2026-08-20T12:00:00Z' },
    { key: 'production:summer', source: 'legacy_production', id: 'summer', brandId: 'preview-brand', brandName: 'Evergreen Goods', title: 'Summer Starter Set — Free Travel Pouch', description: null, objective: null, mechanics: 'Gift With Purchase', product: 'Starter Set', retailPrice: '$68', pageType: 'Listicle', targetMonth: '2026-07-01', momentSlot: 2, status: 'Completed', offerStage: null, ownerId: null, href: '#', productionProjectId: 'summer', productionHref: '#', createdAt: '2026-06-20T12:00:00Z' },
  ]
  const assignees = [{ id: 'preview-owner', email: 'lucas@example.com', full_name: 'Lucas', role: 'admin', can_edit: true, is_lp_editor: false, is_creative_editor: false, created_at: '2025-01-01T00:00:00Z' }] as Profile[]

  return <div style={{ width: '100%', minWidth: 0 }}><main style={{ maxWidth: 1120, margin: '0 auto', padding: 24, minWidth: 0 }}><OfferCardDetail card={card} brand={brand} dna={dna} history={history} isEditor={false} assignees={assignees} /></main></div>
}
