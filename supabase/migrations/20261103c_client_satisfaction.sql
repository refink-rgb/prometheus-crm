-- Client satisfaction — the /satisfaction page. ONE row per client: its
-- current review. No history (Giovane, 2026-11-03: not needed for now).
--
-- Five topics graded 1-5 (nullable: a client can be tagged before it is
-- graded), a note per topic, one general note, and two tags:
--   is_new     — Results carries no weight in the score while set.
--   is_churned — a label only; the score is computed exactly the same.
--
-- `score` is the satisfaction percentage computed at save time by
-- src/lib/satisfaction.ts (max 95). NULL until every counted topic is graded.
--
-- Replaces the earlier, history-keeping client_satisfaction_reviews table
-- (migration 20261103b, now removed). If that table was created, each
-- client's newest review is copied in below; the old table is left in place.

BEGIN;

CREATE TABLE IF NOT EXISTS public.client_satisfaction (
  brand_id            UUID PRIMARY KEY REFERENCES public.brands(id) ON DELETE CASCADE,

  results             SMALLINT CHECK (results BETWEEN 1 AND 5),
  timelines           SMALLINT CHECK (timelines BETWEEN 1 AND 5),
  quality             SMALLINT CHECK (quality BETWEEN 1 AND 5),
  communication       SMALLINT CHECK (communication BETWEEN 1 AND 5),
  owner_feel          SMALLINT CHECK (owner_feel BETWEEN 1 AND 5),

  results_note        TEXT,
  timelines_note      TEXT,
  quality_note        TEXT,
  communication_note  TEXT,
  owner_feel_note     TEXT,
  general_note        TEXT,

  is_new              BOOLEAN NOT NULL DEFAULT FALSE,
  is_churned          BOOLEAN NOT NULL DEFAULT FALSE,

  score               NUMERIC(5, 2) CHECK (score BETWEEN 0 AND 95),

  updated_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by_email    TEXT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF to_regclass('public.client_satisfaction_reviews') IS NOT NULL THEN
    INSERT INTO public.client_satisfaction (
      brand_id, results, timelines, quality, communication, owner_feel,
      results_note, timelines_note, quality_note, communication_note, owner_feel_note, general_note,
      score, updated_by, updated_by_email, updated_at
    )
    SELECT DISTINCT ON (brand_id)
      brand_id, results, timelines, quality, communication, owner_feel,
      results_note, timelines_note, quality_note, communication_note, owner_feel_note, general_note,
      score, reviewed_by, reviewed_by_email, created_at
    FROM public.client_satisfaction_reviews
    ORDER BY brand_id, created_at DESC
    ON CONFLICT (brand_id) DO NOTHING;
  END IF;
END $$;

-- RLS — same posture as the rest of the app: authenticated users read/write,
-- the app layer decides who sees the page (canViewDashboard).
ALTER TABLE public.client_satisfaction ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_client_satisfaction_current" ON public.client_satisfaction;
CREATE POLICY "auth_select_client_satisfaction_current" ON public.client_satisfaction FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_client_satisfaction_current" ON public.client_satisfaction;
CREATE POLICY "auth_insert_client_satisfaction_current" ON public.client_satisfaction FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_client_satisfaction_current" ON public.client_satisfaction;
CREATE POLICY "auth_update_client_satisfaction_current" ON public.client_satisfaction FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_delete_client_satisfaction_current" ON public.client_satisfaction;
CREATE POLICY "auth_delete_client_satisfaction_current" ON public.client_satisfaction FOR DELETE TO authenticated USING (true);

COMMIT;
