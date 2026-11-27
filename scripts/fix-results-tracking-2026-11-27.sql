-- Results tracking repair, 2026-11-27. Run in the Supabase SQL editor AFTER
-- the ?view= matching fix (a123bb8) is deployed — otherwise the engine re-adds
-- the wrong ads on its next run.
--
-- No temp tables: the SQL editor doesn't keep them alive between statements.
-- Every statement stands alone and is safe to re-run (a second run finds
-- nothing left to change).
--
--   A. Wire Meta ad accounts on 9 brands that had none (ids read from the
--      token's /me/adaccounts listing on 2026-11-27, matched by name).
--   B. Point trackings at the live URL where they track a shopifypreview link
--      but the moment has the live one (Leaf Shave — Leaf Two Step-Up).
--   C. ?view= collisions: trackings whose URL names a ?view= template were
--      matching every ad on the bare path (Hey Mila's four moments shared one
--      98-ad pool; Mikokos Sr. Romero pulled the product page back to March).
--      Drop those wrongly matched ads, clear the polluted daily rows and the
--      launch date detected from them, so the engine re-pulls them clean.
--      Manual matches and manual daily rows are never touched.
--   D. Enroll every recent moment that has a live LP URL and an ad account
--      but no tracking yet, with launch date left to auto-detect.

BEGIN;

-- Mirror of normalizeLpUrl() in src/lib/results.ts (minus the discount-link
-- decode; discount-link matches are left alone below). Kept as a real
-- function — handy for ad-hoc diagnostics too.
CREATE OR REPLACE FUNCTION public.norm_lp_url(u text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN v IS NULL THEN b ELSE b || '?view=' || v END
  FROM (
    SELECT regexp_replace(split_part(split_part(s, '#', 1), '?', 1), '/+$', '') AS b,
           substring(s FROM '[?&]view=([^&#]+)') AS v
    FROM (SELECT regexp_replace(regexp_replace(lower(trim(u)), '^https?://', ''), '^www\.', '') AS s) x
  ) y
$$;

-- A. Ad accounts ------------------------------------------------------------
UPDATE brands b SET meta_ad_account_id = v.acct
FROM (VALUES
  ('Cat Ladies',      'act_386895569680753'),
  ('Encha',           'act_571528900654455'),
  ('Flav City',       'act_264055765332804'),
  ('FORM BASKETBALL', 'act_1696583091135229'),
  ('Indah Clothing',  'act_10153322111438441'),
  ('Natural Dog',     'act_44401754'),
  ('Roobi',           'act_545299944081354'),
  ('String Swing',    'act_402092893601171'),
  ('Viante',          'act_591553886182213')
) AS v(name, acct)
WHERE b.name = v.name AND coalesce(b.meta_ad_account_id, '') = '';

-- B. Preview URL → live URL ---------------------------------------------------
UPDATE lp_tracking t SET lp_url = trim(p.lp_url)
FROM projects p
WHERE p.id = t.project_id
  AND t.lp_url ILIKE '%shopifypreview.com%'
  AND p.lp_url ~* '^https?://\S+\.\S+'
  AND p.lp_url !~* '(shopifypreview\.com|preview_theme_id|preview_key)';

-- C. ?view= collisions (one statement: the three writes share one set) --------
WITH dropped AS (
  DELETE FROM lp_ad_matches m
  USING lp_tracking t
  WHERE m.lp_tracking_id = t.id
    AND t.lp_url ~* '[?&]view='
    AND m.source = 'agent'
    AND m.destination_url IS NOT NULL
    AND m.destination_url !~* '/discount/'
    AND public.norm_lp_url(m.destination_url) <> public.norm_lp_url(t.lp_url)
  RETURNING m.lp_tracking_id
), fixed AS (
  SELECT DISTINCT lp_tracking_id FROM dropped
), cleared_days AS (
  DELETE FROM lp_daily_results d
  USING fixed f
  WHERE d.lp_tracking_id = f.lp_tracking_id AND d.source = 'mcp_agent'
  RETURNING d.lp_tracking_id
)
UPDATE lp_tracking t SET launched_on = NULL
FROM fixed f
WHERE t.id = f.lp_tracking_id;

-- D. Enroll untracked moments (runs after A, so newly wired brands count) -----
INSERT INTO lp_tracking (project_id, brand_id, meta_ad_account_id, lp_url, launched_on)
SELECT DISTINCT ON (b.meta_ad_account_id, public.norm_lp_url(p.lp_url))
       p.id, p.brand_id, b.meta_ad_account_id, trim(p.lp_url), NULL::date
FROM projects p
JOIN brands b ON b.id = p.brand_id
WHERE p.due_date BETWEEN current_date - 180 AND current_date
  AND b.is_active
  AND coalesce(b.meta_ad_account_id, '') <> ''
  AND p.lp_url ~* '^https?://\S+\.\S+'
  AND p.lp_url !~* '(shopifypreview\.com|preview_theme_id|preview_key|example\.com|dev-test)'
  AND NOT EXISTS (SELECT 1 FROM lp_tracking t WHERE t.project_id = p.id)
  -- never two trackings on one page in one account: they'd double-count
  AND NOT EXISTS (
    SELECT 1 FROM lp_tracking t2
    WHERE t2.meta_ad_account_id = b.meta_ad_account_id
      AND public.norm_lp_url(t2.lp_url) = public.norm_lp_url(p.lp_url))
ORDER BY b.meta_ad_account_id, public.norm_lp_url(p.lp_url), p.due_date DESC
ON CONFLICT (project_id) DO NOTHING;

COMMIT;

-- Report (the editor shows this last result) ----------------------------------
SELECT 'A account' AS step, b.name AS brand, NULL::text AS moment, b.meta_ad_account_id AS detail
FROM brands b
WHERE b.name IN ('Cat Ladies','Encha','Flav City','FORM BASKETBALL','Indah Clothing',
                 'Natural Dog','Roobi','String Swing','Viante')
UNION ALL
SELECT 'C ?view= tracking', b.name, p.name,
       (SELECT count(*) FROM lp_ad_matches m WHERE m.lp_tracking_id = t.id AND m.status = 'included')
         || ' ads kept · launch ' || coalesce(t.launched_on::text, 're-detecting')
FROM lp_tracking t JOIN projects p ON p.id = t.project_id JOIN brands b ON b.id = t.brand_id
WHERE t.lp_url ~* '[?&]view='
UNION ALL
SELECT 'D enrolled', b.name, p.name, t.lp_url
FROM lp_tracking t JOIN projects p ON p.id = t.project_id JOIN brands b ON b.id = t.brand_id
WHERE t.created_by IS NULL AND t.created_at > now() - interval '30 minutes'
ORDER BY 1, 2, 3;
