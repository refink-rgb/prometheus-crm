-- LP-scoped daily results — the per-project "Results" tab.
--
-- The existing pipeline (20260805_add_campaign_results.sql) tracks a MANUALLY
-- LINKED campaign or ad set per moment. This adds the URL-scoped view Lucas
-- mocked up: every ad in the brand's account whose destination is the
-- project's landing page, aggregated per day, compared against the REST of
-- the ad account.
--
-- Same two facts shape it: Meta restates (every write is an upsert on a
-- unique day key) and the ingestion path is an LLM (warnings, source,
-- reported_at, deterministic server-side URL verification on discovery).
--
-- Discovery is SUGGEST-AND-CONFIRM, not silent: the agent proposes ads, the
-- server re-verifies each destination URL against the tracked LP URL before
-- storing, and a human can exclude any ad (or add one by id) in the project's
-- Results tab. Only status='included' ads feed the daily aggregates.
--
-- Four tables + one flag:
--   lp_tracking          — the manual opt-in, one row per project. The
--     contract: no project appears in the ingest work list without one.
--   lp_ad_matches        — the reviewed ad set, with campaign + ad set names.
--   lp_daily_results     — one row per tracking per day, summed over the
--     included ads.
--   account_daily_results — whole-account totals per day, the denominator for
--     the "rest of account" comparison. Keyed per ad account (not per
--     tracking) so two projects in one account share the same pull.
--   projects.results_client_visible — the "push to client" flag; the client
--     review link renders the results section only when it is true.

BEGIN;

CREATE TABLE IF NOT EXISTS public.lp_tracking (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One tracking per project. The Results tab is a project tab; two trackings
  -- for one project would mean two competing sources for the same tiles.
  project_id          UUID NOT NULL UNIQUE REFERENCES public.projects(id) ON DELETE CASCADE,
  brand_id            UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  meta_ad_account_id  TEXT NOT NULL,
  -- SNAPSHOT of the landing page URL at tracking start — the matching key.
  -- Deliberately not a live read of projects.lp_url: if the LP moves, the
  -- human restarts tracking, rather than the match set silently changing.
  lp_url              TEXT NOT NULL,
  launched_on         DATE NOT NULL,
  -- NULL MEANS LIVE — the ingest work-list filter, same as tracked_campaigns.
  ended_on            DATE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT lp_tracking_dates_ordered
    CHECK (ended_on IS NULL OR ended_on >= launched_on)
);

CREATE INDEX IF NOT EXISTS idx_lp_tracking_live
  ON public.lp_tracking (launched_on DESC) WHERE ended_on IS NULL;
CREATE INDEX IF NOT EXISTS idx_lp_tracking_brand
  ON public.lp_tracking (brand_id);

CREATE TABLE IF NOT EXISTS public.lp_ad_matches (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lp_tracking_id    UUID NOT NULL REFERENCES public.lp_tracking(id) ON DELETE CASCADE,
  meta_ad_id        TEXT NOT NULL,
  ad_name           TEXT,
  -- Campaign + ad set CONTEXT, shown in the review list so a human can judge
  -- a match by where the ad lives, not just its name.
  meta_campaign_id  TEXT,
  campaign_name     TEXT,
  meta_adset_id     TEXT,
  adset_name        TEXT,
  -- The destination URL exactly as the agent reported it. The server verified
  -- it against lp_url (normalized) before this row was allowed in; kept so a
  -- human auditing the match can see what was actually matched.
  destination_url   TEXT,
  -- 'included' feeds the daily aggregates; 'excluded' is a human veto. An
  -- excluded ad's row survives (unique key below) so re-discovery cannot
  -- resurrect it.
  status            TEXT NOT NULL DEFAULT 'included'
                      CHECK (status IN ('included', 'excluded')),
  source            TEXT NOT NULL DEFAULT 'agent'
                      CHECK (source IN ('agent', 'manual')),
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at        TIMESTAMPTZ
);

-- One row per ad per tracking. This is what makes exclusion sticky across
-- re-discovery: the agent's re-report of a known ad hits this key and is
-- ignored rather than inserted as a fresh 'included' row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lp_ad_matches_tracking_ad
  ON public.lp_ad_matches (lp_tracking_id, meta_ad_id);
CREATE INDEX IF NOT EXISTS idx_lp_ad_matches_tracking
  ON public.lp_ad_matches (lp_tracking_id);

