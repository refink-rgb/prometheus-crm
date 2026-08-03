BEGIN;

-- Retire the 'done' pipeline stage. 'live' becomes the terminal track stage and
-- archiving is expressed only by projects.is_complete.
--
-- Why: the Done column was a waiting room. The pipeline board only loads
-- is_complete = false, and a card only reached Done once both tracks were
-- there — at which point the sole remaining action was clicking "Mark project
-- complete", after which the card left the board anyway. Every other read in
-- the app already treated 'done' as a synonym for 'live' (`s === 'live' || s
-- === 'done'`). So the stage carried no information that is_complete didn't.
--
-- NO DATA IS LOST HERE. This does not delete or archive any project:
--   * 'done' tracks are rewritten to 'live' — the true state (they shipped).
--   * is_complete is NOT touched. Completed projects stay completed.
--   * Nothing is dropped: deliverables, notes, comments, assets, journeys and
--     pipeline_events all hang off projects.id, which is untouched.
--   * Completed projects remain fully browsable at
--     /brands/<brandId>/projects/<projectId> and in the brand's completed list;
--     they are only filtered out of the in-flight boards, exactly as before.
--
-- pipeline_events is deliberately NOT rewritten. It is an append-only audit log
-- with a service-role-only write path; historical to_stage='done' rows are the
-- honest record of what happened and the insights charts still label them.

-- 1. Collapse the retired stage into 'live' on both tracks.
UPDATE projects SET lp_stage        = 'live' WHERE lp_stage        = 'done';
UPDATE projects SET creatives_stage = 'live' WHERE creatives_stage = 'done';

-- 2. Narrow the CHECK constraints so 'done' can't come back.
--    (Auto-named by Postgres; verify if a drop fails:
--     SELECT conname FROM pg_constraint
--       WHERE conrelid = 'projects'::regclass AND contype = 'c';)
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_lp_stage_check;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_creatives_stage_check;

ALTER TABLE projects
  ADD CONSTRAINT projects_lp_stage_check
    CHECK (lp_stage IN ('brief','in_progress','internal_review','client_review','revisions','live')),
  ADD CONSTRAINT projects_creatives_stage_check
    CHECK (creatives_stage IN ('brief','in_progress','internal_review','client_review','revisions','live'));

-- 3. Sanity check — must return 0 rows before you COMMIT.
--    SELECT id, name, lp_stage, creatives_stage FROM projects
--      WHERE lp_stage = 'done' OR creatives_stage = 'done';

COMMIT;
