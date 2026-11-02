-- Revenue sheet snapshots — the data behind the Dashboard's Financial tab.
--
-- Revenue is tracked in a spreadsheet (client × service × month), not in the
-- CRM. Giovane's call (2026-11-02): the sheet stays the source of truth and is
-- re-uploaded whenever it changes. Every upload is kept as its own snapshot,
-- so the dashboard always reads the newest one and older ones stay around to
-- compare forecasts against.
--
-- Two tables:
--   revenue_uploads — one row per uploaded file, with the month targets read
--     from the sheet's "Month Projection" row.
--   revenue_lines   — one row per client + service line in that file, with
--     its monthly amounts as JSONB ({"2026-10": 250000, ...}, integer cents).
--
-- brand_id is the CRM brand the sheet's client name matched at upload time.
-- NULL = no match; the Financial tab lists those so the name can be fixed.
--
-- billing_subscriptions / billing_periods are untouched: their data stays,
-- the dashboard simply stops reading them.

BEGIN;

CREATE TABLE IF NOT EXISTS public.revenue_uploads (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name          TEXT NOT NULL,
  -- Month keys covered by the sheet, in column order: ["2026-05", ...].
  months             JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Typed targets only ({"2026-10": 20000000}). A target cell that is a SUM
  -- formula is the month's actual total, not a goal, and is left out.
  targets            JSONB NOT NULL DEFAULT '{}'::jsonb,
  line_count         INTEGER NOT NULL DEFAULT 0,
  uploaded_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_by_email  TEXT,
  uploaded_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_revenue_uploads_uploaded_at
  ON public.revenue_uploads (uploaded_at DESC);

CREATE TABLE IF NOT EXISTS public.revenue_lines (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id    UUID NOT NULL REFERENCES public.revenue_uploads(id) ON DELETE CASCADE,
  row_number   INTEGER NOT NULL,
  client_name  TEXT NOT NULL,
  -- 'MM' / 'PCE' today; free text so a new service line needs no migration.
  service      TEXT NOT NULL DEFAULT '',
  start_date   DATE,
  fee_cents    INTEGER,
  brand_id     UUID REFERENCES public.brands(id) ON DELETE SET NULL,
  months       JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_revenue_lines_upload
  ON public.revenue_lines (upload_id);
CREATE INDEX IF NOT EXISTS idx_revenue_lines_brand
  ON public.revenue_lines (brand_id);

-- RLS — same posture as billing: authenticated users read/write, the app
-- layer decides who may see money (canEdit + not a job editor).
ALTER TABLE public.revenue_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenue_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_revenue_uploads" ON public.revenue_uploads;
CREATE POLICY "auth_select_revenue_uploads" ON public.revenue_uploads FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_revenue_uploads" ON public.revenue_uploads;
CREATE POLICY "auth_insert_revenue_uploads" ON public.revenue_uploads FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_revenue_uploads" ON public.revenue_uploads;
CREATE POLICY "auth_update_revenue_uploads" ON public.revenue_uploads FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_delete_revenue_uploads" ON public.revenue_uploads;
CREATE POLICY "auth_delete_revenue_uploads" ON public.revenue_uploads FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_select_revenue_lines" ON public.revenue_lines;
CREATE POLICY "auth_select_revenue_lines" ON public.revenue_lines FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_revenue_lines" ON public.revenue_lines;
CREATE POLICY "auth_insert_revenue_lines" ON public.revenue_lines FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_revenue_lines" ON public.revenue_lines;
CREATE POLICY "auth_update_revenue_lines" ON public.revenue_lines FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_delete_revenue_lines" ON public.revenue_lines;
CREATE POLICY "auth_delete_revenue_lines" ON public.revenue_lines FOR DELETE TO authenticated USING (true);

COMMIT;
