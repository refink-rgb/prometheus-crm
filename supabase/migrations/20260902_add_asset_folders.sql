-- Project-level asset folders.
--
-- The Products card already holds a link PER PRODUCT — its page, and its HQ
-- assets. What it had no room for is the folder that covers the whole job: the
-- client's Air workspace, a Cloudinary collection, the Drive folder of raw
-- photography, the brand's font pack.
--
-- Those existed as exactly one column, projects.product_images_link (7 of 66),
-- rendered read-only at the foot of the card and editable only from the project
-- edit form. Real projects have several, so it was a list pretending to be a
-- single field.
--
-- JSONB array of { id, label, url }, same shape and same reasoning as products
-- and competitors: the read path already normalises those, and a third child
-- table for a handful of links per project would be two joins for nothing.
--
-- product_images_link is NOT dropped. It is still written by the edit form and
-- still read by the creative bundle API, and the card renders it alongside these
-- until that is migrated separately.

BEGIN;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS asset_folders JSONB;

-- Array-ness only. Element shape is validated in lib/products.ts on the way in
-- and on the way out, where a 'javascript:...' can actually be caught before it
-- reaches an href.
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_asset_folders_is_array;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_asset_folders_is_array
  CHECK (asset_folders IS NULL OR jsonb_typeof(asset_folders) = 'array');

-- No backfill. product_images_link keeps rendering in its own right; copying it
-- in would show the same link twice on the 7 projects that have one.

COMMIT;

-- VERIFY:
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name='projects' AND column_name='asset_folders';
