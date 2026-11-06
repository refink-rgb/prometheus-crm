-- Evergreen Ads — the /evergreen-ads board.
--
-- A quick pipeline for evergreen ads, kept apart from the production pipeline:
-- its own tables, so nothing about projects, stages, creative_assets or
-- project_comments changes. Four stages only:
--
--   brief -> doing -> client_review -> live
--
--   evergreen_ads          one card per ad. brief_url is the link to wherever
--                          the brief lives (Google Doc / Drive). share_token
--                          opens the client review link /review/evergreen/<token>.
--   evergreen_ad_videos    motion videos on an ad. The file sits in the public
--                          project-images bucket under evergreen/<ad id>/, the
--                          same way creative videos do, so a client plays it
--                          without a Google sign-in. poster_url is a still the
--                          browser grabbed from the file at upload time.
--   evergreen_ad_comments  client feedback (audience 'client', from the review
--                          link) and team notes (audience 'internal', never
--                          shown on the review link).
--
-- RLS: same posture as the rest of the app — authenticated users read/write,
-- the app layer decides who may edit (canEdit). The anonymous review link has
-- NO policy here: its page and actions use the service role after matching the
-- share_token, like the existing creative review link.
--
-- Safe to re-run. Run in the Supabase SQL editor:
-- https://supabase.com/dashboard/project/mhizyjlvqrhwzjqywiwz/sql/new

BEGIN;

CREATE TABLE IF NOT EXISTS public.evergreen_ads (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id           UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  stage              TEXT NOT NULL DEFAULT 'brief'
                       CHECK (stage IN ('brief', 'doing', 'client_review', 'live')),
  brief_url          TEXT,
  notes              TEXT,
  share_token        TEXT NOT NULL UNIQUE
                       DEFAULT (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  client_approved    BOOLEAN NOT NULL DEFAULT FALSE,
  client_approved_at TIMESTAMPTZ,
  is_archived        BOOLEAN NOT NULL DEFAULT FALSE,
  created_by         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS evergreen_ads_board_idx ON public.evergreen_ads (is_archived, stage, created_at);
CREATE INDEX IF NOT EXISTS evergreen_ads_brand_idx ON public.evergreen_ads (brand_id);

CREATE TABLE IF NOT EXISTS public.evergreen_ad_videos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_id          UUID NOT NULL REFERENCES public.evergreen_ads(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  video_url      TEXT NOT NULL,
  storage_path   TEXT NOT NULL,
  poster_url     TEXT,
  poster_path    TEXT,
  -- Bumped each time the team uploads a revised cut onto this video.
  version        INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'approved', 'needs_revision', 'rejected')),
  client_visible BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  uploaded_by    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS evergreen_ad_videos_ad_idx ON public.evergreen_ad_videos (ad_id, sort_order);

CREATE TABLE IF NOT EXISTS public.evergreen_ad_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_id       UUID NOT NULL REFERENCES public.evergreen_ads(id) ON DELETE CASCADE,
  video_id    UUID REFERENCES public.evergreen_ad_videos(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL,
  -- Set only by the authed staff write path; the review link never sets it.
  author_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  content     TEXT NOT NULL,
  audience    TEXT NOT NULL DEFAULT 'client' CHECK (audience IN ('client', 'internal')),
  resolved_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS evergreen_ad_comments_ad_idx ON public.evergreen_ad_comments (ad_id, created_at);

ALTER TABLE public.evergreen_ads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evergreen_ad_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evergreen_ad_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_evergreen_ads" ON public.evergreen_ads;
CREATE POLICY "auth_select_evergreen_ads" ON public.evergreen_ads FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_evergreen_ads" ON public.evergreen_ads;
CREATE POLICY "auth_insert_evergreen_ads" ON public.evergreen_ads FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_evergreen_ads" ON public.evergreen_ads;
CREATE POLICY "auth_update_evergreen_ads" ON public.evergreen_ads FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_delete_evergreen_ads" ON public.evergreen_ads;
CREATE POLICY "auth_delete_evergreen_ads" ON public.evergreen_ads FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_select_evergreen_ad_videos" ON public.evergreen_ad_videos;
CREATE POLICY "auth_select_evergreen_ad_videos" ON public.evergreen_ad_videos FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_evergreen_ad_videos" ON public.evergreen_ad_videos;
CREATE POLICY "auth_insert_evergreen_ad_videos" ON public.evergreen_ad_videos FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_evergreen_ad_videos" ON public.evergreen_ad_videos;
CREATE POLICY "auth_update_evergreen_ad_videos" ON public.evergreen_ad_videos FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_delete_evergreen_ad_videos" ON public.evergreen_ad_videos;
CREATE POLICY "auth_delete_evergreen_ad_videos" ON public.evergreen_ad_videos FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_select_evergreen_ad_comments" ON public.evergreen_ad_comments;
CREATE POLICY "auth_select_evergreen_ad_comments" ON public.evergreen_ad_comments FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_evergreen_ad_comments" ON public.evergreen_ad_comments;
CREATE POLICY "auth_insert_evergreen_ad_comments" ON public.evergreen_ad_comments FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_evergreen_ad_comments" ON public.evergreen_ad_comments;
CREATE POLICY "auth_update_evergreen_ad_comments" ON public.evergreen_ad_comments FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_delete_evergreen_ad_comments" ON public.evergreen_ad_comments;
CREATE POLICY "auth_delete_evergreen_ad_comments" ON public.evergreen_ad_comments FOR DELETE TO authenticated USING (true);

COMMIT;
