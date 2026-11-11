-- Evergreen Ads: people, due dates and statics. Same ideas as BFCM production.
--
--   evergreen_ads.due_date            when the ad is due. Late cards show red.
--   evergreen_ad_assignees            who is building the ad (any number of
--                                     teammates). They get a notification when
--                                     added and when the client leaves feedback,
--                                     and the ad shows in their My Work.
--   evergreen_ad_videos.media_type    'video' or 'image'. Statics live in the
--                                     same table as videos (the name stayed so
--                                     nothing already deployed breaks).
--   evergreen_ad_comments.pin_x/pin_y where on a static the client pinned a
--                                     note, as a percentage of its width/height.
--
-- Also adds the Drive sync columns from 20261106b, so a database that ran an
-- older 20261106 only needs this file.
--
-- Needs 20261106_add_evergreen_ads.sql first. Safe to re-run. Run in the
-- Supabase SQL editor:
-- https://supabase.com/dashboard/project/mhizyjlvqrhwzjqywiwz/sql/new

BEGIN;

ALTER TABLE public.evergreen_ads
  ADD COLUMN IF NOT EXISTS due_date DATE,
  ADD COLUMN IF NOT EXISTS drive_folder_url TEXT CHECK (drive_folder_url IS NULL OR length(drive_folder_url) <= 500);

ALTER TABLE public.evergreen_ad_videos
  ADD COLUMN IF NOT EXISTS media_type TEXT NOT NULL DEFAULT 'video' CHECK (media_type IN ('video', 'image')),
  ADD COLUMN IF NOT EXISTS drive_file_id TEXT CHECK (drive_file_id IS NULL OR drive_file_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  ADD COLUMN IF NOT EXISTS drive_modified_at TEXT CHECK (drive_modified_at IS NULL OR length(drive_modified_at) <= 40);
CREATE UNIQUE INDEX IF NOT EXISTS evergreen_ad_videos_drive_uniq
  ON public.evergreen_ad_videos (ad_id, drive_file_id) WHERE drive_file_id IS NOT NULL;

ALTER TABLE public.evergreen_ad_comments
  ADD COLUMN IF NOT EXISTS pin_x REAL CHECK (pin_x IS NULL OR (pin_x >= 0 AND pin_x <= 100)),
  ADD COLUMN IF NOT EXISTS pin_y REAL CHECK (pin_y IS NULL OR (pin_y >= 0 AND pin_y <= 100));

CREATE TABLE IF NOT EXISTS public.evergreen_ad_assignees (
  ad_id      UUID NOT NULL REFERENCES public.evergreen_ads(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ad_id, profile_id)
);
CREATE INDEX IF NOT EXISTS evergreen_ad_assignees_profile_idx ON public.evergreen_ad_assignees (profile_id);

-- Same posture as the other evergreen tables: authenticated users read/write,
-- the app decides who may edit (canEdit). No anon policy.
ALTER TABLE public.evergreen_ad_assignees ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_evergreen_ad_assignees" ON public.evergreen_ad_assignees;
CREATE POLICY "auth_select_evergreen_ad_assignees" ON public.evergreen_ad_assignees FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_evergreen_ad_assignees" ON public.evergreen_ad_assignees;
CREATE POLICY "auth_insert_evergreen_ad_assignees" ON public.evergreen_ad_assignees FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_evergreen_ad_assignees" ON public.evergreen_ad_assignees;
CREATE POLICY "auth_delete_evergreen_ad_assignees" ON public.evergreen_ad_assignees FOR DELETE TO authenticated USING (true);

COMMIT;
