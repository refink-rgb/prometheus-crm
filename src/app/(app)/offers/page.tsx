import { redirect } from 'next/navigation'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { canEdit, canViewCapacity } from '@/lib/permissions'
import { getCachedProfiles } from '@/lib/profiles'
import type { Brand, OfferCard } from '@/lib/types'
import OffersBoard from '@/components/OffersBoard'

type BoardOfferCard = OfferCard & { brands: { id: string; name: string } }

export default async function OffersPage() {
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) redirect('/login')
  const isEditor = await canEdit(user.email)

  const [{ data: cardsRaw, error: cardsError }, { data: brandsRaw }, profiles] = await Promise.all([
    supabase
      .from('offer_cards')
      .select('id, brand_id, target_month, moment_slot, name, stage, assigned_to, derived_production_card_id, brands(id, name)')
      .order('target_month', { ascending: false })
      .order('moment_slot', { ascending: true }),
    supabase
      .from('brands')
      .select('id, name, is_active')
      .order('name', { ascending: true }),
    getCachedProfiles(),
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

  // Offers are strategist-owned: the assignee picker lists the management
  // roster (Giovane / Lucas / Roberto), the same people canViewCapacity gates.
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

      <OffersBoard cards={cards} brands={brands} assignees={assignees} currentProfileId={currentProfileId} />
    </div>
  )
}
