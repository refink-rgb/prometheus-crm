BEGIN;

-- Per-stage due dates (planning targets, not gates). One nullable DATE column
-- for each of the 4 pre-live lifecycle stages. The existing `due_date` column
-- keeps its role as the LIVE (launch) target date; `done` has no target date.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS stage_brief_due_date           DATE,
  ADD COLUMN IF NOT EXISTS stage_in_progress_due_date     DATE,
  ADD COLUMN IF NOT EXISTS stage_internal_review_due_date DATE,
  ADD COLUMN IF NOT EXISTS stage_client_review_due_date   DATE;

-- New scalar brief fields introduced by the LP/Creatives split.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS product_description     TEXT,
  ADD COLUMN IF NOT EXISTS retail_price            TEXT,
  ADD COLUMN IF NOT EXISTS offer_dynamics_type     TEXT,
  ADD COLUMN IF NOT EXISTS offer_dynamics_detail   TEXT,
  ADD COLUMN IF NOT EXISTS competitor_reference    TEXT,
  ADD COLUMN IF NOT EXISTS client_ad_inspiration   TEXT,
  ADD COLUMN IF NOT EXISTS ad_copy_primary_text    TEXT,
  ADD COLUMN IF NOT EXISTS ad_copy_description     TEXT,
  ADD COLUMN IF NOT EXISTS ad_copy_url             TEXT,
  ADD COLUMN IF NOT EXISTS product_images_link     TEXT;

-- Creatives copy banks (5 headline variations, 5 subcopy variations, 3 eyebrow
-- variations). Stored as JSON arrays of strings so the count can flex if the
-- team decides they want more/fewer variations later.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS ad_headlines JSONB,
  ADD COLUMN IF NOT EXISTS ad_subcopies JSONB,
  ADD COLUMN IF NOT EXISTS ad_eyebrows  JSONB;

COMMIT;
