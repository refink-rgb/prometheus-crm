-- Friday Capacity Report — a weekly, per-person check-in.
--
-- Deliberately narrow: it collects ONLY what pipeline_events cannot know.
-- The event log already gives /insights the elapsed time per stage, throughput,
-- queue depth, slip buckets, and which STAGE a slip happened in. What it can't
-- see is (a) effort vs elapsed — a card can sit in In Progress for six days
-- with four hours of work in it — and (b) WHY something slipped. Those two
-- gaps are the whole point of this table.
--
-- Two tables:
--   capacity_reports         — one submission per person per week.
--   capacity_report_entries  — one row per moment they actually touched.
--
-- Weeks run Mon–Sun Eastern (same convention as the Timeline view);
-- `week_start` is always the Monday.

BEGIN;

CREATE TABLE IF NOT EXISTS public.capacity_reports (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Monday of the reported week, Eastern.
  week_start         DATE NOT NULL,

  -- "How loaded were you?" 1-5, and the number of moments that WOULD have been
  -- right. The second is what makes it actionable — a 4/5 is a feeling, but
  -- "carried 5, four was right" is a staffing decision. Moments carried is not
  -- stored: it's the entry count.
  load_rating        SMALLINT CHECK (load_rating BETWEEN 1 AND 5),
  sustainable_moments SMALLINT CHECK (sustainable_moments >= 0),

  -- The only forward-looking signal in the system. Everything in /insights is
  -- backward-looking, so this is the one input that allows intervening before
  -- a slip rather than measuring it after.
  at_risk_next_week  TEXT,

  -- Brief quality is upstream of most production slips and nothing else
  -- measures it.
  briefs_ready       TEXT CHECK (briefs_ready IN ('yes', 'mostly', 'no')),
  briefs_ready_detail TEXT,

  biggest_blocker    TEXT,
  improvement        TEXT,

  -- One rotating question per month, so the weekly form doesn't inflate.
  -- Key identifies which question was asked (see CAPACITY_ROTATING_QUESTIONS
  -- in src/lib/types.ts) — without it, old answers lose their question.
  rotating_key       TEXT,
  rotating_answer    TEXT,

  submitted_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One report per person per week. Re-submitting updates in place rather than
-- stacking duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS uq_capacity_reports_profile_week
  ON public.capacity_reports (profile_id, week_start);

CREATE INDEX IF NOT EXISTS idx_capacity_reports_week
  ON public.capacity_reports (week_start);

CREATE TABLE IF NOT EXISTS public.capacity_report_entries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id     UUID NOT NULL REFERENCES public.capacity_reports(id) ON DELETE CASCADE,

  -- SET NULL, not CASCADE: a deleted project must not silently delete the
  -- hours someone logged against it.
  project_id    UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  -- Snapshot of the moment name, so a report stays readable after the project
  -- is gone or renamed.
  project_label TEXT NOT NULL,

  track         TEXT NOT NULL CHECK (track IN ('lp', 'creative')),

  -- FOCUSED hours — heads-down time, not elapsed days. The event log already
  -- has elapsed. NUMERIC(5,1) allows 0.5 increments up to 9999.9.
  focused_hours NUMERIC(5,1) CHECK (focused_hours >= 0),

  -- Fixed picklist (CAPACITY_SLIP_CAUSES in types.ts), never free text — the
  -- payoff is cross-tabbing self-reported cause against the event log's
  -- attribution_by_stage. Free text across a whole team doesn't aggregate.
  slip_cause    TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per moment per track per report.
CREATE UNIQUE INDEX IF NOT EXISTS uq_capacity_entries_report_project_track
  ON public.capacity_report_entries (report_id, project_id, track);

CREATE INDEX IF NOT EXISTS idx_capacity_entries_report
  ON public.capacity_report_entries (report_id);
CREATE INDEX IF NOT EXISTS idx_capacity_entries_project
  ON public.capacity_report_entries (project_id);

-- RLS — follows the same posture as brands/projects/offer_cards/billing:
-- authenticated users read/write, authorization enforced in the app layer
-- (the page shows you your own report, and only canViewCapacity() sees the
-- team roll-up).
--
-- ⚠ NOTE FOR REVIEW: these reports contain candid free text ("biggest
-- blocker", "what would you change"). Under this policy any authenticated
-- user could read every submission through PostgREST directly, even though
-- the UI doesn't show them. profiles solved the equivalent problem with a
-- stricter policy (see 20260715). Tightening this to "own rows, or an
-- explicit reviewer list" is a deliberate decision to make, not a default —
-- flagged rather than silently chosen, because getting it wrong locks a
-- reviewer out.
ALTER TABLE public.capacity_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capacity_report_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_capacity_reports" ON public.capacity_reports;
CREATE POLICY "auth_select_capacity_reports" ON public.capacity_reports FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_capacity_reports" ON public.capacity_reports;
CREATE POLICY "auth_insert_capacity_reports" ON public.capacity_reports FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_capacity_reports" ON public.capacity_reports;
CREATE POLICY "auth_update_capacity_reports" ON public.capacity_reports FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_delete_capacity_reports" ON public.capacity_reports;
CREATE POLICY "auth_delete_capacity_reports" ON public.capacity_reports FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_select_capacity_entries" ON public.capacity_report_entries;
CREATE POLICY "auth_select_capacity_entries" ON public.capacity_report_entries FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_capacity_entries" ON public.capacity_report_entries;
CREATE POLICY "auth_insert_capacity_entries" ON public.capacity_report_entries FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_capacity_entries" ON public.capacity_report_entries;
CREATE POLICY "auth_update_capacity_entries" ON public.capacity_report_entries FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_delete_capacity_entries" ON public.capacity_report_entries;
CREATE POLICY "auth_delete_capacity_entries" ON public.capacity_report_entries FOR DELETE TO authenticated USING (true);

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFY (run after applying):
--   SELECT count(*) FROM public.capacity_reports;         -- 0
--   SELECT count(*) FROM public.capacity_report_entries;  -- 0
-- Then open /capacity in the app and submit one.
-- ---------------------------------------------------------------------------
