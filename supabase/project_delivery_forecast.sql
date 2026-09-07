-- Project delivery forecast
--
-- Paste this query into Supabase Dashboard > SQL Editor and run it.
-- It counts every project that has not been archived or fully shipped,
-- including overdue projects, through the end of next month.
--
-- Dates use the business timezone rather than the Supabase server's UTC date.
-- Change America/New_York below if the team's operating timezone changes.

WITH date_boundaries AS (
  SELECT
    (now() AT TIME ZONE 'America/New_York')::date AS today,
    (
      date_trunc('month', now() AT TIME ZONE 'America/New_York')
      + interval '1 month'
    )::date AS next_month_start,
    (
      date_trunc('month', now() AT TIME ZONE 'America/New_York')
      + interval '2 months'
    )::date AS month_after_next_start
),
unshipped_projects AS (
  SELECT
    p.id,
    p.due_date,
    COALESCE(p.lp_stage, 'brief') AS lp_stage,
    COALESCE(p.creatives_stage, 'brief') AS creatives_stage
  FROM public.projects AS p
  WHERE p.is_complete IS NOT TRUE
    AND (
      COALESCE(p.lp_stage, 'brief') <> 'live'
      OR COALESCE(p.creatives_stage, 'brief') <> 'live'
    )
)
SELECT
  d.today AS as_of_date,
  (d.month_after_next_start - 1) AS forecast_end_date,

  -- Late and immediate deadlines.
  COUNT(*) FILTER (
    WHERE p.due_date < d.today
  ) AS delayed_projects,
  COUNT(*) FILTER (
    WHERE p.due_date = d.today
  ) AS due_today,
  COUNT(*) FILTER (
    WHERE p.due_date = d.today + 1
  ) AS due_tomorrow,

  -- "Rest of this month" includes today and excludes next month.
  COUNT(*) FILTER (
    WHERE p.due_date >= d.today
      AND p.due_date < d.next_month_start
  ) AS due_rest_of_this_month,
  COUNT(*) FILTER (
    WHERE p.due_date >= d.next_month_start
      AND p.due_date < d.month_after_next_start
  ) AS due_next_month,

  -- Main workload number: overdue + due through the end of next month.
  COUNT(*) FILTER (
    WHERE p.due_date < d.month_after_next_start
  ) AS total_projects_to_ship,

  -- A track at Ready or Live no longer needs production/design work.
  COUNT(*) FILTER (
    WHERE p.due_date < d.month_after_next_start
      AND (
        p.lp_stage NOT IN ('ready', 'live')
        OR p.creatives_stage NOT IN ('ready', 'live')
      )
  ) AS projects_still_needing_design,

  -- Both tracks are finished; at least one has not gone Live yet because
  -- fully-live projects were removed in unshipped_projects above.
  COUNT(*) FILTER (
    WHERE p.due_date < d.month_after_next_start
      AND p.lp_stage IN ('ready', 'live')
      AND p.creatives_stage IN ('ready', 'live')
  ) AS projects_ready_to_ship,

  -- Kept outside total_projects_to_ship because there is no date to place
  -- these projects in the forecast. This prevents hidden workload.
  COUNT(*) FILTER (
    WHERE p.due_date IS NULL
  ) AS unscheduled_unshipped_projects
FROM unshipped_projects AS p
CROSS JOIN date_boundaries AS d
GROUP BY
  d.today,
  d.month_after_next_start;
