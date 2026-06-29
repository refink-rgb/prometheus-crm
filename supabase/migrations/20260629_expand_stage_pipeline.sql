BEGIN;

-- 1. Drop existing inline CHECK constraints (auto-named by Postgres)
--    Verify names first: SELECT conname FROM pg_constraint WHERE conrelid = 'projects'::regclass AND contype = 'c';
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_lp_stage_check;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_creatives_stage_check;

-- 2. Migrate existing data
--    'review'  → 'internal_review' (was internal QA, not yet client-facing)
--    'done'    → 'live'            (was launched; new 'done' is the formal archive state)
--    'brief' and 'in_progress' are unchanged
UPDATE projects SET lp_stage        = 'internal_review' WHERE lp_stage        = 'review';
UPDATE projects SET creatives_stage = 'internal_review' WHERE creatives_stage = 'review';
UPDATE projects SET lp_stage        = 'live'            WHERE lp_stage        = 'done';
UPDATE projects SET creatives_stage = 'live'            WHERE creatives_stage = 'done';

-- 3. Re-add constraints with all 6 values
ALTER TABLE projects
  ADD CONSTRAINT projects_lp_stage_check
    CHECK (lp_stage IN ('brief','in_progress','internal_review','client_review','live','done')),
  ADD CONSTRAINT projects_creatives_stage_check
    CHECK (creatives_stage IN ('brief','in_progress','internal_review','client_review','live','done'));

COMMIT;
