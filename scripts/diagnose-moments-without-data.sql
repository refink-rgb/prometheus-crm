-- Why do moments have no results? Read-only: SELECTs only, safe to run any time
-- in the Supabase SQL editor.
--
-- One row per moment whose launch (due_date) is in the last 180 days, with a
-- single `diagnosis` naming the first broken link in the chain:
--   project → lp_tracking enrolment → matched ads → launch date → daily rows.

WITH norm AS (
  SELECT
    p.id            AS project_id,
    p.name          AS moment,
    b.name          AS brand,
    p.due_date,
    p.lp_url        AS project_lp_url,
    p.ad_copy_url,
    b.meta_ad_account_id AS brand_account,
    t.id            AS tracking_id,
    t.lp_url        AS tracked_url,
    t.meta_ad_account_id AS tracked_account,
    t.launched_on,
    t.ended_on,
    t.created_at    AS tracking_started
  FROM projects p
  JOIN brands b ON b.id = p.brand_id
  LEFT JOIN lp_tracking t ON t.project_id = p.id
  WHERE p.due_date BETWEEN current_date - 180 AND current_date
),
matches AS (
  SELECT lp_tracking_id,
         count(*) FILTER (WHERE status = 'included') AS included_ads,
         count(*) FILTER (WHERE status = 'excluded') AS excluded_ads,
         count(*) FILTER (WHERE source = 'manual')   AS manual_ads
  FROM lp_ad_matches GROUP BY 1
),
daily AS (
  SELECT lp_tracking_id,
         count(*)              AS days_with_rows,
         max(stat_date)        AS last_stat_date,
         max(reported_at)      AS last_reported_at,
         sum(spend_cents)/100.0 AS spend
  FROM lp_daily_results GROUP BY 1
)
SELECT
  CASE
    WHEN n.tracking_id IS NULL AND coalesce(n.project_lp_url, '') = '' THEN '1 NOT TRACKED - moment has no LP URL'
    WHEN n.tracking_id IS NULL AND coalesce(n.brand_account, '') = '' THEN '2 NOT TRACKED - brand has no Meta ad account'
    WHEN n.tracking_id IS NULL                                        THEN '3 NOT TRACKED - tracking never started'
    WHEN n.ended_on IS NOT NULL AND coalesce(d.days_with_rows, 0) = 0  THEN '4 ENDED before any data came in'
    WHEN coalesce(m.included_ads, 0) = 0                               THEN '5 NO ADS MATCHED the tracked URL'
    WHEN n.launched_on IS NULL                                         THEN '6 ADS MATCHED, launch date not detected yet'
    WHEN coalesce(d.days_with_rows, 0) = 0                             THEN '7 ADS MATCHED, no daily rows pulled'
    WHEN n.ended_on IS NULL AND d.last_stat_date < current_date - 3    THEN '8 STALE - live but last day is old'
    ELSE '9 OK'
  END AS diagnosis,
  n.brand,
  n.moment,
  n.due_date,
  n.launched_on,
  n.ended_on,
  coalesce(m.included_ads, 0) AS included_ads,
  coalesce(m.excluded_ads, 0) AS excluded_ads,
  coalesce(d.days_with_rows, 0) AS days_with_rows,
  d.last_stat_date,
  d.spend,
  n.tracked_url,
  n.project_lp_url,
  n.ad_copy_url,
  -- Hints: the tracked URL or account disagrees with what the moment/brand says.
  (n.tracked_url IS NOT NULL AND n.ad_copy_url IS NOT NULL AND
     regexp_replace(lower(split_part(n.tracked_url, '?', 1)), '^https?://(www\.)?|/$', '', 'g')
     <> regexp_replace(lower(split_part(n.ad_copy_url, '?', 1)), '^https?://(www\.)?|/$', '', 'g')
  ) AS url_differs_from_ad_copy_url,
  (n.tracked_account IS NOT NULL AND n.brand_account IS NOT NULL AND
     n.tracked_account <> n.brand_account) AS account_differs_from_brand,
  n.tracked_account,
  n.tracking_started
FROM norm n
LEFT JOIN matches m ON m.lp_tracking_id = n.tracking_id
LEFT JOIN daily   d ON d.lp_tracking_id = n.tracking_id
ORDER BY diagnosis, n.brand, n.due_date DESC;

-- Is the engine running at all? Last 15 ingest runs (cron fires every 2h).
-- SELECT run_at, date_range, rows_received, rows_upserted, rows_rejected,
--        warnings->>'write_error' AS write_error
-- FROM campaign_result_ingests ORDER BY run_at DESC LIMIT 15;
