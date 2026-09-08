'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from './supabase/service'
import { logEvents, type PipelineEventInput } from './events'
import { createProductionCardFromOffer, autoCreateEnabled } from './offer-to-production'

// Server Actions reachable from the client-facing offer approval link.
//
// The brand's client_token is the authorization — the same model as the
// project review link. Anonymous callers hit RLS, so everything here goes
// through the service role, and every action re-resolves the token and
// re-checks that the card belongs to that brand and is still in Client
// Review. A guessed card id therefore cannot reach another brand's offer.

const CLIENT_REVIEW = 'client_review'
const OFFER_APPROVED = 'offer_approved'

function cleanName(value: string): string {
  const name = value.trim().replace(/\s+/g, ' ')
  if (!name) throw new Error('Please add your name so we know who approved.')
  if (name.length > 120) throw new Error('That name is too long.')
  return name
}

async function resolveBrand(token: string) {
  if (!token || !/^[a-f0-9]{40}$/.test(token)) throw new Error('Invalid approval link.')
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brands')
    .select('id, name')
    .eq('client_token', token)
    .single()
  if (error || !data) throw new Error('This approval link is no longer valid.')
  return { supabase, brandId: data.id as string, brandName: data.name as string }
}

/** Confirm the offer is this brand's and still awaiting the client, or throw. */
async function requireOfferAwaitingClient(
  supabase: ReturnType<typeof createServiceClient>,
  brandId: string,
  cardId: string,
) {
  const { data, error } = await supabase
    .from('offer_cards')
    .select('id, stage, brand_id, target_month, moment_slot')
    .eq('id', cardId)
    .eq('brand_id', brandId)
    .eq('stage', CLIENT_REVIEW)
    .single()
  if (error || !data) throw new Error('That offer is no longer awaiting your approval.')
  return data as {
    id: string
    stage: string
    brand_id: string
    target_month: string
    moment_slot: number
  }
}

function revalidate(cardId: string, token: string) {
  revalidatePath(`/offer-approval/${token}`)
  revalidatePath('/offers')
  revalidatePath(`/offers/${cardId}`)
}

/**
 * The client approves. The card moves to Offer Approved and the linked
 * production card is created, matching what a staff approval does.
 */
export async function approveOfferAsClient(token: string, cardId: string, name: string) {
  const who = cleanName(name)
  const { supabase, brandId } = await resolveBrand(token)
  const offer = await requireOfferAwaitingClient(supabase, brandId, cardId)

  // One approved offer per moment. Strategists can put competing candidates in
  // front of a client, but only one can be signed off — mirrors the guard in
  // updateOfferStage and the partial unique index behind it.
  const { data: alreadyApproved, error: siblingErr } = await supabase
    .from('offer_cards')
    .select('id')
    .eq('brand_id', brandId)
    .eq('target_month', offer.target_month)
    .eq('moment_slot', offer.moment_slot)
    .eq('stage', OFFER_APPROVED)
    .neq('id', cardId)
    .limit(1)
  if (siblingErr) throw new Error('Could not check this offer. Please try again.')
  if ((alreadyApproved ?? []).length > 0) {
    throw new Error(
      'Another offer for this same moment has already been approved. ' +
      'Refresh the page — if you meant to pick this one instead, tell your strategist.',
    )
  }

  const now = new Date().toISOString()
  const { error } = await supabase
    .from('offer_cards')
    .update({
      stage: OFFER_APPROVED,
      client_approved_at: now,
      client_approved_by: who,
      // Their approval settles any earlier change request on this offer.
      client_changes_requested_at: null,
      client_changes_requested_by: null,
      client_changes_requested_note: null,
    })
    .eq('id', cardId)
  if (error) {
    // Lost the race between the check above and this write — the partial
    // unique index caught it. Say the same thing in the client's language
    // rather than leaking a Postgres constraint name.
    if (error.code === '23505') {
      throw new Error(
        'Another offer for this same moment has just been approved. ' +
        'Refresh the page to see where things stand.',
      )
    }
    throw new Error(`Could not record your approval: ${error.message}`)
  }

  const base = {
    card_kind: 'offer' as const,
    card_id: cardId,
    brand_id: brandId,
    actor_id: null,
    actor_label: `client:${who}`,
  }
  const events: PipelineEventInput[] = [
    {
      ...base,
      event_type: 'stage_changed',
      from_stage: CLIENT_REVIEW,
      to_stage: OFFER_APPROVED,
      payload: { target_month: offer.target_month, moment_slot: offer.moment_slot, via: 'client_link' },
    },
    {
      ...base,
      event_type: 'client_responded',
      payload: { response_type: 'approved', via: 'client_link' },
    },
  ]
  await logEvents(events)

  // The approval itself is already committed, so a failure here must not be
  // shown to the client as "approval failed" — it didn't. It is logged loudly
  // for the Vercel stream, and the daily cron reports approved-but-unlinked
  // offers as a net. Staff retry by moving the card out of Approved and back.
  if (autoCreateEnabled()) {
    try {
      await createProductionCardFromOffer(cardId, null)
      revalidatePath(`/brands/${brandId}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(
        `[offer-to-production] ALERT: offer ${cardId} approved by client but production card creation FAILED: ${msg}`,
      )
    }
  }

  revalidate(cardId, token)
}

/**
 * The client asks for changes. Their note is recorded and the offer STAYS in
 * Client Review — the team decides whether to redraft or discuss it, rather
 * than the card moving itself out from under them.
 */
export async function requestOfferChangesAsClient(
  token: string,
  cardId: string,
  name: string,
  note: string,
) {
  const who = cleanName(name)
  const trimmed = note.trim()
  if (!trimmed) throw new Error('Add a short note so we know what to change.')
  if (trimmed.length > 2000) throw new Error('That note is too long.')

  const { supabase, brandId } = await resolveBrand(token)
  await requireOfferAwaitingClient(supabase, brandId, cardId)

  const { error } = await supabase
    .from('offer_cards')
    .update({
      client_changes_requested_at: new Date().toISOString(),
      client_changes_requested_by: who,
      client_changes_requested_note: trimmed,
    })
    .eq('id', cardId)
  if (error) throw new Error(`Could not send your note: ${error.message}`)

  await logEvents([{
    card_kind: 'offer',
    card_id: cardId,
    brand_id: brandId,
    actor_id: null,
    actor_label: `client:${who}`,
    event_type: 'client_responded',
    payload: { response_type: 'revision_requested', via: 'client_link' },
  }])

  revalidate(cardId, token)
}
