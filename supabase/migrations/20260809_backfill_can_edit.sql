-- Backfill profiles.can_edit before canEdit() switches over to reading it.
--
-- The 20260715 migration seeded can_edit=TRUE for the 9 people who were in
-- ALLOWED_EDITORS (src/lib/permissions.ts) at the time. Since then 4 more
-- were added to the array by hand (commits after 20260715) without anyone
-- touching profiles.can_edit. Run this BEFORE deploying the code change that
-- makes canEdit() read profiles.can_edit instead of the array, or these 4
-- people lose access the moment it ships.

BEGIN;

UPDATE public.profiles SET can_edit = TRUE
WHERE lower(email) IN (
  'omkar@commonthreadglobal.com',
  'vinicius@commonthreadglobal.com',
  'oksana@commonthreadco.com',
  'petert@commonthreadco.com'
);

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFY (run after; should match today's ALLOWED_EDITORS exactly — 13 people)
-- ---------------------------------------------------------------------------
--
--   SELECT count(*) FROM public.profiles WHERE can_edit;  -- expect 13
--
--   -- Anyone in the old array whose profile row doesn't exist yet (never
--   -- logged in, so the auth trigger never fired) — MUST be empty, otherwise
--   -- that person still has no way in after the code switches over:
--   SELECT e FROM unnest(ARRAY[
--     'roberto@commonthreadglobal.com','lucas@commonthreadglobal.com',
--     'jan@commonthreadglobal.com','joy@commonthreadglobal.com',
--     'giovane@commonthreadglobal.com','aleksandrs@commonthreadglobal.com',
--     'ferran@commonthreadglobal.com','jaspen@commonthreadglobal.com',
--     'janella@commonthreadglobal.com','omkar@commonthreadglobal.com',
--     'vinicius@commonthreadglobal.com','oksana@commonthreadco.com',
--     'petert@commonthreadco.com'
--   ]) e
--   WHERE NOT EXISTS (SELECT 1 FROM public.profiles WHERE lower(email) = e);
