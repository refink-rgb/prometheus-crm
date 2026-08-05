-- Daily campaign results — paid-media performance, one row per campaign per day.
--
-- Before this, Prometheus stored ZERO performance metrics. The only way a
-- number entered the system was a human typing revenue/ROAS/CTR by hand into
-- MomentReportForm at case-study time. "How is Tuesday's launch doing?" meant
-- opening Ads Manager, per client.
--
-- Three tables:
--   tracked_campaigns      — the MANUAL link between a project (marketing
--     moment) and a Meta campaign. Nothing is auto-discovered; the link is the
--     contract, and ingestion may never invent a campaign that isn't here.
--   campaign_daily_results — the grain. One row per tracked campaign per day.
--   campaign_result_ingests — audit trail of agent runs.
--
-- Two facts shape this schema:
--
-- 1. META RESTATES NUMBERS AFTER THE FACT. Attribution backfills for days
--    after the event, so Tuesday's ROAS is different next week. Every write is
--    an UPSERT on (tracked_campaign_id, stat_date) — never append-once — and
--    the agent re-pulls a trailing window rather than only yesterday. That is
--    what uq_campaign_daily_results_campaign_date enforces at the DB level.
--
-- 2. THE INGESTION PATH IS AN LLM (a scheduled Claude agent using the Meta
--    MCP). That's the chosen tradeoff — it reuses access we already have — but
--    it means bad data arrives PLAUSIBLY FORMATTED. Hence `warnings`, `source`,
--    `reported_at`, and the ingest log: report to a human, don't silently
--    block or silently accept. Same philosophy as findUnverifiedNumbers() in
--    src/lib/ai/approval-message.ts.
--
-- Money is INTEGER CENTS, matching the precedent deliberately set in
-- src/lib/billing.ts. Summing floats across 90 days of spend drifts.

BEGIN;

CREATE TABLE IF NOT EXISTS public.tracked_campaigns (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The marketing moment this campaign is running for. Cascade so deleting a
  -- project cleans up its tracking and (via the next cascade) its daily rows.
  project_id          UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  -- Denormalized so the Results tab can group by client without a second hop.
  brand_id            UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,

  -- Meta identifiers, exactly as the ad account reports them. `act_…` prefix
  -- included on the account id — that is what the MCP returns and what a
  -- human pastes out of Ads Manager.
  meta_ad_account_id  TEXT NOT NULL,
  meta_campaign_id    TEXT NOT NULL,
  -- Display snapshot of the campaign name at link time. Meta names get edited
  -- mid-flight; the CRM shows what we linked, not whatever it is called today.
  campaign_name       TEXT NOT NULL,

  -- The "from" date for the daily table. The agent's first pull covers
  -- launched_on → yesterday.
  launched_on         DATE NOT NULL,
  -- NULL MEANS LIVE. This is the Results tab's filter and the work-list filter
  -- in /api/results/ingest. Setting it stops the agent fetching new days
  -- without deleting a single row of history.
  ended_on            DATE,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  CONSTRAINT tracked_campaign_dates_ordered
    CHECK (ended_on IS NULL OR ended_on >= launched_on)
);

-- One tracking row per real campaign. Linking the same campaign to a second
-- project would double-count it in the header tiles.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tracked_campaigns_meta_ids
  ON public.tracked_campaigns (meta_ad_account_id, meta_campaign_id);

-- The Results tab's query: everything still live.
CREATE INDEX IF NOT EXISTS idx_tracked_campaigns_live
  ON public.tracked_campaigns (launched_on DESC) WHERE ended_on IS NULL;
CREATE INDEX IF NOT EXISTS idx_tracked_campaigns_project
  ON public.tracked_campaigns (project_id);
CREATE INDEX IF NOT EXISTS idx_tracked_campaigns_brand
  ON public.tracked_campaigns (brand_id);

