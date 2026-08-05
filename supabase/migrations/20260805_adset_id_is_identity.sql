-- Ad set ID alone identifies an ad-set-tracked moment.
--
-- WHY (Giovane, 2026-08-05): Meta object IDs are globally unique, so an ad set
-- ID identifies an ad set on its own. Requiring the campaign ID and campaign
-- name alongside it made linking a six-field paste when three fields carry all
-- the information.
--
-- The distinction this migration draws, and the one worth keeping straight:
--
--   IDENTITY  what a tracked row IS, and what an incoming result row must
--             match. Ad-set rows: meta_adset_id. Campaign rows:
--             meta_campaign_id. Never both.
--
--   CONTEXT   everything else. campaign_id and campaign_name on an ad-set row
--             are context — they let the UI say "ad set in <campaign>" and let
--             a rejection name the campaign a stray row belongs to. Useful,
--             but never load-bearing for matching, and never typed by a human:
--             the agent reports them back on its first pull and they are
--             backfilled from there.
--
-- So meta_campaign_id and campaign_name become NULLABLE, and the unique key
-- moves to whichever id is the identity for that row.

BEGIN;

ALTER TABLE public.tracked_campaigns
  ALTER COLUMN meta_campaign_id DROP NOT NULL,
  ALTER COLUMN campaign_name    DROP NOT NULL;

-- A row with neither id is not a link to anything.
ALTER TABLE public.tracked_campaigns
  DROP CONSTRAINT IF EXISTS tracked_campaign_has_an_identity;
ALTER TABLE public.tracked_campaigns
  ADD CONSTRAINT tracked_campaign_has_an_identity
  CHECK (meta_adset_id IS NOT NULL OR meta_campaign_id IS NOT NULL);

-- Same blank-string guard as meta_adset_id: an empty campaign id would be a
-- third state alongside NULL and a real value, and would collide in the
-- COALESCE key below.
ALTER TABLE public.tracked_campaigns
  DROP CONSTRAINT IF EXISTS tracked_campaign_campaign_id_not_blank;
ALTER TABLE public.tracked_campaigns
  ADD CONSTRAINT tracked_campaign_campaign_id_not_blank
  CHECK (meta_campaign_id IS NULL OR length(trim(meta_campaign_id)) > 0);

-- THE IDENTITY KEY. COALESCE picks the ad set id when there is one, and falls
-- back to the campaign id otherwise — exactly the rule the validator's match
-- key uses, so what matches in the app is what can be stored in the DB.
--
-- Note this REPLACES the previous three-column key. Under that key, adding a
-- campaign id to an ad-set row (which the backfill now does) would change the
-- row's identity — a thing that must never happen to an identity.
DROP INDEX IF EXISTS public.uq_tracked_campaigns_meta_ids;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tracked_campaigns_meta_ids
  ON public.tracked_campaigns (
    meta_ad_account_id,
    COALESCE(meta_adset_id, meta_campaign_id)
  );

COMMENT ON COLUMN public.tracked_campaigns.meta_adset_id IS
  'IDENTITY for ad-set-level tracking. NULL means the whole campaign is tracked, and meta_campaign_id is the identity instead.';
COMMENT ON COLUMN public.tracked_campaigns.meta_campaign_id IS
  'IDENTITY when meta_adset_id is NULL. When meta_adset_id is set this is CONTEXT only — backfilled by the ingest agent, used for display and for clearer rejections, never for matching.';

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFY (run after applying):
--   SELECT indexdef FROM pg_indexes
--    WHERE indexname = 'uq_tracked_campaigns_meta_ids';
--   -- must read COALESCE(meta_adset_id, meta_campaign_id)
--
--   SELECT is_nullable FROM information_schema.columns
--    WHERE table_name = 'tracked_campaigns' AND column_name = 'meta_campaign_id';
--   -- YES
