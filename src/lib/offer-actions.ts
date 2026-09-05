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
import { offerCardName, offerMonthLabel, OFFER_STAGE_ORDER, type OfferStage } from '@/lib/types'
import { actorFromUser, eventsEnabled, logEvents, type PipelineEventInput } from '@/lib/events'
import { autoCreateEnabled, createProductionCardFromOffer } from '@/lib/offer-to-production'
import {
  canGenerateApprovalMessage,
  generateApprovalMessageText,
  type ApprovalMessageInput,
} from '@/lib/ai/approval-message'

async function requireEditor() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')
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

// Assign (or clear) an offer card's owner. The picker is restricted to the
// management roster in the UI; here we only validate that a non-null target is
// a real profile, then write the FK. Kept deliberately light — no event is
// logged (assignment isn't a pipeline stage move), matching how the Production
// board's editor assignment writes straight to the column.
export async function assignOfferCard(cardId: string, profileId: string | null) {
  const { supabase } = await requireEditor()

  if (profileId) {
    const { data: profile, error: profErr } = await supabase
      .from('profiles').select('id').eq('id', profileId).single()
    if (profErr || !profile) throw new Error('Unknown assignee.')
  }

  const { error } = await supabase
    .from('offer_cards')
    .update({ assigned_to: profileId })
    .eq('id', cardId)
  if (error) throw new Error(`Failed to assign offer card: ${error.message}`)

  revalidatePath('/offers')
  revalidatePath(`/offers/${cardId}`)
}

export type OfferDetailValues = {
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
  problem_statement: string | null
  success_metric: string | null
  success_target: number | null
  guardrails: string | null
}

const OFFER_DETAIL_FIELDS = [
  'offer_dynamics_type', 'offer', 'offer_description', 'product_featured',
  'product_description', 'retail_price', 'page_type', 'competitor_reference',
  'client_ad_inspiration', 'product_images_link', 'problem_statement',
  'success_metric', 'success_target', 'guardrails',
] as const satisfies ReadonlyArray<keyof OfferDetailValues>

// Each workspace tab saves independently. Accepting a partial patch keeps a
// save on the Offer tab from blanking fields mounted on Product + Creative.
export async function updateOfferDetails(
  cardId: string,
  values: Partial<OfferDetailValues>,
) {
  const { supabase } = await requireEditor()

  if (Object.keys(values).length === 0) return
  // Server Actions are callable endpoints. Never pass the client object
  // straight to PostgREST even though TypeScript narrows normal UI callers.
  const safeValues = Object.fromEntries(
    OFFER_DETAIL_FIELDS
      .filter(field => Object.prototype.hasOwnProperty.call(values, field))
      .map(field => [field, values[field]]),
  ) as Partial<OfferDetailValues>
  if (Object.keys(safeValues).length === 0) throw new Error('No editable offer fields supplied.')

  const { error } = await supabase
    .from('offer_cards')
    .update(safeValues)
    .eq('id', cardId)
  if (error) throw new Error(`Failed to save offer: ${error.message}`)

  revalidatePath(`/offers/${cardId}`)
  revalidatePath('/offers')
}

// Generate the client approval message from the card's own fields.
//
// Returns the text as well as writing it, so the client component can drop it
// straight into its textarea without waiting on a refresh round-trip. Any
// message already saved is overwritten — the button is explicitly a regenerate,
// and the UI warns before firing it over hand-edited text.
export async function generateApprovalMessage(
  cardId: string,
): Promise<{ text: string; unverifiedNumbers: string[] }> {
  const { supabase } = await requireEditor()

  const { data: card, error: cardErr } = await supabase
    .from('offer_cards')
    // Single line on purpose — PostgREST parses this string literally, and
    // every other select in the codebase follows the same convention.
    .select('brand_id, target_month, offer_dynamics_type, offer, offer_description, product_featured, product_description, retail_price, page_type, problem_statement, success_metric, success_target, guardrails, competitor_reference, brands(name)')
    .eq('id', cardId)
    .single()
  if (cardErr || !card) throw new Error('Offer card not found.')

  // Brand DNA is optional context — a brand with no DNA record still gets a
  // message, it just won't reference their positioning.
  const { data: dna } = await supabase
    .from('brand_dna')
    .select('positioning, core_value_prop, price_anchor')
    .eq('brand_id', card.brand_id)
    .eq('is_active', true)
    .maybeSingle()

  const row = card as unknown as {
    target_month: string
    offer_dynamics_type: string | null
    offer: string | null
    offer_description: string | null
    product_featured: string | null
    product_description: string | null
    retail_price: string | null
    page_type: string | null
    problem_statement: string | null
    success_metric: string | null
    success_target: number | null
    guardrails: string | null
    competitor_reference: string | null
    brands: { name: string } | null
  }

  const input: ApprovalMessageInput = {
    brandName: row.brands?.name ?? 'the brand',
    monthLabel: offerMonthLabel(row.target_month),
    offerDynamicsType: row.offer_dynamics_type,
    offer: row.offer,
    offerDescription: row.offer_description,
    productFeatured: row.product_featured,
    productDescription: row.product_description,
    retailPrice: row.retail_price,
    pageType: row.page_type,
    problemStatement: row.problem_statement,
    successMetric: row.success_metric,
    successTarget: row.success_target,
    guardrails: row.guardrails,
    competitorReference: row.competitor_reference,
    positioning: dna?.positioning ?? null,
    coreValueProp: dna?.core_value_prop ?? null,
    priceAnchor: dna?.price_anchor ?? null,
  }

  if (!canGenerateApprovalMessage(input)) {
    throw new Error('Fill in the offer first — there\'s nothing here to build a message from yet.')
  }

  const { text, unverifiedNumbers } = await generateApprovalMessageText(input)

  const { error } = await supabase
    .from('offer_cards')
    .update({ client_approval_message: text })
    .eq('id', cardId)
  if (error) throw new Error(`Message generated but failed to save: ${error.message}`)

  // Logged as well as surfaced: a card that repeatedly trips the check is a
  // signal the prompt needs work, and that only shows up in aggregate.
  if (unverifiedNumbers.length) {
    console.warn(`[approval-message] card ${cardId}: unverified figures ${unverifiedNumbers.join(', ')}`)
  }

  revalidatePath(`/offers/${cardId}`)
  return { text, unverifiedNumbers }
}

// Persist a hand-edited message. Separate from updateOfferDetails so saving the
// message never depends on the offer form being valid, and vice versa — they're
// edited at different moments by different people.
export async function saveApprovalMessage(cardId: string, message: string) {
  const { supabase } = await requireEditor()

  const trimmed = message.trim()
  const { error } = await supabase
    .from('offer_cards')
    .update({ client_approval_message: trimmed || null })
    .eq('id', cardId)
  if (error) throw new Error(`Failed to save message: ${error.message}`)

  revalidatePath(`/offers/${cardId}`)
}

export async function deleteOfferCard(cardId: string) {
  const { supabase } = await requireEditor()

  const { error } = await supabase.from('offer_cards').delete().eq('id', cardId)
  if (error) throw new Error(`Failed to delete offer card: ${error.message}`)

  revalidatePath('/offers')
  redirect('/offers')
}