CREATE TABLE IF NOT EXISTS public.campaign_daily_results (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracked_campaign_id       UUID NOT NULL
                              REFERENCES public.tracked_campaigns(id) ON DELETE CASCADE,

  -- The DAY THE ACTIVITY HAPPENED, in the ad account's reporting timezone.
  -- Distinct from reported_at (when we pulled it) — under restatement those
  -- two diverge by days, and conflating them is how a dashboard starts lying.
  stat_date                 DATE NOT NULL,

  -- ── Money: integer cents. See src/lib/billing.ts for why. ───────────────
  spend_cents               BIGINT NOT NULL CHECK (spend_cents >= 0),
  revenue_cents             BIGINT NOT NULL CHECK (revenue_cents >= 0),
  -- Read AS REPORTED from the ad account's existing "Incremental Revenue"
  -- column. NEVER derived, never estimated. NULL when the account has no such
  -- column configured — the UI renders that as an em dash, not a zero.
  incremental_revenue_cents BIGINT CHECK (incremental_revenue_cents IS NULL OR incremental_revenue_cents >= 0),
  -- Cost per acquisition. NULL when purchases = 0 (dividing by zero is not a
  -- CPA of 0, and storing 0 would drag every average down).
  cpa_cents                 BIGINT CHECK (cpa_cents IS NULL OR cpa_cents >= 0),

  -- ── Counts ─────────────────────────────────────────────────────────────
  purchases                 INTEGER NOT NULL DEFAULT 0 CHECK (purchases >= 0),
  -- Stored so LP conversion is AUDITABLE rather than merely asserted. If the
  -- agent's lp_conversion_rate disagrees with purchases/landing_page_views we
  -- can see it, which is the whole point of keeping the denominator.
  landing_page_views        INTEGER CHECK (landing_page_views IS NULL OR landing_page_views >= 0),

  -- ── Ratios ─────────────────────────────────────────────────────────────
  -- ROAS is a MULTIPLE (2.45 = 2.45x return), not a percentage.
  roas                      NUMERIC(10,4),
  -- PERCENTAGES ARE STORED AS PERCENT, NOT AS A FRACTION.
  --   2.4500 means 2.45%, NOT 245%.
  -- This is the classic silent bug in every metrics table ever built. It is
  -- written here, on the column, because a comment in application code is one
  -- refactor away from being lost.
  unique_outbound_ctr       NUMERIC(10,4) CHECK (unique_outbound_ctr IS NULL OR unique_outbound_ctr >= 0),
  lp_conversion_rate        NUMERIC(10,4) CHECK (lp_conversion_rate IS NULL OR lp_conversion_rate >= 0),

  -- Pinned so a later attribution-window change shows up as a labelled step in
  -- the chart rather than an unexplained cliff.
  attribution_window        TEXT NOT NULL DEFAULT '7d_click',

  -- 'mcp_agent' = written by the scheduled agent. 'manual' = a human corrected
  -- it in the UI. A MANUAL ROW IS NEVER OVERWRITTEN BY THE AGENT — that is the
  -- repair path, and the ingest upsert filters on it explicitly.
  source                    TEXT NOT NULL DEFAULT 'mcp_agent'
                              CHECK (source IN ('mcp_agent', 'manual')),

  -- Validation flags from src/lib/results/validate.ts, rendered as a badge on
  -- the row. A failed cross-check STORES the row with a warning rather than
  -- dropping it: a dropped row looks identical to "the campaign didn't run".
  warnings                  TEXT[] NOT NULL DEFAULT '{}',

  -- When the agent pulled this. Drives the freshness stamp in the UI.
  reported_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- THE UPSERT KEY. This is the restatement fix: re-pulling Tuesday next week
-- updates Tuesday in place instead of appending a second, contradictory
-- Tuesday. Without this index the whole ingestion design is append-only and
-- the daily table silently doubles every week.
CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_daily_results_campaign_date
  ON public.campaign_daily_results (tracked_campaign_id, stat_date);

-- The per-campaign daily view reads launch → today in date order.
CREATE INDEX IF NOT EXISTS idx_campaign_daily_results_campaign_date
  ON public.campaign_daily_results (tracked_campaign_id, stat_date DESC);
-- The Results tab's cross-campaign window scan.
CREATE INDEX IF NOT EXISTS idx_campaign_daily_results_stat_date
  ON public.campaign_daily_results (stat_date DESC);

CREATE TABLE IF NOT EXISTS public.campaign_result_ingests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- The window the agent said it was reporting on, e.g. '2026-08-01..2026-08-04'.
  date_range     TEXT,
  rows_received  INTEGER NOT NULL DEFAULT 0,
  rows_upserted  INTEGER NOT NULL DEFAULT 0,
  rows_rejected  INTEGER NOT NULL DEFAULT 0,
  -- Per-row rejections and warnings, verbatim. Small table, high value on the
  -- day the agent quietly starts returning garbage.
  warnings       JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_campaign_result_ingests_run_at
  ON public.campaign_result_ingests (run_at DESC);

-- RLS — same posture as billing/marketing_reports: authenticated staff have
-- full read/write, real authorization is canEdit() at the app layer. The
-- ingest endpoint writes with the SERVICE ROLE (it has no session cookie), so
-- these policies deliberately grant nothing to anon.
ALTER TABLE public.tracked_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_daily_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_result_ingests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tracked_campaigns_rw_auth" ON public.tracked_campaigns;
CREATE POLICY "tracked_campaigns_rw_auth" ON public.tracked_campaigns
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "campaign_daily_results_rw_auth" ON public.campaign_daily_results;
CREATE POLICY "campaign_daily_results_rw_auth" ON public.campaign_daily_results
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "campaign_result_ingests_rw_auth" ON public.campaign_result_ingests;
CREATE POLICY "campaign_result_ingests_rw_auth" ON public.campaign_result_ingests
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFY (run after applying):
--   SELECT table_name FROM information_schema.tables
--    WHERE table_name IN ('tracked_campaigns','campaign_daily_results','campaign_result_ingests');
--   -- three rows expected.
--
--   SELECT indexname FROM pg_indexes
--    WHERE indexname = 'uq_campaign_daily_results_campaign_date';
--   -- MUST return one row. This index IS the restatement fix; without it the
--   -- ingest endpoint's upsert degrades into an append and the daily table
--   -- grows a duplicate row per campaign per day per run.
