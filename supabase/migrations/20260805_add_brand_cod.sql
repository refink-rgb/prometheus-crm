-- Cost of delivery per brand, so the Results tab can report CONTRIBUTION
-- MARGIN rather than only ROAS.
--
-- ROAS answers "how much revenue did a dollar of ad spend return". It does not
-- answer "did we make money", because it ignores everything it costs to
-- actually deliver the order — product cost, shipping, fulfilment, payment
-- processing. A 2.0x ROAS is excellent for a 20%-COD brand and a loss for a
-- 60%-COD one, and nothing on the tab could tell those apart.
--
-- COD is ONE value per brand (Giovane, 2026-08-05), stored here rather than
-- per campaign: it's a property of the business, not of a marketing moment.
--
-- TWO MODES, because agencies quote cost of delivery both ways and guessing
-- wrong silently changes every margin figure on the page:
--
--   'percent'    cod_value is a PERCENT OF REVENUE (35 = 35%).
--                CM = revenue - (revenue * cod_value/100) - spend
--
--   'per_order'  cod_value is DOLLARS PER ORDER (18.50 = $18.50/order),
--                multiplied by the day's purchase count.
--                CM = revenue - (cod_value * purchases) - spend
--
-- Percentages are stored AS PERCENT, matching campaign_daily_results.roas and
-- friends. Consistency with the neighbouring table matters more here than
-- picking the "nicer" unit.
--
-- NULL cod_value means NOT CONFIGURED. The UI renders CM as an em dash and
-- says the brand needs a COD — it never assumes 0, which would silently report
-- gross profit as if delivery were free.

BEGIN;

ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS cod_value NUMERIC(10,4),
  ADD COLUMN IF NOT EXISTS cod_mode TEXT NOT NULL DEFAULT 'percent';

ALTER TABLE public.brands
  DROP CONSTRAINT IF EXISTS brands_cod_mode_valid;
ALTER TABLE public.brands
  ADD CONSTRAINT brands_cod_mode_valid
  CHECK (cod_mode IN ('percent', 'per_order'));

-- A negative cost of delivery is not a thing. A percent above 100 means every
-- order loses money before a cent of ad spend, which is a data-entry error far
-- more often than a real business.
ALTER TABLE public.brands
  DROP CONSTRAINT IF EXISTS brands_cod_value_sane;
ALTER TABLE public.brands
  ADD CONSTRAINT brands_cod_value_sane
  CHECK (
    cod_value IS NULL
    OR (cod_value >= 0 AND (cod_mode <> 'percent' OR cod_value <= 100))
  );

COMMENT ON COLUMN public.brands.cod_value IS
  'Cost of delivery. Percent of revenue when cod_mode=percent (35 = 35%), dollars per order when cod_mode=per_order. NULL = not configured; the UI shows contribution margin as an em dash rather than assuming zero.';

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFY (run after applying):
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name = 'brands' AND column_name IN ('cod_value','cod_mode');
--   -- two rows expected.
--
-- Set one to try it (35% cost of delivery):
--   UPDATE public.brands SET cod_value = 35, cod_mode = 'percent'
--    WHERE name = 'Noble';
