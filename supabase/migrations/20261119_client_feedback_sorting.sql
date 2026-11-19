-- Client feedback → client rules.
--
-- Every comment a client leaves on a review link is either a standing rule
-- ("never use AI images of our product"), one more time they said an existing
-- rule, or a one-off fix for that piece. The brand's Feedback tab lists client
-- comments nobody has sorted yet. A comment is sorted when it has a
-- client_rule_mentions row (saved as a rule) or when someone marked it a
-- one-off, which is what this column records.
--
-- ADDITIVE ONLY. Nullable columns; nothing existing is changed. Safe to re-run.
-- The app tolerates this not having run: every comment then counts as unsorted
-- and the One-off button reports that the migration is missing.

BEGIN;

ALTER TABLE public.project_comments ADD COLUMN IF NOT EXISTS rule_checked_at TIMESTAMPTZ;
ALTER TABLE public.project_comments ADD COLUMN IF NOT EXISTS rule_checked_by UUID
  REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMIT;
