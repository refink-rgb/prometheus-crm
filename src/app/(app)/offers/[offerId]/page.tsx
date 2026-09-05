import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { canEdit, canViewCapacity } from '@/lib/permissions'
import { getCachedProfiles } from '@/lib/profiles'
import { offerMonthLabel, type Brand, type BrandDna, type OfferCard } from '@/lib/types'
import { buildOfferHistory, type OfferHistoryCard, type OfferHistoryProject } from '@/lib/offer-history'
import OfferCardDetail from '@/components/OfferCardDetail'

type OfferBrand = Pick<Brand,
  'id' | 'name' | 'website' | 'brand_notes' | 'growth_strategist' | 'profit_engineer' | 'start_date'
>
type OfferWithBrand = OfferCard & { brands: OfferBrand }

// The approval-message generation runs as a server action on this route and
// takes ~10s against Gemini — comfortably over Vercel's default timeout.
export const maxDuration = 60

export default async function OfferPage({
  params,
}: {
  params: Promise<{ offerId: string }>
}) {
  const { offerId } = await params
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) redirect('/login')
  const isEditor = await canEdit(user.email)

  const [{ data: cardRaw }, profiles] = await Promise.all([
    supabase
      .from('offer_cards')
      .select('*, brands(id, name, website, brand_notes, growth_strategist, profit_engineer, start_date)')
      .eq('id', offerId)
      .single(),
    getCachedProfiles(),
  ])
  if (!cardRaw) notFound()

  const card = cardRaw as unknown as OfferWithBrand
  const assignees = profiles.filter(p => canViewCapacity(p.email))

  const [
    { data: dnaRaw },
    { data: brandOffersRaw },
    { data: brandProjectsRaw },
  ] = await Promise.all([
    supabase
      .from('brand_dna')
      .select('tagline, positioning, competitive_differentiation, core_value_prop, top_pain_points, proof_points, common_offers, price_anchor, top_objections, winning_hooks, offer_presentation')
      .eq('brand_id', card.brand_id)
      .eq('is_active', true)
      .maybeSingle(),
    supabase
      .from('offer_cards')
      .select('*, brands(id, name)')
      .eq('brand_id', card.brand_id)
      .order('target_month', { ascending: false }),
    supabase
      .from('projects')
      .select('id, brand_id, name, due_date, created_at, marketing_moment, source_offer_card_id, offer_dynamics_type, offer, offer_description, product_featured, retail_price, page_type, discount, tiered_offer, shopify_coupon_code, is_complete, lp_stage, creatives_stage, brands(id, name)')
      .eq('brand_id', card.brand_id)
      .order('due_date', { ascending: false }),
  ])

  const history = buildOfferHistory(
    (brandOffersRaw ?? []) as unknown as OfferHistoryCard[],
    (brandProjectsRaw ?? []) as unknown as OfferHistoryProject[],
  )
  const dna = (dnaRaw ?? null) as Pick<BrandDna,
    'tagline' | 'positioning' | 'competitive_differentiation' | 'core_value_prop' |
    'top_pain_points' | 'proof_points' | 'common_offers' | 'price_anchor' |
    'top_objections' | 'winning_hooks' | 'offer_presentation'
  > | null

  return (
    <div style={{ padding: '24px', maxWidth: 1120, margin: '0 auto' }}>
      <div style={{ marginBottom: 18 }}>
        <Link href="/offers" style={{ fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none' }}>
          ← Offer Cycle
        </Link>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', margin: '8px 0 2px' }}>
          {card.brands.name}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {offerMonthLabel(card.target_month)} · M{card.moment_slot} Offer
        </p>
      </div>

      <OfferCardDetail
        card={card}
        brand={card.brands}
        dna={dna}
        history={history}
        isEditor={isEditor}
        assignees={assignees}
      />
    </div>
  )
}
