'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from './supabase/service'
import { STRATEGIST_APPROVERS, type StrategistApprover } from './types'
import type { ApprovalSide } from './offer-approvals'

// Server Actions reachable from the public approval page.
//
// The token IS the authorization — the same model as the client review link.
// Every action re-resolves the token to an engineer and then re-checks that
// the card it is being asked to act on genuinely belongs to that engineer and
// is still in Internal Review. A caller who guesses a card id therefore still
// cannot touch a card outside their own link.

const INTERNAL_REVIEW = 'internal_offer_review'
const OFFER_DRAFT = 'offer_draft'
const CLIENT_REVIEW = 'client_review'

async function resolveEngineer(token: string) {
  if (!token || !/^[a-f0-9]{40}$/.test(token)) throw new Error('Invalid approval link.')
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('profit_engineers')
    .select('name, approval_token')
    .eq('approval_token', token)
    .single()
  if (error || !data) throw new Error('This approval link is no longer valid.')
  return { supabase, engineerName: data.name as string }
}

/**
 * Confirm the card is in this engineer's queue before writing to it. Returns
 * the card, or throws — never returns an unauthorized card.
 */
async function requireCardInQueue(
  supabase: ReturnType<typeof createServiceClient>,
  engineerName: string,
  cardId: string,
) {
  const { data, error } = await supabase
    .from('offer_cards')
    .select('id, stage, strategist_approved_at, engineer_approved_at, brands!inner(profit_engineer)')
    .eq('id', cardId)
    .eq('stage', INTERNAL_REVIEW)
    .eq('brands.profit_engineer', engineerName)
    .single()
  if (error || !data) {
    throw new Error('That offer is no longer awaiting your approval.')
  }
  return data as unknown as {
    id: string
    stage: string
    strategist_approved_at: string | null
    engineer_approved_at: string | null
  }
}

function revalidate(cardId: string, token: string) {
  revalidatePath(`/approvals/${token}`)
  revalidatePath('/offers')
  revalidatePath(`/offers/${cardId}`)
}

/**
 * Record one side's approval. When it is the second of the two, the card
 * advances to Client Review in the same write.
 */
export async function approveOfferFromLink(
  token: string,
  cardId: string,
  side: ApprovalSide,
  approver: string,
) {
  const { supabase, engineerName } = await resolveEngineer(token)
  const card = await requireCardInQueue(supabase, engineerName, cardId)

  // The strategist side is a named pair; the engineer side is whoever the link
  // belongs to, never free text from the client.
  let by: string
  if (side === 'strategist') {
    if (!STRATEGIST_APPROVERS.includes(approver as StrategistApprover)) {
      throw new Error('Choose who is approving.')
    }
    by = approver
  } else {
    by = engineerName
  }

  const now = new Date().toISOString()
  const patch: Record<string, unknown> = side === 'strategist'
    ? { strategist_approved_at: now, strategist_approved_by: by }
    : { engineer_approved_at: now, engineer_approved_by: by }

  // An approval settles the outstanding change request.
  patch.changes_requested_at = null
  patch.changes_requested_by = null
  patch.changes_requested_note = null

  const otherSideIn = side === 'strategist'
    ? Boolean(card.engineer_approved_at)
    : Boolean(card.strategist_approved_at)
  if (otherSideIn) patch.stage = CLIENT_REVIEW

  const { error } = await supabase.from('offer_cards').update(patch).eq('id', cardId)
  if (error) throw new Error(`Could not record the approval: ${error.message}`)

  revalidate(cardId, token)
  return { advanced: otherSideIn }
}

/**
 * Send the offer back to Offer Draft with a reason. Both approvals are cleared
 * so a re-submitted offer is signed off from scratch rather than inheriting a
 * stale approval of a version nobody saw.
 */
export async function requestOfferChangesFromLink(
  token: string,
  cardId: string,
  note: string,
  requestedBy: string,
) {
  const trimmed = note.trim()
  if (!trimmed) throw new Error('Add a short note so the strategist knows what to change.')
  if (trimmed.length > 2000) throw new Error('That note is too long.')

  const { supabase, engineerName } = await resolveEngineer(token)
  await requireCardInQueue(supabase, engineerName, cardId)

  const by = STRATEGIST_APPROVERS.includes(requestedBy as StrategistApprover)
    ? requestedBy
    : engineerName

  const { error } = await supabase
    .from('offer_cards')
    .update({
      stage: OFFER_DRAFT,
      changes_requested_at: new Date().toISOString(),
      changes_requested_by: by,
      changes_requested_note: trimmed,
      strategist_approved_at: null,
      strategist_approved_by: null,
      engineer_approved_at: null,
      engineer_approved_by: null,
    })
    .eq('id', cardId)
  if (error) throw new Error(`Could not send the offer back: ${error.message}`)

  revalidate(cardId, token)
}
