BEGIN;

-- Add a new 'revisions' pipeline stage, positioned between 'client_review' and
-- 'live'. A track auto-advances into it when the client leaves feedback / asks
-- for a revision (see addProjectComment / updateAssetStatus in actions.ts).
-- No data migration needed — this only widens the allowed set.

-- Drop the existing inline CHECK constraints (auto-named by Postgres).
-- Verify names first if this fails:
--   SELECT conname FROM pg_constraint WHERE conrelid = 'projects'::regclass AND contype = 'c';
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_lp_stage_check;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_creatives_stage_check;

-- Re-add with 'revisions' included.
ALTER TABLE projects
  ADD CONSTRAINT projects_lp_stage_check
    CHECK (lp_stage IN ('brief','in_progress','internal_review','client_review','revisions','live','done')),
  ADD CONSTRAINT projects_creatives_stage_check
    CHECK (creatives_stage IN ('brief','in_progress','internal_review','client_review','revisions','live','done'));

COMMIT;
