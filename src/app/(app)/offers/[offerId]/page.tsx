import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { canEdit, canViewCapacity } from '@/lib/permissions'
import { getCachedProfiles } from '@/lib/profiles'
import { offerMonthLabel, type OfferCard } from '@/lib/types'
import OfferCardDetail from '@/components/OfferCardDetail'

type OfferWithBrand = OfferCard & { brands: { id: string; name: string } }

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
  const isEditor = canEdit(user.email)

  const [{ data: cardRaw }, profiles] = await Promise.all([
    supabase
      .from('offer_cards')
      .select('*, brands(id, name)')
      .eq('id', offerId)
      .single(),
    getCachedProfiles(),
  ])
  if (!cardRaw) notFound()

  const card = cardRaw as unknown as OfferWithBrand
  const assignees = profiles.filter(p => canViewCapacity(p.email))

  return (
    <div style={{ padding: '24px', maxWidth: 860, margin: '0 auto' }}>
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

      <OfferCardDetail card={card} isEditor={isEditor} assignees={assignees} />
    </div>
  )
}
