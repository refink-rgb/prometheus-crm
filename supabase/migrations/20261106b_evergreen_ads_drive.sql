-- Evergreen Ads: videos can come from a Google Drive folder, like BFCM
-- calibration samples (20261031_bfcm_calibration_drive.sql).
--
-- Additive and safe to re-run. 20261106_add_evergreen_ads.sql already includes
-- these columns, so this file only matters if that one was run before they
-- were added. Run in the Supabase SQL editor:
-- https://supabase.com/dashboard/project/mhizyjlvqrhwzjqywiwz/sql/new

BEGIN;

-- The folder the team pasted on the ad.
ALTER TABLE public.evergreen_ads
  ADD COLUMN IF NOT EXISTS drive_folder_url TEXT CHECK (drive_folder_url IS NULL OR length(drive_folder_url) <= 500);

-- Which Drive file a video was copied from, and the version copied (Drive
-- modifiedTime), so a re-sync adds new files and turns edited ones into a new
-- cut instead of duplicating them.
ALTER TABLE public.evergreen_ad_videos
  ADD COLUMN IF NOT EXISTS drive_file_id TEXT CHECK (drive_file_id IS NULL OR drive_file_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  ADD COLUMN IF NOT EXISTS drive_modified_at TEXT CHECK (drive_modified_at IS NULL OR length(drive_modified_at) <= 40);

CREATE UNIQUE INDEX IF NOT EXISTS evergreen_ad_videos_drive_uniq
  ON public.evergreen_ad_videos (ad_id, drive_file_id) WHERE drive_file_id IS NOT NULL;

COMMIT;
