-- LP tracking UX (follow-up to 20260915_add_lp_results.sql, same day):
--
-- 1. brands.meta_ad_account_id — the brand's Meta ad account, managed once on
--    the brand page. The Results tab's start-tracking form offers it as a
--    select instead of asking someone to paste act_… per project.
--
-- 2. lp_tracking.launched_on becomes NULLABLE. NULL = "not detected yet": the
--    nightly agent discovers the page's ads first, then reports the earliest
--    day any of them delivered, and the ingest endpoint fills launched_on in
--    (only while it is NULL — a human-set date is never overwritten). Daily
--    pulls for a tracking start only once the date exists.
--    The lp_tracking_dates_ordered CHECK is NULL-safe as written (a NULL
--    comparison passes a CHECK), so it needs no change.

BEGIN;

ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS meta_ad_account_id TEXT;

ALTER TABLE public.lp_tracking
  ALTER COLUMN launched_on DROP NOT NULL;

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFY (run after applying):
--   SELECT column_name, is_nullable FROM information_schema.columns
--    WHERE (table_name = 'brands' AND column_name = 'meta_ad_account_id')
--       OR (table_name = 'lp_tracking' AND column_name = 'launched_on');
--   -- two rows; lp_tracking.launched_on must show is_nullable = 'YES'.
