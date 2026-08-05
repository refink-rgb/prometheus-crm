-- Ad-set level tracking for campaign results.
--
-- WHY: 20260805_add_campaign_results.sql assumed one Meta campaign per
-- marketing moment. That holds for some clients — Noble's
-- "CTC | CBO | Marketing Moment - Utility Dress Bundle" is a standalone
-- campaign — but not for all of them.
--
-- Noble's live setup runs every moment as an AD SET inside one evergreen
-- campaign, "CTC - ACQ - Marketing Moments - Cost per Result"
-- (campaign 6987812298183):
--
--   260729 - Molly's Favorites          ACTIVE, from 2026-07-29
--   260723 - Summer Launch - Jort…      paused
--   260703 - 4th of July Flash Sale     paused
--   260626 - Summer Sale                paused
--   260522 - Spring BOGO Promotion      paused
--
-- Tracking that campaign as "Molly's Favorites" would have reported $2,700 of
-- spend against a moment that actually spent $1,304, starting two months
-- before the moment existed. Every individual number would be real, which is
-- exactly why no validator could have caught it — the error is in the label,
-- not the arithmetic.
--
-- So a tracked row now names an OPTIONAL ad set. NULL meta_adset_id keeps the
-- original meaning (track the whole campaign); a non-NULL one narrows tracking
-- to that ad set. Nothing about campaign_daily_results changes — the grain is
-- still one row per tracked entity per day.

BEGIN;

ALTER TABLE public.tracked_campaigns
  ADD COLUMN IF NOT EXISTS meta_adset_id TEXT,
  -- Display snapshot, same contract as campaign_name: Meta ad set names get
  -- edited mid-flight and the Results tab shows what we linked.
  ADD COLUMN IF NOT EXISTS adset_name TEXT;

-- The old key was (ad_account, campaign). Under ad-set tracking that would
-- reject the second moment in the same evergreen campaign as a duplicate.
DROP INDEX IF EXISTS public.uq_tracked_campaigns_meta_ids;

-- COALESCE rather than a plain three-column UNIQUE: in Postgres NULLs are
-- distinct from each other, so a plain unique index would happily allow the
-- SAME campaign to be whole-campaign-tracked twice. Normalising NULL to ''
-- makes "the whole campaign" a single, unique value like any other.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tracked_campaigns_meta_ids
  ON public.tracked_campaigns (
    meta_ad_account_id,
    meta_campaign_id,
    COALESCE(meta_adset_id, '')
  );

-- An empty string would be a third meaning for "no ad set" alongside NULL and
-- a real id, and the COALESCE key above would then collide with genuine
-- whole-campaign rows. Force the two-state invariant at the DB.
ALTER TABLE public.tracked_campaigns
  DROP CONSTRAINT IF EXISTS tracked_campaign_adset_id_not_blank;
ALTER TABLE public.tracked_campaigns
  ADD CONSTRAINT tracked_campaign_adset_id_not_blank
  CHECK (meta_adset_id IS NULL OR length(trim(meta_adset_id)) > 0);

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFY (run after applying):
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'tracked_campaigns'
--      AND column_name IN ('meta_adset_id', 'adset_name');   -- two rows
--
--   SELECT indexdef FROM pg_indexes
--    WHERE indexname = 'uq_tracked_campaigns_meta_ids';
--   -- must mention COALESCE(meta_adset_id, ''::text)
--
-- NOTE: linking BOTH a whole campaign AND an ad set inside it is allowed by
-- the schema (they are different rows), but it double-counts that ad set's
-- spend in the Results header tiles. The UI warns about it; there is no cheap
-- constraint for it, since the check is "does any OTHER row for this campaign
-- exist at a different level".
