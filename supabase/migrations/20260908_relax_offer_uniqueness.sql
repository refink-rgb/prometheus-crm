-- Allow multiple CANDIDATE offer cards per brand + month + moment slot.
--
-- The original rule (one card per key, full unique index) blocked strategists
-- from drafting competing offers for the same moment. New rule: candidates are
-- unlimited while the moment is open; only ONE card per key may be
-- 'offer_approved'. App-side, createOfferCard blocks creation once an approved
-- card exists, and updateOfferStage blocks approving a second card; this
-- partial index is the DB backstop for the approval half.
--
-- The daily cron (Trigger A) no longer relies on the full index for
-- idempotency: it pre-checks existing (brand, slot) pairs for the month and
-- plain-inserts only the missing ones (deployed together with this migration).

BEGIN;

DROP INDEX IF EXISTS public.uq_offer_cards_brand_month_slot;

CREATE UNIQUE INDEX IF NOT EXISTS uq_offer_cards_approved_brand_month_slot
  ON public.offer_cards (brand_id, target_month, moment_slot)
  WHERE stage = 'offer_approved';

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFY (run after applying):
--   INSERT INTO public.offer_cards (brand_id, target_month, moment_slot, name)
--   SELECT id, '2099-01-01', 1, 'smoke test dup' FROM public.brands LIMIT 1;
--   -- Run the INSERT twice: BOTH must now succeed (two candidates, same key).
--   UPDATE public.offer_cards SET stage = 'offer_approved' WHERE name = 'smoke test dup';
--   -- That UPDATE must FAIL with a unique violation (two approved is illegal).
--   DELETE FROM public.offer_cards WHERE name = 'smoke test dup';
