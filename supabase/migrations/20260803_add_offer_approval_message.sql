-- Offer Cycle: the client approval message.
--
-- The message a strategist sends the client to get an offer signed off. It is
-- generated from the card's own fields (offer, rationale, success criterion,
-- guardrails) by Gemini, then edited by hand before sending — so the generated
-- text has to persist. Without a column the strategist's edits die on the next
-- router.refresh(), which is exactly the moment they're about to send it.
--
-- Nullable, no default: NULL means "never generated", which the UI shows as an
-- empty state rather than an empty textarea. Same reasoning as the Phase 2
-- brief fields — offer cards are auto-generated empty, so NOT NULL would break
-- card creation outright.
--
-- Stored as TEXT rather than structured sections: the whole point is that the
-- strategist rewrites it freely before it goes out, and any structure we
-- imposed would be stale the moment they did.

BEGIN;

ALTER TABLE public.offer_cards
  ADD COLUMN IF NOT EXISTS client_approval_message TEXT;

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFY (run after applying):
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'offer_cards'
--     AND column_name = 'client_approval_message';
--   -- one row expected, is_nullable = 'YES'.
