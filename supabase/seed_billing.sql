-- Seed the billing ledger from the signed-contract sheet (Giovane, 2026-07-31).
--
-- The sheet is the ONLY source of truth. This script:
--   1. stages the 18 signed clients,
--   2. matches them to `brands` by fuzzy name (case/punctuation/"The" tolerant;
--      the sheet's "(Joy)" suffixes are already stripped — they carry no
--      meaning per Giovane),
--   3. creates one billing_subscription per matched brand,
--   4. generates every billing period from the start date through the end of
--      next month, using the same anniversary + clamp rule as
--      src/lib/billing.ts,
--   5. syncs brands.monthly_retainer + brands.start_date to the sheet,
--   6. REPORTS any sheet row that matched no brand.
--
-- Safe to re-run: every write is ON CONFLICT DO NOTHING / idempotent, so a
-- second run will not duplicate subscriptions, periods, or overwrite a
-- payment someone already recorded.
--
-- Run this AFTER supabase/migrations/20260731_add_billing.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS public._billing_seed (
  sheet_name   TEXT PRIMARY KEY,
  start_date   DATE NOT NULL,
  amount_cents INTEGER NOT NULL
);

TRUNCATE public._billing_seed;

INSERT INTO public._billing_seed (sheet_name, start_date, amount_cents) VALUES
  ('All American Clothing',  DATE '2026-05-13', 200000),
  ('PixieLane',              DATE '2026-05-15', 200000),
  ('Mad Viking',             DATE '2026-05-18', 200000),
  ('Skinit',                 DATE '2026-05-18', 200000),
  ('All Citizens',           DATE '2026-05-20', 200000),
  ('Noble',                  DATE '2026-05-28', 200000),
  ('Strength Shop Europe',   DATE '2026-05-29', 200000),
  ('Tea with Tae',           DATE '2026-05-31', 200000),
  ('WOW Sports',             DATE '2026-06-02', 200000),
  ('Cosi Care',              DATE '2026-06-03', 200000),
  ('Cookt',                  DATE '2026-06-03', 200000),
  ('The Conscious Bar',      DATE '2026-06-22', 250000),
  ('Esas Beauty',            DATE '2026-06-22', 150000),
  ('Obnoxious Golf',         DATE '2026-06-24', 200000),
  ('Contour Design',         DATE '2026-06-24', 200000),
  ('Mikokos',                DATE '2026-07-30', 250000),
  ('Ofir Beauty',            DATE '2026-07-28', 200000),
  ('Naboso',                 DATE '2026-08-03', 250000);

-- Normalizer: lowercase, drop any "(...)" suffix, drop a leading "the ",
-- then strip everything that isn't a letter or digit. "The Conscious Bar",
-- "the conscious bar", and "Conscious Bar" all collapse to "consciousbar".
CREATE OR REPLACE FUNCTION public._billing_norm(name TEXT) RETURNS TEXT AS $$
  SELECT regexp_replace(
           regexp_replace(
             regexp_replace(lower(btrim(name)), '\s*\(.*\)\s*', ' ', 'g'),
             '^the\s+', ''),
           '[^a-z0-9]', '', 'g');
$$ LANGUAGE SQL IMMUTABLE;

COMMIT;

-- ---------------------------------------------------------------------------
-- 1. Subscriptions
-- ---------------------------------------------------------------------------

BEGIN;

INSERT INTO public.billing_subscriptions
  (brand_id, amount_cents, start_date, anchor_day, status, notes)
SELECT
  b.id,
  s.amount_cents,
  s.start_date,
  EXTRACT(DAY FROM s.start_date)::smallint,
  'active',
  'Seeded from signed-contract sheet 2026-07-31.'
FROM public._billing_seed s
JOIN public.brands b
  ON public._billing_norm(b.name) = public._billing_norm(s.sheet_name)
