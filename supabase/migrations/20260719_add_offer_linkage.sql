-- Prometheus Evolution — Phase 3: offer → production linkage.
--
-- The only Production Cycle schema change in the whole project, and it's
-- purely additive: one nullable column. Auto-created Production cards point
-- back at the offer they came from (the offer side already has
-- derived_production_card_id from the Phase 2 migration).

BEGIN;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS source_offer_card_id UUID REFERENCES public.offer_cards(id) ON DELETE SET NULL;

-- Trigger B idempotency lookup: "does a production card for this offer exist?"
CREATE INDEX IF NOT EXISTS idx_projects_source_offer
  ON public.projects (source_offer_card_id);

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFY:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'projects' AND column_name = 'source_offer_card_id';
--   -- expect 1 row
