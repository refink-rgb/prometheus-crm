-- Video creatives.
--
-- Until now the CRM was images only: listDriveFolder kept image/* and dropped
-- everything else, so an editor who synced a folder of videos saw nothing and
-- no reason why, and the revision uploader refused video outright.
--
-- A creative is now an image OR a video, decided once per creative and never
-- per version: a video ad's revisions are videos too. Every URL on the row
-- (video_url, revision_url, published_url) holds that kind of file.
--
-- WHY A COPY: Drive's own player needs a Google sign-in with access to the file,
-- which a client on the review link does not have. So each Drive video is
-- copied once into the project-images bucket — the same public bucket the image
-- revisions already live in — and plays from there for everyone.
--
--   media_type        'image' | 'video'. Existing rows are images.
--   video_url         the playable copy of the Drive ORIGINAL (revision_url /
--                     published_url carry later versions, as for images).
--   video_status      pending -> importing -> ready | failed | too_large.
--                     NULL on images.
--   video_source_id   the Drive file the importer must copy next. Equals
--                     drive_file_id for the original; a different id means a
--                     re-uploaded fix that becomes a revision once copied.
--   video_error / video_started_at   for the editor, and for spotting a stuck
--                     import (an 'importing' row older than ~6 minutes is dead).
--
-- Safe to re-run. Run in the Supabase SQL editor:
-- https://supabase.com/dashboard/project/mhizyjlvqrhwzjqywiwz/sql/new

alter table public.creative_assets
  add column if not exists media_type text not null default 'image',
  add column if not exists video_url text,
  add column if not exists video_status text,
  add column if not exists video_source_id text,
  add column if not exists video_error text,
  add column if not exists video_started_at timestamptz;

alter table public.creative_assets drop constraint if exists creative_assets_media_type_check;
alter table public.creative_assets
  add constraint creative_assets_media_type_check check (media_type in ('image', 'video'));

alter table public.creative_assets drop constraint if exists creative_assets_video_status_check;
alter table public.creative_assets
  add constraint creative_assets_video_status_check
  check (video_status is null or video_status in ('pending', 'importing', 'ready', 'failed', 'too_large'));

-- The importer looks for work by project and status.
create index if not exists creative_assets_video_pending_idx
  on public.creative_assets (project_id, video_status)
  where media_type = 'video';
