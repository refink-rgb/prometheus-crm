-- Product groups, and splitting Motion reports into ours vs theirs.
--
-- 1. GROUPS. A brief rarely names a flat list of products — it names bundles or
--    tiers, each holding several SKUs ("Bundle 1: tube + rope", "Tier 2"). The
--    products column stored a flat array, so that structure lived only in the
--    prose of offer_description and an editor rebuilt it in their head every
--    time.
--
--    Stored as a `group` STRING ON EACH PRODUCT, not as nested arrays. Three
--    reasons: the 179 rows already backfilled stay valid untouched (no group =
--    ungrouped, which is exactly what they are); moving a product between
--    groups is a one-field edit rather than a splice across two arrays; and
--    grouping stays a render-time concern, so a typo in a group name can never
--    orphan a product the way a broken nested structure would.
--
--    No DDL needed for it — `products` is already JSONB and the element shape is
--    validated in lib/products.ts, not in Postgres. This file exists for the
--    second change, and documents the first so the decision is not invisible.
--
-- 2. TOP PERFORMERS. motion_link is ONE url and 20260713 describes it as the
--    project's own board. What is actually wanted is the CLIENT's top-performing
--    creative — plural, and a different thing from a competitor's report, which
--    is why they cannot share the competitors column. Mixing them would put our
--    own client in a list headed "Competitors".
--
--    Same shape as competitors so one editor component serves both:
--      top_performers[] { id, name, motion_url, link }
--
--    motion_link is NOT migrated into it and NOT dropped. It is a single field
--    on a different concept (the project's working board) and the live page's
--    deliverable form still writes it.

BEGIN;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS top_performers JSONB;

-- Array-ness only, for the same reason as products and competitors: every
-- consumer calls .map(), so a non-array crashes the page, and per-element shape
-- cannot usefully be checked here — 'javascript:...' passes any shape check.
-- Element validation lives in lib/products.ts where the href is actually built.
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_top_performers_is_array;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_top_performers_is_array
  CHECK (top_performers IS NULL OR jsonb_typeof(top_performers) = 'array');

-- No backfill. Top performers are pasted from Motion per project.

COMMIT;

-- VERIFY:
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name='projects' AND column_name='top_performers';
--   -- one row, jsonb.