CREATE TABLE IF NOT EXISTS public.lp_daily_results (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lp_tracking_id      UUID NOT NULL REFERENCES public.lp_tracking(id) ON DELETE CASCADE,
  stat_date           DATE NOT NULL,

  -- Money: integer cents, matching billing.ts / campaign_daily_results.
  spend_cents         BIGINT NOT NULL CHECK (spend_cents >= 0),
  revenue_cents       BIGINT NOT NULL CHECK (revenue_cents >= 0),

  -- RAW COUNTS, not ratios. Every KPI on the tab (CPM, CTR, AOV, CVR,
  -- click-to-checkout, checkout conversion, ROAS) is DERIVED in
  -- src/lib/results.ts from these — so each one is auditable from the row
  -- rather than asserted by the agent. NULL = Meta didn't report it, and the
  -- UI renders an em dash, never a zero.
  purchases           INTEGER NOT NULL DEFAULT 0 CHECK (purchases >= 0),
  impressions         BIGINT CHECK (impressions IS NULL OR impressions >= 0),
  link_clicks         INTEGER CHECK (link_clicks IS NULL OR link_clicks >= 0),
  initiate_checkouts  INTEGER CHECK (initiate_checkouts IS NULL OR initiate_checkouts >= 0),
  landing_page_views  INTEGER CHECK (landing_page_views IS NULL OR landing_page_views >= 0),

  -- How many included ads this day's pull actually covered. Audit: a sudden
  -- drop here explains a metrics cliff that would otherwise read as
  -- performance.
  matched_ad_count    INTEGER CHECK (matched_ad_count IS NULL OR matched_ad_count >= 0),

  attribution_window  TEXT NOT NULL DEFAULT '7d_click',
  source              TEXT NOT NULL DEFAULT 'mcp_agent'
                        CHECK (source IN ('mcp_agent', 'manual')),
  warnings            TEXT[] NOT NULL DEFAULT '{}',
  reported_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- THE UPSERT KEY — the restatement fix, same as campaign_daily_results.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lp_daily_results_tracking_date
  ON public.lp_daily_results (lp_tracking_id, stat_date);
CREATE INDEX IF NOT EXISTS idx_lp_daily_results_tracking_date
  ON public.lp_daily_results (lp_tracking_id, stat_date DESC);

CREATE TABLE IF NOT EXISTS public.account_daily_results (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meta_ad_account_id  TEXT NOT NULL,
  brand_id            UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  stat_date           DATE NOT NULL,

  spend_cents         BIGINT NOT NULL CHECK (spend_cents >= 0),
  revenue_cents       BIGINT NOT NULL CHECK (revenue_cents >= 0),
  purchases           INTEGER NOT NULL DEFAULT 0 CHECK (purchases >= 0),
  impressions         BIGINT CHECK (impressions IS NULL OR impressions >= 0),
  link_clicks         INTEGER CHECK (link_clicks IS NULL OR link_clicks >= 0),
  initiate_checkouts  INTEGER CHECK (initiate_checkouts IS NULL OR initiate_checkouts >= 0),
  landing_page_views  INTEGER CHECK (landing_page_views IS NULL OR landing_page_views >= 0),

  attribution_window  TEXT NOT NULL DEFAULT '7d_click',
  source              TEXT NOT NULL DEFAULT 'mcp_agent'
                        CHECK (source IN ('mcp_agent', 'manual')),
  warnings            TEXT[] NOT NULL DEFAULT '{}',
  reported_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per ad account per day, shared by every tracking in that account.
CREATE UNIQUE INDEX IF NOT EXISTS uq_account_daily_results_account_date
  ON public.account_daily_results (meta_ad_account_id, stat_date);
CREATE INDEX IF NOT EXISTS idx_account_daily_results_account_date
  ON public.account_daily_results (meta_ad_account_id, stat_date DESC);

-- The "push to client" flag. The client review link (/review/[token]) renders
-- the results section only when this is true — internal-first, exactly like
-- creative client_visible.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS results_client_visible BOOLEAN NOT NULL DEFAULT false;

-- RLS — same posture as the 20260805 tables: authenticated staff read/write,
-- authorization is canEdit() at the app layer, the ingest endpoint writes via
-- the service role. INTENTIONALLY NO anon policy: the client review link
-- reads these tables with the service role, gated on
-- projects.results_client_visible — the marketing_reports precedent.
ALTER TABLE public.lp_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lp_ad_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lp_daily_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_daily_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lp_tracking_rw_auth" ON public.lp_tracking;
CREATE POLICY "lp_tracking_rw_auth" ON public.lp_tracking
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "lp_ad_matches_rw_auth" ON public.lp_ad_matches;
CREATE POLICY "lp_ad_matches_rw_auth" ON public.lp_ad_matches
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "lp_daily_results_rw_auth" ON public.lp_daily_results;
CREATE POLICY "lp_daily_results_rw_auth" ON public.lp_daily_results
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "account_daily_results_rw_auth" ON public.account_daily_results;
CREATE POLICY "account_daily_results_rw_auth" ON public.account_daily_results
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFY (run after applying):
--   SELECT table_name FROM information_schema.tables
--    WHERE table_name IN ('lp_tracking','lp_ad_matches','lp_daily_results','account_daily_results');
--   -- four rows expected.
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'projects' AND column_name = 'results_client_visible';
--   -- one row expected.
--   SELECT indexname FROM pg_indexes
--    WHERE indexname IN ('uq_lp_daily_results_tracking_date','uq_account_daily_results_account_date','uq_lp_ad_matches_tracking_ad');
--   -- three rows expected — the first two ARE the restatement fix, the third
--   -- is what keeps a human's exclusion sticky across re-discovery.
