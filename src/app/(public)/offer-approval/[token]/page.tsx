import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/service'
import type { OfferCard } from '@/lib/types'
import ClientOfferDeck, { type ClientOfferSlide } from '@/components/ClientOfferDeck'
import ThemeToggle from '@/components/ThemeToggle'

// The client-facing offer approval deck.
//
// Keyed by the brand's existing client_token (same token as /portal), so no
// new link has to be minted. The queue is computed per request: any offer of
// theirs that reaches Client Review appears here on the next load, and drops
// off once approved.

export const dynamic = 'force-dynamic'

type ClientOffer = OfferCard & { brands: { id: string; name: string } }

export default async function OfferApprovalPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  if (!/^[a-f0-9]{40}$/.test(token)) notFound()

  const supabase = createServiceClient()

  const { data: brand } = await supabase
    .from('brands')
    .select('id, name')
    .eq('client_token', token)
    .single()

  if (!brand) notFound()

  const { data: cardsRaw, error } = await supabase
    .from('offer_cards')
    .select(
      `id, brand_id, target_month, moment_slot, name, stage, offer, offer_description,
       offer_dynamics_type, product_featured, retail_price, page_type,
       client_approval_message, client_changes_requested_at, client_changes_requested_by,
       client_changes_requested_note, brands(id, name)`,
    )
    .eq('brand_id', brand.id)
    .eq('stage', 'client_review')
    .order('target_month', { ascending: true })
    .order('moment_slot', { ascending: true })

  if (error) console.error('[offer-approval] failed to load offers:', error)
  const cards = (cardsRaw ?? []) as unknown as ClientOffer[]

  // Strategists can float competing candidates for one moment. The client
  // never sees the moment itself, so without this two slides would look like
  // two separate offers to approve rather than a pick-one.
  const perMoment = new Map<string, number>()
  for (const card of cards) {
    const key = `${card.target_month}#${card.moment_slot}`
    perMoment.set(key, (perMoment.get(key) ?? 0) + 1)
  }
  const seenInMoment = new Map<string, number>()

  const slides: ClientOfferSlide[] = cards.map(card => {
    const key = `${card.target_month}#${card.moment_slot}`
    const total = perMoment.get(key) ?? 1
    const nth = (seenInMoment.get(key) ?? 0) + 1
    seenInMoment.set(key, nth)

    return {
      id: card.id,
      title: card.offer?.trim() || card.name,
      message: card.client_approval_message,
      mechanics: card.offer_dynamics_type,
      product: card.product_featured,
      retailPrice: card.retail_price,
      pageType: card.page_type,
      pendingNote: card.client_changes_requested_at && card.client_changes_requested_note
        ? {
            by: card.client_changes_requested_by,
            note: card.client_changes_requested_note,
            at: card.client_changes_requested_at,
          }
        : null,
      optionLabel: total > 1 ? `Alternative ${nth} of ${total}` : null,
    }
  })

  const initials = brand.name.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()
  const brandColor = `hsl(${brand.name.charCodeAt(0) * 7 % 360}, 60%, 25%)`

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--background)' }}>
      {/* Same 56px sticky bar as the portal and review pages. */}
      <div style={{
        background: 'var(--surface)', borderBottom: '1px solid var(--border)',
        padding: '0 var(--space-6)', height: 56,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <div style={{
            width: 28, height: 28, borderRadius: 6, background: brandColor,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 'var(--text-base)', fontWeight: 700, color: 'white', flexShrink: 0,
          }}>
            {initials}
          </div>
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
            {brand.name}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>Offer Approval</span>
          <ThemeToggle />
        </div>
      </div>

      <main style={{ maxWidth: 780, margin: '0 auto', padding: 'var(--space-10) var(--space-6) 80px' }}>
        <div style={{ marginBottom: 'var(--space-8)' }}>
          <h1 style={{
            fontSize: 26, fontWeight: 800, color: 'var(--text-primary)',
            letterSpacing: '-0.03em', marginBottom: 'var(--space-2)',
          }}>
            {slides.length === 0 ? 'Your offers' : 'Offers for your approval'}
          </h1>
          <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            {slides.length === 0
              ? 'Nothing needs your sign-off right now.'
              : `${slides.length} offer${slides.length === 1 ? '' : 's'} ready for you. ` +
                'Read each one and approve it, or tell us what you’d like changed.'}
          </p>
        </div>

        {slides.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 'var(--space-10) var(--space-6)' }}>
            <p style={{ color: 'var(--text-primary)', fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
              No offers waiting
            </p>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.6 }}>
              Keep this link — when your next moment is ready for approval it will appear here.
            </p>
            <Link
              href={`/portal/${token}`}
              style={{ display: 'inline-block', marginTop: 16, fontSize: 14, color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}
            >
              View your projects →
            </Link>
          </div>
        ) : (
          <ClientOfferDeck token={token} slides={slides} />
        )}
      </main>
    </div>
  )
}
