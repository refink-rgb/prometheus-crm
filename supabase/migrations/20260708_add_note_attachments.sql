BEGIN;

-- Freeform image attachments for internal / client notes. Stored as an array of
-- Supabase storage URLs so a single note can carry multiple images without
-- needing a separate table. `asset_id` on project_comments already exists but
-- FKs to creative_assets and is used for pin-annotations on creative reviews —
-- reusing it here would confuse both flows.
ALTER TABLE project_comments
  ADD COLUMN IF NOT EXISTS attachment_urls JSONB;

COMMIT;
