import type { OfferCard } from './types'

/** The two sides of an internal approval. */
export type ApprovalSide = 'strategist' | 'engineer'

export interface ApprovalSideState {
  side: ApprovalSide
  /** Label shown on the button and the stamp. */
  label: string
  approved: boolean
  by: string | null
  at: string | null
}

export interface OfferApprovalState {
  strategist: ApprovalSideState
  engineer: ApprovalSideState
  /** How many of the two sides have signed off. */
  count: number
  /** Both sides in — the offer is cleared to go to the client. */
  complete: boolean
  changesRequested: boolean
  changesRequestedBy: string | null
  changesRequestedNote: string | null
  changesRequestedAt: string | null
}

/**
 * The approval state of one offer card.
 *
 * Kept in one place because three surfaces read it: the public approval page,
 * the board card's indicator, and the action that decides whether an approval
 * advances the stage.
 */
export function offerApprovalState(
  card: Pick<OfferCard,
    | 'strategist_approved_at' | 'strategist_approved_by'
    | 'engineer_approved_at' | 'engineer_approved_by'
    | 'changes_requested_at' | 'changes_requested_by' | 'changes_requested_note'
  >,
  engineerName?: string | null,
): OfferApprovalState {
  const strategist: ApprovalSideState = {
    side: 'strategist',
    label: 'Lucas / Roberto',
    approved: Boolean(card.strategist_approved_at),
    by: card.strategist_approved_by,
    at: card.strategist_approved_at,
  }
  const engineer: ApprovalSideState = {
    side: 'engineer',
    // Named when we know whose link this is; generic on the board, where a
    // card can belong to any engineer.
    label: engineerName ? `${engineerName} (Profit Engineer)` : 'Profit Engineer',
    approved: Boolean(card.engineer_approved_at),
    by: card.engineer_approved_by,
    at: card.engineer_approved_at,
  }
  const count = Number(strategist.approved) + Number(engineer.approved)
  return {
    strategist,
    engineer,
    count,
    complete: count === 2,
    // A change request is only live until someone approves again — approving
    // is what clears the flag, so a stale note never outlives the fix.
    changesRequested: Boolean(card.changes_requested_at) && count === 0,
    changesRequestedBy: card.changes_requested_by,
    changesRequestedNote: card.changes_requested_note,
    changesRequestedAt: card.changes_requested_at,
  }
}

/** The columns every surface reading approval state must select. */
export const OFFER_APPROVAL_COLUMNS =
  'strategist_approved_at, strategist_approved_by, engineer_approved_at, engineer_approved_by, ' +
  'changes_requested_at, changes_requested_by, changes_requested_note'
