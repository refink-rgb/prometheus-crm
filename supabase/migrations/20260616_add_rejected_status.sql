-- Adds 'rejected' to the allowed values on creative_assets.status.
-- This is a separate, stronger client decision than 'needs_revision':
--   needs_revision = "fix this and try again"
--   rejected       = "scrap this concept entirely"
--
-- Safe to re-run.
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/mhizyjlvqrhwzjqywiwz/sql/new

alter table creative_assets
  drop constraint if exists creative_assets_status_check;

alter table creative_assets
  add constraint creative_assets_status_check
  check (status in ('pending', 'approved', 'needs_revision', 'rejected'));
