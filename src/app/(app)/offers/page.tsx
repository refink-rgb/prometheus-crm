import { redirect } from 'next/navigation'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { canEdit, canViewCapacity } from '@/lib/permissions'
import { getCachedProfiles } from '@/lib/profiles'
import type { Brand, OfferCard } from '@/lib/types'
import { buildOfferHistory, type OfferHistoryProject } from '@/lib/offer-history'
import OffersBoard from '@/components/OffersBoard'

type BoardOfferCard = OfferCard & { brands: { id: string; name: string } }

export default async function OffersPage() {
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) redirect('/login')
  const isEditor = await canEdit(user.email)

  const [
    { data: cardsRaw, error: cardsError },
    { data: brandsRaw },
    { data: projectsRaw, error: projectsError },
    profiles,
    { data: engineersRaw },
    { data: brandOwnersRaw },
  ] = await Promise.all([
    supabase
      .from('offer_cards')
      .select('id, brand_id, target_month, moment_slot, name, stage, assigned_to, offer_dynamics_type, offer, offer_description, product_featured, product_description, retail_price, page_type, competitor_reference, client_ad_inspiration, product_images_link, problem_statement, success_metric, success_target, guardrails, client_approval_message, strategist_approved_at, strategist_approved_by, engineer_approved_at, engineer_approved_by, changes_requested_at, changes_requested_by, changes_requested_note, derived_production_card_id, created_at, created_by, brands(id, name)')
      .order('target_month', { ascending: false })
      .order('moment_slot', { ascending: true }),
    supabase
      .from('brands')
      .select('id, name, is_active')
      .order('name', { ascending: true }),
    supabase
      .from('projects')
      .select('id, brand_id, name, due_date, created_at, marketing_moment, source_offer_card_id, offer_dynamics_type, offer, offer_description, product_featured, retail_price, page_type, discount, tiered_offer, shopify_coupon_code, is_complete, lp_stage, creatives_stage, brands(id, name)')
      .order('due_date', { ascending: false }),
    getCachedProfiles(),
    supabase
      .from('profit_engineers')
      .select('name, approval_token')
      .order('name', { ascending: true }),
    supabase
      .from('brands')
      .select('id, profit_engineer'),
  ])

  // Surface a failed query instead of silently rendering an empty board.
  // A failing select (e.g. a schema migration not yet applied in prod) used to
  // fall through to `cardsRaw ?? []` and look identical to "no offers yet".
  if (cardsError) {
    console.error('[offers] failed to load offer_cards:', cardsError)
    return (
      <div style={{ padding: '20px 24px 16px' }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: 8 }}>
          Offer Cycle
        </h1>
        <div style={{
          border: '1px solid var(--danger, #ef4444)',
          background: 'color-mix(in srgb, var(--danger, #ef4444) 10%, transparent)',
          borderRadius: 10,
          padding: '14px 16px',
          maxWidth: 640,
        }}>
          <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
            Couldn’t load offer cards
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>
            The board query failed, so no cards are shown — this does not mean the cards were deleted.
            A pending database migration is the most common cause. Check the Vercel runtime logs for details.
          </p>
          <pre style={{
            fontSize: 12,
            color: 'var(--text-muted)',
            background: 'var(--surface-2, rgba(0,0,0,0.2))',
            borderRadius: 6,
            padding: '8px 10px',
            overflowX: 'auto',
            margin: 0,
            whiteSpace: 'pre-wrap',
          }}>{cardsError.message}</pre>
        </div>
      </div>
    )
  }

  const cards = (cardsRaw ?? []) as unknown as BoardOfferCard[]
  const brands = (brandsRaw ?? []) as Pick<Brand, 'id' | 'name' | 'is_active'>[]
  if (projectsError) console.error('[offers] failed to load historical production offers:', projectsError)
  const history = buildOfferHistory(cards, (projectsRaw ?? []) as unknown as OfferHistoryProject[])

  // Offers are strategist-owned: the assignee picker lists the management
  // roster (Giovane / Lucas / Roberto), the same people canViewCapacity gates.
  // Each engineer's link plus how many of their offers are sitting in internal
  // review right now — the number is what makes the panel worth looking at.
  const brandEngineer = new Map(
    ((brandOwnersRaw ?? []) as { id: string; profit_engineer: string | null }[])
      .map(b => [b.id, b.profit_engineer]),
  )
  const waitingByEngineer = new Map<string, number>()
  for (const card of cards) {
    if (card.stage !== 'internal_offer_review') continue
    const owner = brandEngineer.get(card.brand_id)
    if (!owner) continue
    waitingByEngineer.set(owner, (waitingByEngineer.get(owner) ?? 0) + 1)
  }
  const engineerLinks = ((engineersRaw ?? []) as { name: string; approval_token: string | null }[])
    .filter(e => e.approval_token)
    .map(e => ({
      name: e.name,
      token: e.approval_token as string,
      waiting: waitingByEngineer.get(e.name) ?? 0,
    }))

  const assignees = profiles.filter(p => canViewCapacity(p.email))
  const currentProfileId = profiles.find(p => p.email === user.email?.toLowerCase())?.id ?? null

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100dvh',
      padding: '20px 24px 16px',
      overflow: 'hidden',
    }}>
      <div style={{ marginBottom: 14, flexShrink: 0 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: 4 }}>
          Offer Cycle
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {cards.length} offer card{cards.length !== 1 ? 's' : ''} · upstream of the Production Cycle
          {isEditor && ' · drag cards to advance an offer'}
        </p>
      </div>

      <OffersBoard
        cards={cards}
        history={history}
        brands={brands}
        assignees={assignees}
        currentProfileId={currentProfileId}
        engineerLinks={isEditor ? engineerLinks : []}
      />
    </div>
  )
}