ON CONFLICT (brand_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Periods — start date through the end of NEXT month.
--    Mirrors generatePeriods() in src/lib/billing.ts: the anchor day is
--    preserved and clamped per month, so a 31st anchor bills 5/31 → 6/30 →
--    7/31 (Tea with Tae is the live case).
-- ---------------------------------------------------------------------------

WITH horizon AS (
  SELECT (date_trunc('month', CURRENT_DATE) + INTERVAL '2 months - 1 day')::date AS through
),
spans AS (
  SELECT
    sub.id AS subscription_id,
    sub.brand_id,
    sub.amount_cents,
    sub.start_date,
    sub.anchor_day,
    h.through,
    ((EXTRACT(YEAR FROM h.through) - EXTRACT(YEAR FROM sub.start_date)) * 12
      + (EXTRACT(MONTH FROM h.through) - EXTRACT(MONTH FROM sub.start_date)))::int AS span
  FROM public.billing_subscriptions sub
  CROSS JOIN horizon h
  WHERE sub.status = 'active' AND sub.ended_at IS NULL
),
gen AS (
  SELECT
    sp.*,
    i AS period_index,
    (date_trunc('month', sp.start_date) + (i * INTERVAL '1 month'))::date AS month_first
  FROM spans sp
  CROSS JOIN LATERAL generate_series(0, GREATEST(sp.span, 0)) AS i
),
dated AS (
  SELECT
    g.*,
    (g.month_first
      + (LEAST(
           g.anchor_day,
           EXTRACT(DAY FROM (g.month_first + INTERVAL '1 month - 1 day'))::int
         ) - 1)) AS due_date,
    ((date_trunc('month', g.start_date) + ((g.period_index + 1) * INTERVAL '1 month'))::date
      + (LEAST(
           g.anchor_day,
           EXTRACT(DAY FROM ((date_trunc('month', g.start_date) + ((g.period_index + 1) * INTERVAL '1 month'))::date
             + INTERVAL '1 month - 1 day'))::int
         ) - 1)) AS next_due_date
  FROM gen g
)
INSERT INTO public.billing_periods
  (subscription_id, brand_id, period_index, period_start, period_end, due_date, amount_cents, status)
SELECT
  d.subscription_id,
  d.brand_id,
  d.period_index,
  d.due_date,
  d.next_due_date - 1,
  d.due_date,
  d.amount_cents,
  'scheduled'
FROM dated d
WHERE d.due_date <= d.through
ON CONFLICT (subscription_id, period_index) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Sync the legacy columns on `brands` so the rest of the CRM (dashboard,
--    BrandCard, BD pipeline) agrees with the sheet.
-- ---------------------------------------------------------------------------

UPDATE public.brands b
SET monthly_retainer = s.amount_cents / 100.0,
    start_date       = s.start_date
FROM public._billing_seed s
WHERE public._billing_norm(b.name) = public._billing_norm(s.sheet_name);

COMMIT;

-- ---------------------------------------------------------------------------
-- 4. OPTIONAL — mark all 18 signed clients active.
--
--    NOT run by default. `brands.is_active` also drives the 24th-of-month
--    offer-card cron (runOfferGeneration in /api/cron/daily), so flipping a
--    brand active here will start generating M1/M2 offer cards for it next
--    cycle. Review the report below first, then run this block by hand if
--    that's what you want.
--
-- UPDATE public.brands b
-- SET is_active = true
-- FROM public._billing_seed s
-- WHERE public._billing_norm(b.name) = public._billing_norm(s.sheet_name)
--   AND b.is_active IS DISTINCT FROM true;
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 5. REPORT — read this before trusting the numbers.
--
--    'MATCHED'    → subscription created (or already existed).
--    'NO MATCH'   → the sheet name has no brand in the CRM. Either the brand
--                   is missing entirely, or it's spelled differently. Fix the
--                   brand name (or add the brand), then re-run this file.
-- ---------------------------------------------------------------------------

SELECT
  CASE WHEN b.id IS NULL THEN 'NO MATCH' ELSE 'MATCHED' END AS result,
  s.sheet_name,
  b.name                                        AS crm_brand_name,
  s.start_date,
  (s.amount_cents / 100)                        AS monthly_usd,
  (SELECT count(*) FROM public.billing_periods p WHERE p.brand_id = b.id) AS periods_generated
FROM public._billing_seed s
LEFT JOIN public.brands b
  ON public._billing_norm(b.name) = public._billing_norm(s.sheet_name)
ORDER BY result, s.start_date;

-- Totals sanity check — expect 18 subscriptions and $37,000 MRR once every
-- row above says MATCHED.
SELECT
  count(*)                        AS subscriptions,
  sum(amount_cents) / 100         AS mrr_usd,
  (SELECT count(*) FROM public.billing_periods WHERE due_date <= CURRENT_DATE) AS invoices_due_to_date,
  (SELECT sum(amount_cents) / 100 FROM public.billing_periods WHERE due_date <= CURRENT_DATE) AS billed_to_date_usd
FROM public.billing_subscriptions
WHERE status = 'active';

-- Cleanup once the report looks right:
--   DROP TABLE public._billing_seed;
--   DROP FUNCTION public._billing_norm(TEXT);
