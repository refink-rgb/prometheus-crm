'use server'

// Offer Cycle server actions (Prometheus Evolution Phase 2).
//
// Kept out of actions.ts on purpose: that file is the Production Cycle, and
// Phase 2's contract is to not touch it. Every stage move here emits events
// through the Phase 1 log with card_kind 'offer' (card-level — offers have no
// LP/creative tracks).

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { canEdit } from '@/lib/permissions'
import { offerCardName, OFFER_STAGE_ORDER, type OfferStage } from '@/lib/types'
import { actorFromUser, eventsEnabled, logEvents, type PipelineEventInput } from '@/lib/events'
import { autoCreateEnabled, createProductionCardFromOffer } from '@/lib/offer-to-production'

async function requireEditor() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!canEdit(user.email)) throw new Error('Not authorized.')
  return { supabase, user }
}

// Manual creation — used for testing and for the July→August transition cards.
// The cron (Phase 3) inserts through the same shape. Idempotency lives in the
// DB unique index (brand_id, target_month, moment_slot); a duplicate comes
// back as a friendly error, not a second card.
export async function createOfferCard(formData: FormData): Promise<{ redirect: string }> {
  const { supabase, user } = await requireEditor()

  const brandId = (formData.get('brand_id') as string)?.trim()
  const monthRaw = (formData.get('target_month') as string)?.trim() // 'YYYY-MM' from <input type=month>
  const slotRaw = (formData.get('moment_slot') as string)?.trim()
  const momentSlot = slotRaw === '2' ? 2 : 1
  if (!brandId || !/^\d{4}-\d{2}$/.test(monthRaw)) throw new Error('Brand and month are required.')
  const targetMonth = `${monthRaw}-01`

  const { data: brand, error: brandErr } = await supabase
    .from('brands').select('id, name').eq('id', brandId).single()
  if (brandErr || !brand) throw new Error('Unknown brand.')

  const { data, error } = await supabase
    .from('offer_cards')
    .insert({
      brand_id: brandId,
      target_month: targetMonth,
      moment_slot: momentSlot,
      name: offerCardName(brand.name, targetMonth, momentSlot),
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') {
      throw new Error(`An M${momentSlot} offer card for ${brand.name} already exists for that month.`)
    }
    throw new Error(`Failed to create offer card: ${error.message}`)
  }

  revalidatePath('/offers')
  return { redirect: `/offers/${data.id}` }
}

export async function updateOfferStage(cardId: string, stage: OfferStage) {
  const { supabase, user } = await requireEditor()

  const { data: prev, error: prevErr } = await supabase
    .from('offer_cards')
    .select('stage, brand_id, target_month, moment_slot')
    .eq('id', cardId)
    .single()
  if (prevErr || !prev) throw new Error('Offer card not found.')
  if (prev.stage === stage) return

  const { error } = await supabase
    .from('offer_cards')
    .update({ stage })
    .eq('id', cardId)
  if (error) throw new Error(`Failed to move offer card: ${error.message}`)

  if (eventsEnabled()) {
    const actor = actorFromUser(user)
    const base = {
      card_kind: 'offer' as const,
      card_id: cardId,
      brand_id: prev.brand_id,
      ...actor,
    }
    const events: PipelineEventInput[] = [{
      ...base,
      event_type: 'stage_changed',
      from_stage: prev.stage,
      to_stage: stage,
      payload: { target_month: prev.target_month, moment_slot: prev.moment_slot },
    }]
    // Entering Client Review = the offer went to the client.
    if (stage === 'client_review') {
      events.push({ ...base, event_type: 'sent_to_client', payload: { via: 'stage_change' } })
    }
    // Leaving Client Review encodes the client's answer: forward to Approved =
    // approved; backward to an earlier stage = revision requested.
    if (prev.stage === 'client_review' && stage !== 'client_review') {
      const forward = OFFER_STAGE_ORDER.indexOf(stage) > OFFER_STAGE_ORDER.indexOf('client_review')
      events.push({
        ...base,
        event_type: 'client_responded',
        payload: { response_type: forward ? 'approved' : 'revision_requested', via: 'offer_stage_change' },
      })
    }
    await logEvents(events)
  }

  // Phase 3 Trigger B: approval spawns the linked Production card. The offer
  // stays in Offer Approved no matter what happens here (its stage update
  // already committed above); a creation failure is surfaced loudly — thrown
  // to the UI and error-logged for the Vercel log stream — never swallowed.
  // The daily cron also reports any approved-but-unlinked offers as a net.
  if (stage === 'offer_approved' && autoCreateEnabled()) {
    try {
      const result = await createProductionCardFromOffer(cardId, user.id)
      revalidatePath(`/brands/${prev.brand_id}`)
      if (result.created) revalidatePath('/')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[offer-to-production] ALERT: offer ${cardId} approved but production card creation FAILED: ${msg}`)
      throw new Error(`Offer is approved, but creating the production card failed: ${msg}. Fix the cause, then move the card out of Approved and back in to retry.`)
    }
  }

  revalidatePath('/offers')
  revalidatePath(`/offers/${cardId}`)
}

export async function updateOfferDetails(
  cardId: string,
  values: {
    offer_dynamics_type: string | null
    offer: string | null
    offer_description: string | null
    product_featured: string | null
    product_description: string | null
    retail_price: string | null
    page_type: string | null
    competitor_reference: string | null
    client_ad_inspiration: string | null
    product_images_link: string | null
  }
) {
  const { supabase } = await requireEditor()

  const { error } = await supabase
    .from('offer_cards')
    .update(values)
    .eq('id', cardId)
  if (error) throw new Error(`Failed to save offer: ${error.message}`)

  revalidatePath(`/offers/${cardId}`)
  revalidatePath('/offers')
}

export async function deleteOfferCard(cardId: string) {
  const { supabase } = await requireEditor()

  const { error } = await supabase.from('offer_cards').delete().eq('id', cardId)
  if (error) throw new Error(`Failed to delete offer card: ${error.message}`)

  revalidatePath('/offers')
  redirect('/offers')
}
