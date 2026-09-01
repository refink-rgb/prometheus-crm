-- How much AI a brand will tolerate, and where the editors' notes about a brand
-- live.
--
-- From the editors' call, 1 Sep. Janella: "is there a way we can leave notes on
-- CRM per brand… sort of like a brand bible… so in case we need to swap out
-- brands, they can just check that out."
--
-- brands.brand_notes ALREADY EXISTS and is not touched here — this file only
-- adds the scale. The notes were being written somewhere nobody reads; the fix
-- is where they are SHOWN, which is the project overview, not a new column.
--
-- ai_sensitivity is the other half of the same conversation. Roberto: Obnoxious
-- Golf "don't care about AI", so zero; Noble "even if it's not AI they sometimes
-- claim it's AI", so high; and brands in between. An editor decides how much AI
-- to use per brand and currently has to remember, or ask.
--
-- SMALLINT 0-3 rather than an enum: it is a dial, the ends mean something
-- ordered, and adding a step to an enum is a migration while adding a step to a
-- range is not. NULL means nobody has set it — deliberately distinct from 0,
-- which is a positive statement that the brand does not mind.
--   0 = doesn't mind AI      2 = prefers minimal AI
--   1 = fine with some AI    3 = will reject anything that reads as AI

BEGIN;

ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS ai_sensitivity SMALLINT;

ALTER TABLE public.brands DROP CONSTRAINT IF EXISTS brands_ai_sensitivity_range;
ALTER TABLE public.brands
  ADD CONSTRAINT brands_ai_sensitivity_range
  CHECK (ai_sensitivity IS NULL OR ai_sensitivity BETWEEN 0 AND 3);

COMMIT;

-- VERIFY:
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name='brands' AND column_name='ai_sensitivity';
