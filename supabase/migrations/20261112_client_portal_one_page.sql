-- One-page client portal (/portal/<client_token>).
--
-- 1. brand_asset_links: a link (Drive folder, Canva, Slack file) that holds
--    brand files we have not filed in Prometheus yet. `covers` says which
--    intake items it holds, so the intake stops asking the client for them
--    ("linked"), while the team still sees them as "file it".
-- 2. projects.promised_date: the only date a client ever sees. Internal
--    due_date stays internal, so stale planning dates never read as broken
--    promises.
-- 3. brands.portal_ready_at: the team has checked this client's page (stale
--    projects closed, promised dates set). Until then the portal shows a
--    holding message instead of projects.
-- 4. brands.checkin_requested_at: the team asked for a check-in now; the card
--    shows on the portal until answered or 14 days pass.
--
-- All additive. Pages on other branches ignore the new columns.

BEGIN;

CREATE TABLE IF NOT EXISTS public.brand_asset_links (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id    UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  url         TEXT NOT NULL CHECK (url ~* '^https?://'),
  covers      TEXT[] NOT NULL DEFAULT '{}'
              CHECK (covers <@ ARRAY['guidelines', 'logo', 'product_images', 'fonts']::text[]),
  note        TEXT,
  added_by    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_brand_asset_links_brand ON public.brand_asset_links (brand_id, created_at DESC);
ALTER TABLE public.brand_asset_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "brand_asset_links_rw_auth" ON public.brand_asset_links;
CREATE POLICY "brand_asset_links_rw_auth" ON public.brand_asset_links
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS promised_date DATE;
ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS portal_ready_at TIMESTAMPTZ;
ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS checkin_requested_at TIMESTAMPTZ;

COMMIT;
