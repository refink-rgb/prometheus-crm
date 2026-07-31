-- Financials: retainer billing ledger.
--
-- Before this, /financials derived every figure from three columns on `brands`
-- (monthly_retainer, start_date, is_active). That can show a run-rate but can
-- never answer "did Cookt pay in June?" — there was nowhere to record it.
--
-- Two tables:
--   billing_subscriptions — one live retainer agreement per brand. Pause,
--     end (churn), and price live here.
--   billing_periods       — the ledger. One row per client per billing month,
--     with its OWN amount_cents snapshot. History is therefore immutable
--     against later price changes: raising a retainer from $2,000 to $2,500
--     never rewrites what last month's invoice said.
--
-- Deliberately NOT stored: "due" / "overdue". Those are derived from due_date
-- vs today at render (src/lib/billing.ts). Storing them would mean a missed
-- cron night silently shows stale statuses.
--
-- Churn rule (Giovane, 2026-07-31): ending a client stops FUTURE revenue and
-- must never erase collected history. `ended_at` suppresses generation from
-- that date forward; every already-paid period stays exactly as it was.

BEGIN;

CREATE TABLE IF NOT EXISTS public.billing_subscriptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id      UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,

  -- Integer cents. `brands.monthly_retainer` is a float written via
  -- parseFloat; the ledger does not repeat that mistake.
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),

  -- The contract date from the source-of-truth sheet. First invoice is due
  -- on this date; every later one on its monthly anniversary.
  start_date    DATE NOT NULL,

  -- Day-of-month the retainer bills on. Seeded from start_date but stored
  -- separately so it survives a start_date correction, and so a 31st anchor
  -- keeps billing the 31st after being clamped to 30 in a short month.
  anchor_day    SMALLINT NOT NULL CHECK (anchor_day BETWEEN 1 AND 31),

  status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'paused', 'cancelled')),

  -- Pause window. A due date inside it generates no invoice. NULL
  -- paused_until = open-ended pause.
  paused_from   DATE,
  paused_until  DATE,

  -- Churn date. No period is generated on or after it. Existing periods,
  -- paid or not, are untouched.
  ended_at      DATE,

  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  CONSTRAINT pause_window_ordered
    CHECK (paused_until IS NULL OR paused_from IS NULL OR paused_until > paused_from)
);

-- One live retainer per brand. A second agreement for the same client would
-- silently double-bill them on the month view.
CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_subscriptions_brand
  ON public.billing_subscriptions (brand_id);

CREATE TABLE IF NOT EXISTS public.billing_periods (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id    UUID NOT NULL REFERENCES public.billing_subscriptions(id) ON DELETE CASCADE,
  -- Denormalized so the month view can join brands without a second hop.
  brand_id           UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,

  -- Months elapsed since start_date (0 = first invoice). NOT a running count:
  -- a paused month leaves a gap rather than renumbering everything after it.
  period_index       INTEGER NOT NULL CHECK (period_index >= 0),

  period_start       DATE NOT NULL,
  period_end         DATE NOT NULL,
  due_date           DATE NOT NULL,

  -- Snapshot of what was owed for THIS month. Never recomputed.
  amount_cents       INTEGER NOT NULL CHECK (amount_cents >= 0),

  -- Only what a human asserted. 'waived' = comped, shows in history at $0
  -- collected. 'void' = should never have existed (billed in error).
  status             TEXT NOT NULL DEFAULT 'scheduled'
                       CHECK (status IN ('scheduled', 'paid', 'waived', 'void')),

  paid_at            DATE,
  paid_amount_cents  INTEGER CHECK (paid_amount_cents IS NULL OR paid_amount_cents >= 0),
  reference          TEXT,
  note               TEXT,

  marked_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  marked_at          TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A period marked paid must say how much actually landed, or the
  -- collected-to-date total silently under-reports.
  CONSTRAINT paid_has_amount
    CHECK (status <> 'paid' OR paid_amount_cents IS NOT NULL)
);

-- Generation idempotency at the DB level: the daily cron can double-fire, or
-- a manual regenerate can race it, and the worst case is a no-op upsert
-- instead of a client being invoiced twice for the same month.
CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_periods_sub_index
  ON public.billing_periods (subscription_id, period_index);

-- The month view's query: everything due in [month_start, month_end].
CREATE INDEX IF NOT EXISTS idx_billing_periods_due_date
  ON public.billing_periods (due_date);
CREATE INDEX IF NOT EXISTS idx_billing_periods_brand
  ON public.billing_periods (brand_id);
-- Partial index for the "what's still owed" scan, which only ever looks at
-- unpaid rows.
CREATE INDEX IF NOT EXISTS idx_billing_periods_outstanding
  ON public.billing_periods (due_date) WHERE status = 'scheduled';

-- RLS — same posture as brands/projects/offer_cards: authenticated users
-- read/write, authorization enforced at the app layer. /financials is
-- additionally hidden from LP/creative editors via isJobEditor().
ALTER TABLE public.billing_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_periods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_billing_subscriptions" ON public.billing_subscriptions;
CREATE POLICY "auth_select_billing_subscriptions" ON public.billing_subscriptions FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_billing_subscriptions" ON public.billing_subscriptions;
CREATE POLICY "auth_insert_billing_subscriptions" ON public.billing_subscriptions FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_billing_subscriptions" ON public.billing_subscriptions;
CREATE POLICY "auth_update_billing_subscriptions" ON public.billing_subscriptions FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_delete_billing_subscriptions" ON public.billing_subscriptions;
CREATE POLICY "auth_delete_billing_subscriptions" ON public.billing_subscriptions FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_select_billing_periods" ON public.billing_periods;
CREATE POLICY "auth_select_billing_periods" ON public.billing_periods FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_billing_periods" ON public.billing_periods;
CREATE POLICY "auth_insert_billing_periods" ON public.billing_periods FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_billing_periods" ON public.billing_periods;
CREATE POLICY "auth_update_billing_periods" ON public.billing_periods FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_delete_billing_periods" ON public.billing_periods;
CREATE POLICY "auth_delete_billing_periods" ON public.billing_periods FOR DELETE TO authenticated USING (true);

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFY (run after applying):
--   SELECT count(*) FROM public.billing_subscriptions;  -- 0 before seeding
--   SELECT count(*) FROM public.billing_periods;        -- 0 before seeding
-- Then run supabase/seed_billing.sql, which inserts the 18 signed clients
-- and reports any sheet name that did not match a row in `brands`.
