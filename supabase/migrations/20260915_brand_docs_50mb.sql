-- Raise the brand-docs upload ceiling from 40MB to 50MB.
--
-- Brand books run 5-50MB and 40MB was turning real ones away. The bucket's
-- file_size_limit is the enforced ceiling; src/lib/brand-docs.ts
-- MAX_BRAND_DOC_BYTES must match it so the browser rejects early and honestly.
--
-- ALREADY APPLIED to production on 15 Sep via the Storage API (service role),
-- and verified: a 49.5MB upload succeeds, a 50.5MB upload is refused. This file
-- exists so the repo matches the database. 20260906 was updated in step, since
-- it upserts this value and a re-run would otherwise put it back to 40MB.
--
-- Safe to re-run.

update storage.buckets
set file_size_limit = 52428800
where id = 'brand-docs';
