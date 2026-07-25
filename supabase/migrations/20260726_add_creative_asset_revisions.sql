-- Edit history for creative assets.
--
-- Until now each AI edit overwrote creative_assets.revision_url, so the panel
-- could only ever show "the current image" with no indication of how many edits
-- it had been through or what it looked like before. The image FILES were never
-- lost (every edit uploads to revisions/{assetId}-{timestamp}.png), only the
-- pointer — so this table records one row per edit and older files stay
-- reachable.
--
-- revision_number is 1-based and per-asset: Edit 1, Edit 2, … The unedited
-- Drive import is "Original" and is NOT a row here (it lives on the asset via
-- drive_file_id / thumbnail_url).

CREATE TABLE IF NOT EXISTS creative_asset_revisions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id       UUID NOT NULL REFERENCES creative_assets(id) ON DELETE CASCADE,
  revision_number INT NOT NULL,
  image_url      TEXT NOT NULL,
  prompt         TEXT,
  created_by     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (asset_id, revision_number)
);

CREATE INDEX IF NOT EXISTS idx_car_asset_number
  ON creative_asset_revisions (asset_id, revision_number);

ALTER TABLE creative_asset_revisions ENABLE ROW LEVEL SECURITY;

-- Mirrors the per-verb policy shape used by brands/projects/etc: authenticated
-- users get full access, and canEdit() in the app is the real boundary.
-- Anonymous (the client review link) gets nothing — edit history is
-- internal-only by construction.
DROP POLICY IF EXISTS "auth_select_car" ON creative_asset_revisions;
DROP POLICY IF EXISTS "auth_insert_car" ON creative_asset_revisions;
DROP POLICY IF EXISTS "auth_update_car" ON creative_asset_revisions;
DROP POLICY IF EXISTS "auth_delete_car" ON creative_asset_revisions;
CREATE POLICY "auth_select_car" ON creative_asset_revisions FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_car" ON creative_asset_revisions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_car" ON creative_asset_revisions FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth_delete_car" ON creative_asset_revisions FOR DELETE TO authenticated USING (true);
