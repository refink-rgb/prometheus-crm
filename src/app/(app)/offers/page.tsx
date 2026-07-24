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
  const isEditor = canEdit(user.email)

  const [{ data: cardsRaw }, { data: brandsRaw }, profiles] = await Promise.all([
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
