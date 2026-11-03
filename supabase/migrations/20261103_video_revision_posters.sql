-- A revised VIDEO showed the original's picture everywhere.
--
-- Every still in the CRM — the grid tile, the version rows, the player's poster
-- frame — came from posterOf(), which for a video always returned Drive's
-- thumbnail of the ORIGINAL file. Upload a re-cut ad and the new file was
-- stored, published and played correctly, but nothing you could SEE changed:
-- the tile and the frame behind the play button were still the old cut. On the
-- Mad Viking BFCM set (3 Nov) that was a "30% OFF" badge sitting on top of a
-- video that says "UP TO 40% OFF", labelled "Edit 2".
--
-- So a revision now carries its own still. The browser grabs a frame from the
-- file it is uploading; the Drive importer uses that file's own Drive
-- thumbnail. Both are nullable — a capture that fails falls back to Drive's,
-- which is the old behaviour, not a broken image.
alter table creative_assets
  add column if not exists revision_poster_url text;

comment on column creative_assets.revision_poster_url is
  'Still frame of revision_url, for videos. Null = fall back to the Drive poster of the original.';

-- Per-version, so the version stack can show each edit as the frame it actually is.
alter table creative_asset_revisions
  add column if not exists poster_url text;

comment on column creative_asset_revisions.poster_url is
  'Still frame of image_url, for videos. Null for images (image_url is already the picture) and for revisions recorded before 3 Nov 2026.';
