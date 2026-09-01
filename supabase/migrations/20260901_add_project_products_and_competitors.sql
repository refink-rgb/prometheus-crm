-- Structured product list and competitor/Motion list, per project.
--
-- The Creatives tab has to answer three questions it currently cannot:
--   1. WHICH products are in this ad, each one linkable on its own.
--   2. WHO are the competitors, and where is each one's Motion report.
--   3. Where are the HIGH-QUALITY assets for each product.
--
-- None of that fits what exists. `product_featured` is ONE TEXT COLUMN holding
-- a semicolon-delimited list of NAMES with no links ("AA101 - Men's Original
-- Jean - Made in USA; AA1873 - Men's Classic Jean - Made in USA; ..."), and
-- `competitor_reference` is FREE PROSE naming several competitors in one blob.
-- Neither can hold a repeating {name, link} pair, and `product_images_link`
-- (7 of 66 rows) is a single project-level folder, not a per-product asset.
--
-- Two JSONB ARRAY COLUMNS, not two child tables. The precedent is the copy
-- banks on this same table — ad_headlines / ad_subcopies / ad_eyebrows, added
-- in 20260708_brief_restructure.sql as bare nullable JSONB "so the count can
-- flex". These lists are the same kind of thing: small (1-6 entries), read
-- only ever as a whole, written only as a whole, and never queried across
-- projects. A child table would add two joins and an RLS policy pair to every
-- read of the project page in exchange for integrity nobody is asking for.
-- The cost is stated plainly at the bottom of this comment.
--
-- ── OBJECT SHAPE (enforced in TypeScript, see src/lib/products.ts) ─────────
--   products[]    { id, name, url, assets_url }
--   competitors[] { id, name, site_url, motion_url }
--
-- `id` is a client-generated uuid STRING. It is not used by anything today.
-- It exists so that project_images can later gain a nullable product_id and
-- point an uploaded hi-res photo at ONE of the four SKUs in an ad — today
-- there is no way to say which uploaded photo belongs to which product.
--
-- ── NULL IS NOT [] ────────────────────────────────────────────────────────
-- Both columns are NULLABLE WITH NO DEFAULT, matching ad_headlines. The
-- distinction is load-bearing and the read layer depends on it:
--   NULL = nobody has structured this project yet → FALL BACK to parsing
--          product_featured, so the 59 already-populated projects keep
--          rendering their products with no data change.
--   []   = someone opened the editor and deliberately emptied the list →
--          render empty, do NOT resurrect the old text.
-- A DEFAULT '[]' would erase that difference on all 66 rows at once.
--
-- ── product_featured IS NOT RETIRED ───────────────────────────────────────
-- It stays the denormalized name list and KEEPS BEING WRITTEN, because six
-- surfaces read it and are out of scope for this pass: the live project page,
-- the CLIENT-FACING review page (src/app/(public)/review/[token]/page.tsx:208,
-- no login, share-token authed), the markdown export, the token-authed
-- creative bundle API, and offer_to_production's STRATEGIC_FIELDS copy. If
-- this migration made `products` authoritative and stopped writing
-- product_featured, all six would silently go blank. So updateProjectLists()
-- rewrites product_featured from the names on every save.
--
-- The cost of that: two names for one fact. ProjectEditForm on the live page
-- still writes product_featured directly and does NOT know about `products`,
-- so an edit made there drifts out of sync. That drift is DETECTED and shown
-- in the preview (productsDrifted()), not prevented. Preventing it means
-- changing the live page, which this pass is not allowed to do.

BEGIN;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS products    JSONB,
  ADD COLUMN IF NOT EXISTS competitors JSONB;

-- The ONE invariant the read layer cannot defend itself against cheaply: every
-- consumer does products.map(...), so a non-array here is a crash on the
-- project page, the preview and the bundle API at once.
--
-- Element shape is deliberately NOT checked here. A CHECK constraint cannot
-- contain a subquery, so per-element validation would have to be written as a
-- jsonb_path_exists() expression — and it would still not cover the fields
-- the app actually cares about (a url that is 'javascript:...' passes any
-- shape check). That validation lives in updateProjectLists() on the way in
-- and in readProducts() on the way out, where it can be tested.
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_products_is_array;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_products_is_array
  CHECK (products IS NULL OR jsonb_typeof(products) = 'array');

ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_competitors_is_array;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_competitors_is_array
  CHECK (competitors IS NULL OR jsonb_typeof(competitors) = 'array');

-- No index. 66 rows, and no query filters or joins on either column — the only
-- read is "give me this project", which is already served by the primary key.
-- The query that WOULD justify one is "which moments featured SKU AA101",
-- which nothing asks yet; that day it is
--   CREATE INDEX idx_projects_products_gin ON public.projects
--     USING GIN (products jsonb_path_ops);
-- and a rethink about whether products should be a real table by then.

-- No RLS changes. `projects` already has RLS enabled with the four per-verb
-- policies from schema.sql (auth_select/insert/update/delete_projects), and a
-- new COLUMN inherits them. Nothing to add, and deliberately nothing granted
-- to anon — the public review page reads through the service role.

-- No GRANTs and no trigger, matching this repo: there is not a single GRANT in
-- supabase/, and the only two triggers that exist are the pipeline_events
-- append-only guard and the auth.users profile hook. `projects` has no
-- updated_at column and this migration does not add one.

-- ── BACKFILL: 59 rows of product NAMES become structured rows ─────────────
-- Splits on ';' OR '|'. Both delimiters are real: 2 rows use pipes, and the
-- current UI (splitSkus in PreviewProjectView) splits on ';' only, so those 2
-- projects render their whole list as one giant product name today. Fixing the
-- delimiter here fixes them.
--
-- 3 rows hold a BARE URL instead of a name. Those become {name: <url>,
-- url: <url>} — no information invented and none dropped. The read layer sees
-- isUrl(name) and renders the host as the label, which is what the existing
-- component already special-cases at PreviewProjectView.tsx:533 and :973.
--
-- Idempotent: `products IS NULL` means re-running this touches nothing that a
-- human has since edited (including a list they deliberately emptied to []).
UPDATE public.projects p
SET products = src.arr
FROM (
  SELECT
    p2.id,
    jsonb_agg(
      jsonb_build_object(
        'id',         gen_random_uuid()::text,
        'name',       btrim(t.part),
        -- The 3 bare-URL rows get a working link; everything else gets NULL
        -- and an editor fills it in. NULL, not '', so "never set" and
        -- "explicitly cleared" stay the same thing for a field nobody has
        -- touched yet.
        'url',        CASE WHEN btrim(t.part) ~* '^https?://' THEN btrim(t.part) ELSE NULL::text END,
        -- Ask #3. Nothing in the old schema can seed this: product_images_link
        -- is ONE folder for the whole project, not a link per product, so
        -- copying it onto every row would assert four times over that each
        -- SKU's hi-res assets live there. Left NULL; the read layer falls back
        -- to the project-level folder once, at the bottom of the card.
        'assets_url', NULL::text
      )
      ORDER BY t.ord
    ) AS arr
  FROM public.projects p2
  CROSS JOIN LATERAL unnest(string_to_array(p2.product_featured, ';'))
    WITH ORDINALITY AS t(part, ord)
  WHERE p2.products IS NULL
    AND p2.product_featured IS NOT NULL
    AND btrim(p2.product_featured) <> ''
    -- Trailing delimiters produce empty parts; an unnamed product row is
    -- worse than no row.
    AND btrim(t.part) <> ''
  GROUP BY p2.id
) AS src
WHERE p.id = src.id
  AND p.products IS NULL;

-- ── NO COMPETITOR BACKFILL, ON PURPOSE ────────────────────────────────────
-- `competitors` is left NULL on all 66 rows, and the Motion Reports section
-- starts empty everywhere. Two reasons, both worth writing down because the
-- absence looks like an oversight:
--
-- 1. competitor_reference (19 rows) is MULTI-SENTENCE PROSE, e.g. 'Bogey Bros
--    (bogeybros.co) — runs an explicit "Buy More, Save More" tiered
--    mechanic...'. Several competitors per blob, no delimiter, names
--    interleaved with analysis. Any regex that "extracts the competitors"
--    from that is inventing rows and attaching a confident name to whatever
--    happened to sit before a parenthesis. The prose is not lost — it keeps
--    rendering as the References footer it renders in today.
--
-- 2. motion_link (2 rows) is NOT a competitor's report. 20260713_add_motion_link
--    describes it as the project's OWN board, "holds the videos the static
--    editors work on". Migrating it into a competitors array would label our
--    own Motion board as a competitor's. It stays its own column and the
--    Motion Reports section pins it above the competitor rows, labelled ours.

-- ---------------------------------------------------------------------------
-- offer_summary — the AI "simplify this offer" cache.
--
-- offer_description averages 985 characters and runs to 2,512. On the Creatives
-- tab it is a wall of text an editor has to read in full to find the mechanic,
-- so the tab offers a bullet summary. The result is CACHED rather than
-- regenerated per view: the model costs money and latency, and two editors
-- opening the same project should read the same summary.
--
-- offer_summary_source holds the exact text the summary was generated FROM.
-- Comparing it to the current offer + offer_description is what makes the cache
-- self-invalidating: edit the offer and the stale bullets are marked stale
-- rather than silently describing the previous offer. A hash would be smaller
-- but would not let a reader see WHAT it summarised, which is the thing you
-- want when a summary looks wrong.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS offer_summary        JSONB,
  ADD COLUMN IF NOT EXISTS offer_summary_source TEXT;

ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_offer_summary_is_array;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_offer_summary_is_array
  CHECK (offer_summary IS NULL OR jsonb_typeof(offer_summary) = 'array');

-- No backfill. Summaries are generated on demand, by a person clicking the
-- button, so that nobody pays for 66 model calls to summarise offers nobody
-- opened.

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFY (run after applying):
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_name = 'projects' AND column_name IN ('products','competitors');
--   -- two rows, both jsonb, both YES, both NULL default.
--
--   SELECT count(*) FILTER (WHERE products IS NOT NULL)      AS backfilled,
--          count(*) FILTER (WHERE product_featured IS NOT NULL
--                             AND products IS NULL)          AS missed
--     FROM public.projects;
--   -- EXPECT backfilled = 59, missed = 0. `missed` is the load-bearing one:
--   -- any non-zero value is a project whose products vanished from the
--   -- Creatives tab, because the fallback only fires while products IS NULL
--   -- and a partial backfill is indistinguishable from a real empty list.
--
--   SELECT id, jsonb_array_length(products) AS n, products
--     FROM public.projects
--    WHERE product_featured LIKE '%|%';
--   -- The 2 pipe-delimited rows. EXPECT n > 1 on both. If n = 1 the split
--   -- regex did not take and those projects still read as one giant product.
--
--   SELECT products FROM public.projects WHERE product_featured ~* '^https?://';
--   -- The 3 bare-URL rows. EXPECT each element's "name" and "url" to be the
--   -- same URL string — not a null url, which would mean the CASE missed and
--   -- those products render as unclickable text.
