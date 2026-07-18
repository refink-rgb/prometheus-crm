-- Prometheus Evolution — Phase 2: Offer Cycle cards.
--
-- New upstream pipeline, one card per moment per client per month. Deliberately
-- a NEW table (not columns/enum values on projects) so the Production Cycle is
-- untouched — the non-breaking guarantee from PHASE0_DISCOVERY.md.
--
-- Field set = the signed-off Phase 0 categorization: strategic + creative-only
-- Production Brief fields, copy fields excluded (they never exist on an offer).
-- Column names intentionally MATCH projects' columns 1:1, so Phase 3's
-- auto-population is a straight field-for-field copy.

BEGIN;

CREATE TABLE IF NOT EXISTS public.offer_cards (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id        UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  -- The month the moment runs in, stored as the FIRST day of that month.
  target_month    DATE NOT NULL,
  moment_slot     SMALLINT NOT NULL CHECK (moment_slot IN (1, 2)),
  -- '[Brand] · [Month Year] · [M1|M2] Offer' — set at creation.
  name            TEXT NOT NULL,
  stage           TEXT NOT NULL DEFAULT 'auto_generated' CHECK (stage IN
                    ('auto_generated','offer_draft','internal_offer_review','client_review','offer_approved')),

  -- Offer Draft fields — strategic (flow to the Production Brief in Phase 3).
  offer_dynamics_type   TEXT,
  offer                 TEXT,
  offer_description     TEXT,
  product_featured      TEXT,
  product_description   TEXT,
  retail_price          TEXT,
  page_type             TEXT,

  -- Offer Draft fields — creative-only (stay on the offer; never auto-populate).
  competitor_reference  TEXT,
  client_ad_inspiration TEXT,
  product_images_link   TEXT,

  -- Phase 3 linkage: the Production card auto-created when this offer is
  -- approved. NULL until then. (The reverse pointer, source_offer_card_id on
  -- projects, ships with the Phase 3 migration.) No FK: projects rows can be
  -- hard-deleted and the offer's history must survive that.
  derived_production_card_id UUID,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Trigger A idempotency at the DB level: at most one card per client + month +
-- moment slot. A cron double-fire becomes a unique violation, not a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_offer_cards_brand_month_slot
  ON public.offer_cards (brand_id, target_month, moment_slot);

CREATE INDEX IF NOT EXISTS idx_offer_cards_stage ON public.offer_cards (stage);
CREATE INDEX IF NOT EXISTS idx_offer_cards_month ON public.offer_cards (target_month);

-- RLS — same posture as brands/projects: authenticated users read/write,
-- authorization enforced at the app layer via canEdit().
ALTER TABLE public.offer_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_offer_cards" ON public.offer_cards;
CREATE POLICY "auth_select_offer_cards" ON public.offer_cards FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_offer_cards" ON public.offer_cards;
CREATE POLICY "auth_insert_offer_cards" ON public.offer_cards FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_offer_cards" ON public.offer_cards;
CREATE POLICY "auth_update_offer_cards" ON public.offer_cards FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_delete_offer_cards" ON public.offer_cards;
CREATE POLICY "auth_delete_offer_cards" ON public.offer_cards FOR DELETE TO authenticated USING (true);

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFY (run after applying):
--   INSERT INTO public.offer_cards (brand_id, target_month, moment_slot, name)
--   SELECT id, '2099-01-01', 1, 'smoke test' FROM public.brands LIMIT 1;
--   -- Re-running that INSERT must fail with a unique violation (idempotency).
--   DELETE FROM public.offer_cards WHERE name = 'smoke test';
