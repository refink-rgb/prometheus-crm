-- Results tracking repair, 2026-11-27. Run ONCE in the Supabase SQL editor,
-- AFTER the ?view= matching fix is deployed (otherwise the engine re-adds the
-- wrong ads on its next run). One transaction: all of it lands or none of it.
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
-- decode; discount-link matches are left alone below).
CREATE FUNCTION pg_temp.norm_lp(u text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN v IS NULL THEN b ELSE b || '?view=' || v END
  FROM (
    SELECT regexp_replace(split_part(split_part(s, '#', 1), '?', 1), '/+$', '') AS b,
           substring(s FROM '[?&]view=([^&#]+)') AS v
    FROM (SELECT regexp_replace(regexp_replace(lower(trim(u)), '^https?://', ''), '^www\.', '') AS s) x
  ) y
$$;

CREATE TEMP TABLE fix_log (step text, brand text, moment text, detail text) ON COMMIT DROP;

-- A. Ad accounts ------------------------------------------------------------
WITH v(name, acct) AS (VALUES
  ('Cat Ladies',      'act_386895569680753'),
  ('Encha',           'act_571528900654455'),
  ('Flav City',       'act_264055765332804'),
  ('FORM BASKETBALL', 'act_1696583091135229'),
  ('Indah Clothing',  'act_10153322111438441'),
  ('Natural Dog',     'act_44401754'),
  ('Roobi',           'act_545299944081354'),
  ('String Swing',    'act_402092893601171'),
  ('Viante',          'act_591553886182213')
), upd AS (
  UPDATE brands b SET meta_ad_account_id = v.acct
  FROM v
  WHERE b.name = v.name AND coalesce(b.meta_ad_account_id, '') = ''
  RETURNING b.name, b.meta_ad_account_id
)
INSERT INTO fix_log SELECT 'A account set', name, NULL, meta_ad_account_id FROM upd;

-- B. Preview URL → live URL ---------------------------------------------------
WITH upd AS (
  UPDATE lp_tracking t SET lp_url = trim(p.lp_url)
  FROM projects p
  WHERE p.id = t.project_id
    AND t.lp_url ILIKE '%shopifypreview.com%'
    AND p.lp_url ~* '^https?://\S+\.\S+'
    AND p.lp_url !~* '(shopifypreview\.com|preview_theme_id|preview_key)'
  RETURNING t.id, t.project_id, t.lp_url
)
INSERT INTO fix_log
SELECT 'B url -> live', b.name, p.name, upd.lp_url
FROM upd JOIN projects p ON p.id = upd.project_id JOIN brands b ON b.id = p.brand_id;

-- C. ?view= collisions --------------------------------------------------------
CREATE TEMP TABLE view_fixed (lp_tracking_id uuid PRIMARY KEY, dropped int) ON COMMIT DROP;

WITH dropped AS (
  DELETE FROM lp_ad_matches m
  USING lp_tracking t
  WHERE m.lp_tracking_id = t.id
    AND t.lp_url ~* '[?&]view='
    AND m.source = 'agent'
    AND m.destination_url IS NOT NULL
    AND m.destination_url !~* '/discount/'
    AND pg_temp.norm_lp(m.destination_url) <> pg_temp.norm_lp(t.lp_url)
  RETURNING m.lp_tracking_id
)
INSERT INTO view_fixed SELECT lp_tracking_id, count(*) FROM dropped GROUP BY 1;

DELETE FROM lp_daily_results d
USING view_fixed f
WHERE d.lp_tracking_id = f.lp_tracking_id AND d.source = 'mcp_agent';

UPDATE lp_tracking t SET launched_on = NULL
FROM view_fixed f
WHERE t.id = f.lp_tracking_id;

INSERT INTO fix_log
SELECT 'C view cleanup', b.name, p.name, f.dropped || ' wrong ads dropped; days re-pull'
FROM view_fixed f
JOIN lp_tracking t ON t.id = f.lp_tracking_id
JOIN projects p ON p.id = t.project_id
JOIN brands b ON b.id = t.brand_id;

-- D. Enroll untracked moments -------------------------------------------------
WITH candidates AS (
  SELECT DISTINCT ON (b.meta_ad_account_id, pg_temp.norm_lp(p.lp_url))
         p.id AS project_id, p.brand_id, b.meta_ad_account_id, trim(p.lp_url) AS lp_url,
         p.name AS moment, b.name AS brand
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
        AND pg_temp.norm_lp(t2.lp_url) = pg_temp.norm_lp(p.lp_url))
  ORDER BY b.meta_ad_account_id, pg_temp.norm_lp(p.lp_url), p.due_date DESC
), ins AS (
  INSERT INTO lp_tracking (project_id, brand_id, meta_ad_account_id, lp_url, launched_on)
  SELECT project_id, brand_id, meta_ad_account_id, lp_url, NULL FROM candidates
  ON CONFLICT (project_id) DO NOTHING
  RETURNING project_id
)
INSERT INTO fix_log
SELECT 'D enrolled', c.brand, c.moment, c.lp_url
FROM ins JOIN candidates c ON c.project_id = ins.project_id;

-- What changed (the editor shows this last result).
SELECT * FROM fix_log ORDER BY step, brand, moment;

COMMIT;
