-- Client check-in: a short survey the client answers on their intake link
-- (/intake/<token>/check-in), about every 60 days. Kept apart from
-- client_satisfaction, which is the team's own rating.
--
-- Questions (customer success research):
--   recommend      0-10, how likely to recommend us (NPS-style), plus why
--   ease           1-5, how easy we are to work with (effort predicts loyalty)
--   success_90d    what would make the next 90 days a success for them
--   changed        anything changed on their side: team, budget, priorities
--
-- A low score or a change sets needs_follow_up; the team clears it with
-- followed_up_at once someone has reached out.

BEGIN;

CREATE TABLE IF NOT EXISTS public.client_checkins (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id        UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  recommend       SMALLINT NOT NULL CHECK (recommend BETWEEN 0 AND 10),
  recommend_why   TEXT,
  ease            SMALLINT NOT NULL CHECK (ease BETWEEN 1 AND 5),
  success_90d     TEXT,
  changed         BOOLEAN NOT NULL DEFAULT false,
  changed_note    TEXT,
  needs_follow_up BOOLEAN NOT NULL DEFAULT false,
  followed_up_at  TIMESTAMPTZ,
  followed_up_by  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_checkins_brand_created
  ON public.client_checkins (brand_id, created_at DESC);

-- Staff read and update (mark followed up). The client writes through the
-- service client after the token check, never with these policies.
ALTER TABLE public.client_checkins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "client_checkins_rw_auth" ON public.client_checkins;
CREATE POLICY "client_checkins_rw_auth" ON public.client_checkins
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;
