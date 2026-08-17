-- Moment grouping: several marketing moments are NOT one campaign or one ad
-- set — they're split into sibling ad sets (Mad Viking and WOW Sports both run
-- "prospecting" + "retention" as two separate ad sets for the same moment).
--
-- Before this, tracked_campaigns had no way to say "these two rows are really
-- one thing." Linking both ad sets gave two Results cards with two separate
-- ROAS/spend figures and no combined total — accurate per-entity, but not what
-- the question "how did Father's Day do?" actually wants answered.
--
-- moment_group_id is OPTIONAL. NULL (the default, and every row created before
-- this migration) behaves exactly as before — one row, one card. Setting it on
-- two or more rows makes the Results tab render them as a single combined
-- card, summed per day from the underlying rows. The rows themselves are
-- UNCHANGED — grouping is a display-layer join, not a merge. Ending or
-- unlinking one ad set never touches its sibling.

BEGIN;

ALTER TABLE public.tracked_campaigns
  ADD COLUMN IF NOT EXISTS moment_group_id UUID,
  -- The name the COMBINED card shows ("Father's Day 2026"), since no single
  -- ad set's name represents the pair. Required whenever moment_group_id is
  -- set — a group with no label is unreadable in the UI.
  ADD COLUMN IF NOT EXISTS moment_group_label TEXT;

ALTER TABLE public.tracked_campaigns
  DROP CONSTRAINT IF EXISTS tracked_campaign_group_needs_label;
ALTER TABLE public.tracked_campaigns
  ADD CONSTRAINT tracked_campaign_group_needs_label
  CHECK (moment_group_id IS NULL OR moment_group_label IS NOT NULL);

-- The overview page's grouping query: everything live, grouped by this key
-- when present.
CREATE INDEX IF NOT EXISTS idx_tracked_campaigns_moment_group
  ON public.tracked_campaigns (moment_group_id) WHERE moment_group_id IS NOT NULL;

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFY (run after applying):
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'tracked_campaigns'
--      AND column_name IN ('moment_group_id', 'moment_group_label');
--   -- two rows expected.
