-- Put every active client into the billing cycle.
--
-- WHY THIS EXISTS
-- `seed_billing.sql` was a one-time load of the 2026-07-31 contract sheet.
-- Nothing creates a subscription after that, so any client onboarded since is
-- invisible to /financials — the KPI strip, Payments, Moment Delivery and
-- Billing Schedules all read through `billing_subscriptions`, and only BD
-- Pipeline Value reads `brands` directly. As of 2026-08-14 that was Grateful
-- Fred, Hey Mila, Obnoxius Golf and Spikeball.
--
-- WHAT IT DOES
--   1. Creates one subscription for every ACTIVE brand that has a retainer and
--      a start date but no schedule yet. The brand row is the source of truth
--      here — this script invents no figures.
--   2. Generates that subscription's invoices from its start date through the
--      end of next month, using the same anniversary + clamp rule as
--      generatePeriods() in src/lib/billing.ts (a 31st anchor bills
--      5/31 → 6/30 → 7/31, it does not stick at the 30th).
--   3. Reports what it created and what it had to skip.
--
-- WHAT IT DOES NOT DO
--   * It does not mark anything PAID. Every invoice lands as 'scheduled',
--     including ones for months already collected. Only paid invoices count
--     toward moments owed, so a client stays at 0 owed until you tick the
--     collected months off in the Payments table on /financials.
--   * It does not touch `brands`. Retainer and start date are read, never
--     written — the reverse of seed_billing.sql, which synced the sheet down
--     onto the brand rows.
--   * It does not touch existing schedules, or generate periods for them. Use
--     the "Sync invoices" button for that.
--
-- SAFE TO RE-RUN. Both inserts are ON CONFLICT DO NOTHING, and period
-- generation is scoped to subscriptions that have no periods at all, so a
-- second run cannot duplicate an invoice or revive one you deliberately
-- voided. Run it again whenever new clients have been onboarded.
--
-- Requires: supabase/migrations/20260731_add_billing.sql already applied.
--
-- EXPECTED RESULT for the four clients missing as of 2026-08-14, computed by
-- running generatePeriods() from src/lib/billing.ts over their brand rows.
-- Check the report in section 3 against this — if the SQL and the TypeScript
-- disagree about a date, the SQL is wrong, because billing.ts is what the app
-- renders from.
--
--   Grateful Fred  $2500  anchor 31   2026-07-31 (due), 2026-08-31, 2026-09-30
--   Hey Mila       $2250  anchor 5    2026-08-05 (due), 2026-09-05
--   Obnoxius Golf  $2500  anchor 1    2026-07-01 (due), 2026-08-01 (due), 2026-09-01
--   Spikeball      $2500  anchor 5    2026-08-05 (due), 2026-09-05
--
--   10 invoices total, 5 of them already due. Grateful Fred is the case worth
--   eyeballing: an anchor of 31 must bill 7/31 → 8/31 → 9/30, clamping in
--   September without STICKING at the 30th afterward.

-- ---------------------------------------------------------------------------
-- 0. Preview — run this on its own first if you want to see the damage before
--    you do it. It is a plain SELECT and changes nothing.
-- ---------------------------------------------------------------------------

SELECT
  b.name,
  b.pipeline_status,
  b.monthly_retainer,
  b.start_date,
  CASE
    WHEN b.monthly_retainer IS NULL OR b.monthly_retainer <= 0 THEN 'SKIP — no retainer on the brand'
    WHEN b.start_date IS NULL                                  THEN 'SKIP — no start date on the brand'
    ELSE 'WILL CREATE'
  END AS action
FROM public.brands b
LEFT JOIN public.billing_subscriptions s ON s.brand_id = b.id
WHERE b.is_active AND s.id IS NULL
ORDER BY action, b.name;

-- ---------------------------------------------------------------------------
-- 1. Subscriptions
-- ---------------------------------------------------------------------------

BEGIN;

INSERT INTO public.billing_subscriptions
  (brand_id, amount_cents, start_date, anchor_day, status, notes)
SELECT
  b.id,
  ROUND(b.monthly_retainer * 100)::int,
  b.start_date,
  EXTRACT(DAY FROM b.start_date)::smallint,
  'active',
  'Backfilled from the brand record — onboarded after the 2026-07-31 contract-sheet seed.'
FROM public.brands b
LEFT JOIN public.billing_subscriptions s ON s.brand_id = b.id
WHERE b.is_active
  AND s.id IS NULL
  AND b.monthly_retainer IS NOT NULL
  AND b.monthly_retainer > 0
  AND b.start_date IS NOT NULL
ON CONFLICT (brand_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Invoices — start date through the end of NEXT month.
--
--    Lifted verbatim from seed_billing.sql so the two can't drift, with one
--    change: the span is scoped to subscriptions that have NO periods yet, so
--    this only ever fills in a brand-new schedule and never reaches into an
--    existing client's history.
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
  WHERE sub.status = 'active'
    AND sub.ended_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.billing_periods p WHERE p.subscription_id = sub.id
    )
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

COMMIT;

-- ---------------------------------------------------------------------------
-- 3. Report — every active client, whether it is now in the billing cycle,
--    and how many invoices are sitting unpaid.
--
--    `unpaid_due` is your to-do list: those are invoices already due that are
--    still marked scheduled. Tick off the ones actually collected in the
--    Payments table, or Moment Delivery will show the client as owing nothing.
-- ---------------------------------------------------------------------------

SELECT
  b.name,
  CASE WHEN s.id IS NULL THEN 'NOT BILLING' ELSE 'in billing cycle' END AS state,
  (s.amount_cents / 100.0)                                             AS retainer,
  s.start_date,
  COUNT(p.id)                                                          AS invoices,
  COUNT(p.id) FILTER (WHERE p.status = 'paid')                         AS paid,
  COUNT(p.id) FILTER (WHERE p.status = 'scheduled'
                        AND p.due_date <= CURRENT_DATE)                AS unpaid_due
FROM public.brands b
LEFT JOIN public.billing_subscriptions s ON s.brand_id = b.id
LEFT JOIN public.billing_periods p       ON p.subscription_id = s.id
WHERE b.is_active
GROUP BY b.name, s.id, s.amount_cents, s.start_date
ORDER BY state, b.name;
