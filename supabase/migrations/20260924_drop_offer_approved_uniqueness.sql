-- Remove the "one approved offer per brand + month + moment slot" cap.
--
-- Previously (migration 20260908) a partial unique index allowed unlimited
-- CANDIDATE offer cards per key but blocked more than one from reaching
-- 'offer_approved'. That backstop, plus matching app-side checks in
-- createOfferCard, updateOfferStage, and approveOfferAsClient, are removed
-- together: any number of offers may now be approved for the same brand +
-- month + moment slot.

BEGIN;

DROP INDEX IF EXISTS public.uq_offer_cards_approved_brand_month_slot;

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFY (run after applying):
--   INSERT INTO public.offer_cards (brand_id, target_month, moment_slot, name, stage)
--   SELECT id, '2099-01-01', 1, 'smoke test approved 1', 'offer_approved' FROM public.brands LIMIT 1;
--   INSERT INTO public.offer_cards (brand_id, target_month, moment_slot, name, stage)
--   SELECT id, '2099-01-01', 1, 'smoke test approved 2', 'offer_approved' FROM public.brands LIMIT 1;
--   -- Both INSERTs must now succeed (two approved offers, same key).
--   DELETE FROM public.offer_cards WHERE name IN ('smoke test approved 1', 'smoke test approved 2');
