BEGIN;

-- Performance indexes for hot query paths. All are safe to add multiple times
-- (IF NOT EXISTS). Kept inside a transaction — CREATE INDEX CONCURRENTLY would
-- be nicer on a very large table but can't run inside BEGIN/COMMIT, and our
-- tables are small enough that a brief exclusive lock is acceptable.

-- projects: filtered by brand_id everywhere, dashboard filters is_complete +
-- orders by due_date, portal orders by due_date, journey lookups by journey_id.
CREATE INDEX IF NOT EXISTS idx_projects_brand_id            ON projects (brand_id);
CREATE INDEX IF NOT EXISTS idx_projects_is_complete_due     ON projects (is_complete, due_date);
CREATE INDEX IF NOT EXISTS idx_projects_due_date            ON projects (due_date);
CREATE INDEX IF NOT EXISTS idx_projects_journey_id          ON projects (journey_id);
CREATE INDEX IF NOT EXISTS idx_projects_share_token         ON projects (share_token);

-- project_images: always fetched/deleted by project_id.
CREATE INDEX IF NOT EXISTS idx_project_images_project_id    ON project_images (project_id);

-- creative_assets: heavily queried by project_id, and by (project_id,
-- is_hidden, [client_visible,] sort_order) for the review pages.
CREATE INDEX IF NOT EXISTS idx_creative_assets_project_id             ON creative_assets (project_id);
CREATE INDEX IF NOT EXISTS idx_creative_assets_project_hidden_sort    ON creative_assets (project_id, is_hidden, sort_order);
CREATE INDEX IF NOT EXISTS idx_creative_assets_project_visible_sort   ON creative_assets (project_id, is_hidden, client_visible, sort_order);
CREATE INDEX IF NOT EXISTS idx_creative_assets_drive_file_id          ON creative_assets (drive_file_id);

-- project_comments: filtered by project_id + track, sometimes by asset_id, and
-- always ordered by created_at.
CREATE INDEX IF NOT EXISTS idx_project_comments_project_track_created ON project_comments (project_id, track, created_at);
CREATE INDEX IF NOT EXISTS idx_project_comments_asset_id              ON project_comments (asset_id);

-- journeys: filtered by brand_id + ordered by created_at.
CREATE INDEX IF NOT EXISTS idx_journeys_brand_created                 ON journeys (brand_id, created_at);

-- brands: pipeline page filters pipeline_status, portal looks up by
-- client_token, brands list orders by created_at / client_number.
CREATE INDEX IF NOT EXISTS idx_brands_pipeline_status                 ON brands (pipeline_status);
CREATE INDEX IF NOT EXISTS idx_brands_client_token                    ON brands (client_token);
CREATE INDEX IF NOT EXISTS idx_brands_created_at                      ON brands (created_at);
CREATE INDEX IF NOT EXISTS idx_brands_client_number                   ON brands (client_number);

COMMIT;
