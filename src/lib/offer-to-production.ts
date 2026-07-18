// Prometheus Evolution — Phase 3 Trigger B: approved offer → Production card.
//
// Called from updateOfferStage when a card lands in 'offer_approved'. Uses the
// service-role client so the logic is also callable from cron/system contexts.
// canEdit() authorization is the CALLER's responsibility.
//
// Mapping rules (signed off in PHASE0_DISCOVERY.md):
//   * strategic fields copy 1:1 (identical column names on both tables)
//   * creative-only fields DO NOT flow (creative team works fresh from context)
//   * copy fields never existed on the offer
//   * journey: find-or-create '<Month> <Year>' on the brand
//   * bidirectional link: projects.source_offer_card_id ↔
//     offer_cards.derived_production_card_id
//
// Kill switch: PROMETHEUS_AUTOCREATE_DISABLED=1 turns Trigger B off (offers
// still reach Offer Approved; production cards just aren't spawned).

import { createServiceClient } from './supabase/service'
import { offerMonthLabel } from './types'

export function autoCreateEnabled(): boolean {
  return process.env.PROMETHEUS_AUTOCREATE_DISABLED !== '1'
}

// The 7 strategic fields — the ONLY fields that flow to the Production Brief.
const STRATEGIC_FIELDS = [
  'offer_dynamics_type',
  'offer',
  'offer_description',
  'product_featured',
  'product_description',
  'retail_price',
  'page_type',
] as const

// Default LIVE target for auto-created cards: M1 mid-month (15th), M2 month-end.
// A placeholder cadence, not a policy — due dates are PM-managed metadata and
// get adjusted on the card. due_date is NOT NULL on projects, so some value is
// required at creation time.
function defaultDueDate(targetMonth: string, momentSlot: 1 | 2): string {
  const year = Number(targetMonth.slice(0, 4))
  const month = Number(targetMonth.slice(5, 7)) // 1-12
  if (momentSlot === 1) return `${targetMonth.slice(0, 7)}-15`
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${targetMonth.slice(0, 7)}-${String(lastDay).padStart(2, '0')}`
}

export type OfferToProductionResult =
  | { created: true; projectId: string }
  | { created: false; projectId: string; reason: 'already_exists' }

// Idempotent: fires twice → one production card. Throws on failure — callers
// surface the error loudly; the offer card stays in Offer Approved either way.
export async function createProductionCardFromOffer(
  offerId: string,
  createdBy: string | null,
): Promise<OfferToProductionResult> {
  const supabase = createServiceClient()

  const { data: offer, error: offerErr } = await supabase
    .from('offer_cards')
    .select('*, brands(id, name)')
    .eq('id', offerId)
    .single()
  if (offerErr || !offer) throw new Error(`Offer card not found: ${offerErr?.message ?? offerId}`)

  // Idempotency — the production side is the source of truth for "exists":
  // its source_offer_card_id is written in the same insert that creates the
  // card, so a half-finished previous run can't fool this check.
  const { data: existing, error: existErr } = await supabase
    .from('projects')
    .select('id')
    .eq('source_offer_card_id', offerId)
    .limit(1)
    .maybeSingle()
  if (existErr) throw new Error(`Idempotency check failed: ${existErr.message}`)
  if (existing) {
    // Heal the reverse pointer if a previous run died between the two writes.
    if (offer.derived_production_card_id !== existing.id) {
      await supabase.from('offer_cards')
        .update({ derived_production_card_id: existing.id })
        .eq('id', offerId)
    }
    return { created: false, projectId: existing.id, reason: 'already_exists' }
  }

  const brand = offer.brands as { id: string; name: string }
  const monthLabel = offerMonthLabel(offer.target_month)

  // Journey: find-or-create '<Month> <Year>' on this brand (signed-off
  // convention). A lookup race could duplicate a journey; harmless and
  // mergeable, so no lock.
  let journeyId: string | null = null
  const { data: journey } = await supabase
    .from('journeys')
    .select('id')
    .eq('brand_id', brand.id)
    .eq('name', monthLabel)
    .limit(1)
    .maybeSingle()
  if (journey) {
    journeyId = journey.id
  } else {
    const { data: newJourney, error: jErr } = await supabase
      .from('journeys')
      .insert({ brand_id: brand.id, name: monthLabel })
      .select('id')
      .single()
    if (jErr) throw new Error(`Failed to create journey "${monthLabel}": ${jErr.message}`)
    journeyId = newJourney.id
  }

  const strategic = Object.fromEntries(
    STRATEGIC_FIELDS.map(f => [f, (offer as Record<string, unknown>)[f] ?? null])
  )

  const { data: project, error: projErr } = await supabase
    .from('projects')
    .insert({
      brand_id: brand.id,
      name: `${monthLabel} · M${offer.moment_slot} Moment`,
      due_date: defaultDueDate(offer.target_month, offer.moment_slot),
      journey_id: journeyId,
      marketing_moment: offer.moment_slot,
      source_offer_card_id: offerId,
      created_by: createdBy,
      ...strategic,
      // Everything else (copy fields, creative-only fields, stage due dates,
      // editors) stays blank/default — lp_stage and creatives_stage default
      // to 'brief' at the DB level.
    })
    .select('id')
    .single()
  if (projErr || !project) {
    throw new Error(`Production card creation failed: ${projErr?.message ?? 'no row returned'}`)
  }

  const { error: linkErr } = await supabase
    .from('offer_cards')
    .update({ derived_production_card_id: project.id })
    .eq('id', offerId)
  if (linkErr) {
    // Production card exists and carries source_offer_card_id, so the next
    // run of this function heals the reverse pointer. Loud, not fatal.
    console.error(`[offer-to-production] ALERT: reverse link failed for offer ${offerId} → project ${project.id}: ${linkErr.message}`)
  }

  return { created: true, projectId: project.id }
}
