-- Client satisfaction reviews — the /satisfaction page.
--
-- Each save is a NEW row, never an update: the newest row per brand is the
-- client's current rating, older rows are its history (so a score can be
-- compared with the last review). Five topics graded 1-5, a note per topic,
-- and one general note.
--
-- `score` is the satisfaction percentage computed at save time by
-- src/lib/satisfaction.ts (max 95). Stored so history keeps the number that was
-- shown then, even if the weights change later.

BEGIN;

CREATE TABLE IF NOT EXISTS public.client_satisfaction_reviews (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id            UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,

  results             SMALLINT NOT NULL CHECK (results BETWEEN 1 AND 5),
  timelines           SMALLINT NOT NULL CHECK (timelines BETWEEN 1 AND 5),
  quality             SMALLINT NOT NULL CHECK (quality BETWEEN 1 AND 5),
  communication       SMALLINT NOT NULL CHECK (communication BETWEEN 1 AND 5),
  owner_feel          SMALLINT NOT NULL CHECK (owner_feel BETWEEN 1 AND 5),

  results_note        TEXT,
  timelines_note      TEXT,
  quality_note        TEXT,
  communication_note  TEXT,
  owner_feel_note     TEXT,
  general_note        TEXT,

  score               NUMERIC(5, 2) NOT NULL CHECK (score BETWEEN 0 AND 95),

  reviewed_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_by_email   TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_satisfaction_brand_created
  ON public.client_satisfaction_reviews (brand_id, created_at DESC);

-- RLS — same posture as the rest of the app: authenticated users read/write,
-- the app layer decides who sees the page (canViewDashboard).
ALTER TABLE public.client_satisfaction_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_client_satisfaction" ON public.client_satisfaction_reviews;
CREATE POLICY "auth_select_client_satisfaction" ON public.client_satisfaction_reviews FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_client_satisfaction" ON public.client_satisfaction_reviews;
CREATE POLICY "auth_insert_client_satisfaction" ON public.client_satisfaction_reviews FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_client_satisfaction" ON public.client_satisfaction_reviews;
CREATE POLICY "auth_delete_client_satisfaction" ON public.client_satisfaction_reviews FOR DELETE TO authenticated USING (true);

COMMIT;
