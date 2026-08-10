BEGIN;

-- Add a new 'ready' pipeline stage, positioned between 'revisions' and 'live'.
-- It holds work that is finished and approved but not yet launched — the gap
-- the board previously had no column for (cards sat in 'revisions' or jumped
-- straight to 'live'). Nothing auto-advances into it; it is reached by the
-- normal STAGE_ORDER advance / drag, so no data migration is needed — this
-- only widens the allowed set.

-- Drop the existing CHECK constraints (added by 20260723_add_revisions_stage
-- and narrowed by 20260802_remove_done_stage). Verify names first if this fails:
--   SELECT conname FROM pg_constraint WHERE conrelid = 'projects'::regclass AND contype = 'c';
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_lp_stage_check;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_creatives_stage_check;

-- Re-add with 'ready' included. 'done' stays out — it was retired on 2026-08-02.
ALTER TABLE projects
  ADD CONSTRAINT projects_lp_stage_check
    CHECK (lp_stage IN ('brief','in_progress','internal_review','client_review','revisions','ready','live')),
  ADD CONSTRAINT projects_creatives_stage_check
    CHECK (creatives_stage IN ('brief','in_progress','internal_review','client_review','revisions','ready','live'));

COMMIT;
