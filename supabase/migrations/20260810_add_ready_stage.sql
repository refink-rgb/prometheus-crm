BEGIN;

-- Add a new 'ready' pipeline stage, positioned between 'revisions' and 'live'.
-- It holds work that is finished and approved but not yet launched — the gap
-- the board previously had no column for (cards sat in 'revisions' or jumped
-- straight to 'live'). Nothing auto-advances into it; it is reached by the
-- normal STAGE_ORDER advance / drag.

-- 1. Collapse any leftover 'done' tracks into 'live'.
--
-- This repeats step 1 of 20260802_remove_done_stage.sql on purpose. That
-- migration is not guaranteed to have been applied everywhere — the first run
-- of this file failed on a database that still held 'done' rows, because the
-- constraint below (correctly) does not allow them. Re-running the collapse is
-- harmless where 20260802 already ran: it matches zero rows.
--
-- NO DATA IS LOST. 'done' meant "shipped", which is what 'live' means; every
-- read path in the app already maps one to the other (normalizeStage). No
-- project is deleted or archived and is_complete is not touched.
--
-- pipeline_events is deliberately NOT rewritten — it is an append-only audit
-- log, and historical to_stage='done' rows are the honest record of what
-- happened. The insights charts still label them.
UPDATE projects SET lp_stage        = 'live' WHERE lp_stage        = 'done';
UPDATE projects SET creatives_stage = 'live' WHERE creatives_stage = 'done';

-- 2. Widen the allowed set with 'ready'.
--
-- Drop the existing CHECK constraints (auto-named by Postgres). Verify names
-- first if a drop fails:
--   SELECT conname FROM pg_constraint
--     WHERE conrelid = 'projects'::regclass AND contype = 'c';
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_lp_stage_check;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_creatives_stage_check;

-- 'done' stays out — it was retired on 2026-08-02 and step 1 just cleared it.
ALTER TABLE projects
  ADD CONSTRAINT projects_lp_stage_check
    CHECK (lp_stage IN ('brief','in_progress','internal_review','client_review','revisions','ready','live')),
  ADD CONSTRAINT projects_creatives_stage_check
    CHECK (creatives_stage IN ('brief','in_progress','internal_review','client_review','revisions','ready','live'));

-- 3. Sanity check — should return 0 rows.
--    SELECT id, name, lp_stage, creatives_stage FROM projects
--      WHERE lp_stage NOT IN ('brief','in_progress','internal_review','client_review','revisions','ready','live')
--         OR creatives_stage NOT IN ('brief','in_progress','internal_review','client_review','revisions','ready','live');

COMMIT;
