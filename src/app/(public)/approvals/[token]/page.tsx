import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import { offerMonthLabel, type OfferCard } from '@/lib/types'
import { OFFER_APPROVAL_COLUMNS, offerApprovalState } from '@/lib/offer-approvals'
import OfferApprovalQueue from '@/components/OfferApprovalQueue'
import ThemeToggle from '@/components/ThemeToggle'

// Internal approval queue for one profit engineer.
//
// The token in the URL is the capability (same model as the client review
// link), so this reads via the service role rather than depending on an
// anonymous RLS policy. The queue is computed per request — an offer that
// entered Internal Review a minute ago is here on the next load, with no
// link to reissue.

export const dynamic = 'force-dynamic'

type QueueCard = OfferCard & { brands: { id: string; name: string } }

export default async function ApprovalsPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  if (!/^[a-f0-9]{40}$/.test(token)) notFound()

  const supabase = createServiceClient()

  const { data: engineer } = await supabase
    .from('profit_engineers')
    .select('name')
    .eq('approval_token', token)
    .single()

  if (!engineer) notFound()
  const engineerName = engineer.name as string

  // Every offer in Internal Review on a brand this engineer owns. The inner
  // join on brands is what scopes the queue to them.
  const { data: cardsRaw, error } = await supabase
    .from('offer_cards')
    .select(
      `id, brand_id, target_month, moment_slot, name, stage, offer, offer_description,
       offer_dynamics_type, product_featured, client_approval_message,
       ${OFFER_APPROVAL_COLUMNS}, brands!inner(id, name, profit_engineer)`,
    )
    .eq('stage', 'internal_offer_review')
    .eq('brands.profit_engineer', engineerName)
    .order('target_month', { ascending: true })
    .order('moment_slot', { ascending: true })

  if (error) console.error('[approvals] failed to load queue:', error)
  const cards = (cardsRaw ?? []) as unknown as QueueCard[]

  const items = cards.map(card => ({
    id: card.id,
    brandName: card.brands.name,
    monthLabel: offerMonthLabel(card.target_month),
    momentSlot: card.moment_slot,
    title: card.offer?.trim() || card.name,
    mechanics: card.offer_dynamics_type,
    product: card.product_featured,
    message: card.client_approval_message,
    approval: offerApprovalState(card, engineerName),
  }))

  const waiting = items.filter(i => !i.approval.engineer.approved).length

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--background)' }}>
      <header style={{
        borderBottom: '1px solid var(--border)',
        padding: '18px 24px',
        display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
      }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{
            fontSize: 'var(--text-xl)', fontWeight: 800, color: 'var(--text-primary)',
            letterSpacing: '-0.02em', marginBottom: 3,
          }}>
            Offer approvals · {engineerName}
          </h1>
          <p style={{ fontSize: 'var(--text-base)', color: 'var(--text-muted)' }}>
            {items.length === 0
              ? 'Nothing is waiting on you right now.'
              : `${items.length} offer${items.length === 1 ? '' : 's'} in internal review` +
                (waiting > 0 ? ` · ${waiting} awaiting your approval` : ' · all approved by you')}
          </p>
        </div>
        <div style={{ marginLeft: 'auto' }}><ThemeToggle /></div>
      </header>

      <main style={{ maxWidth: 860, margin: '0 auto', padding: '24px 24px 64px' }}>
        {items.length === 0 ? (
          <div style={{
            border: '1px dashed var(--border)', borderRadius: 12,
            padding: '48px 24px', textAlign: 'center',
          }}>
            <p style={{ fontSize: 'var(--text-md)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
              No offers awaiting approval
            </p>
            <p style={{ fontSize: 'var(--text-base)', color: 'var(--text-muted)' }}>
              This page stays live. When a new offer for one of your brands reaches
              internal review, it appears here — keep the link.
            </p>
          </div>
        ) : (
          <OfferApprovalQueue token={token} engineerName={engineerName} items={items} />
        )}
      </main>
    </div>
  )
}
