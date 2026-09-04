-- Adds 'revised' to the allowed values on creative_assets.status and
-- .internal_status.
--
-- The full ladder now reads:
--   pending        = nobody has looked at it
--   needs_revision = "fix this and try again"
--   revised        = "the fix is in — look again"     <- new
--   approved       = signed off
--   rejected       = scrap the concept entirely
--
-- 'revised' is written ONLY through updateAssetStatusInternal, i.e. by a
-- signed-in editor. The anonymous share-token path (updateAssetStatus) keeps
-- its four-value union deliberately, so nobody holding a review link can set
-- it. status gets the value anyway so both columns share one TypeScript union.
--
-- Safe to re-run.
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/mhizyjlvqrhwzjqywiwz/sql/new

alter table creative_assets
  drop constraint if exists creative_assets_status_check;

alter table creative_assets
  add constraint creative_assets_status_check
  check (status in ('pending', 'approved', 'needs_revision', 'rejected', 'revised'));

-- internal_status was added straight in the dashboard, so this repo cannot say
-- whether it carries a CHECK at all. Only re-issue one if it is already there:
-- adding a brand-new CHECK to a column that never had one can fail on rows
-- written before anyone was constraining it.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.creative_assets'::regclass
      and conname  = 'creative_assets_internal_status_check'
  ) then
    alter table creative_assets
      drop constraint creative_assets_internal_status_check;
    alter table creative_assets
      add constraint creative_assets_internal_status_check
      check (internal_status in ('pending', 'approved', 'needs_revision', 'rejected', 'revised'));
  end if;
end $$;
