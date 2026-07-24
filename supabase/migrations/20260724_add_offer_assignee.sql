-- Offer Cycle usability: assign an owner to each offer card.
--
-- Offers are strategist-owned (Giovane / Lucas / Roberto in practice), so the
-- board can show who's driving each moment and filter to "my cards". The app
-- restricts the picker to the management roster; the column itself references
-- profiles like projects' editor FKs. ON DELETE SET NULL so removing a profile
-- never deletes offer history — the card just goes unassigned.

BEGIN;

ALTER TABLE public.offer_cards
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_offer_cards_assigned_to
  ON public.offer_cards (assigned_to);

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFY (run after applying):
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'offer_cards' AND column_name = 'assigned_to';
--   -- one row expected.
