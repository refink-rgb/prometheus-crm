# Daily Campaign Results — Prometheus CRM

## Context

Prometheus CRM tracks marketing moments from brief to live, but **stores zero
performance metrics**. Today the only way a result enters the system is a human
typing revenue/ROAS/CTR by hand into `MomentReportForm` at case-study generation
time. Nobody can answer "how is the campaign we launched Tuesday actually doing"
without opening Ads Manager per client.

This adds a **Results tab**: every campaign we've launched that is still live,
with one row per day from launch through the last update, refreshed once a day.

Decisions made with Giovane before planning:

| Decision | Choice |
|---|---|
| Where | A `/results` tab inside Prometheus CRM (not a new app) |
| Ingestion | A **scheduled Claude agent** using the Meta MCP in the other Claude account, POSTing to a token-authed endpoint |
| Grain | One row per **campaign per day** |
| Metrics | spend, revenue (total), incremental revenue, purchases, ROAS (total), CPA, unique outbound CTR, LP conversion |
| Campaign→moment link | **Manual**, set on the project |
| Incremental revenue | Read **as reported** from the ad account's existing "Incremental Revenue" column — never derived, never estimated |

### Two facts that shape the design

1. **Meta restates numbers after the fact.** Attribution backfills for days
   after the event, so Tuesday's ROAS changes next week. Every write is an
   **upsert on `(tracked_campaign, stat_date)`** — never append-once — and the
   agent re-pulls a trailing window rather than only yesterday.
2. **The ingestion path is an LLM.** That is the chosen tradeoff (it reuses
   access we already have), but it means bad data arrives *plausibly formatted*.
   So: an arithmetic validation layer, a per-row warning surfaced in the UI, an
   ingest audit log, and a staleness indicator. This mirrors the existing
   `findUnverifiedNumbers()` philosophy in `src/lib/ai/approval-message.ts:142`
   — **report to a human, don't silently block or silently accept**.

---

## Schema

New migration `supabase/migrations/20260805_add_campaign_results.sql`
(**hand-run by Giovane in the Supabase SQL editor**, per repo convention — see
`PROJECT_CONTEXT.md`). RLS: `FOR ALL TO authenticated` like
`20260727_add_marketing_reports.sql`; the ingest endpoint writes via the service
role.

**`tracked_campaigns`** — the manual link, one row per campaign we watch.
- `project_id` → `projects(id)` ON DELETE CASCADE; `brand_id` → `brands(id)`
- `meta_ad_account_id` (`act_…`), `meta_campaign_id`, `campaign_name` (display snapshot)
- `launched_on` DATE NOT NULL — the "from" date; `ended_on` DATE NULL — **NULL means live** (the Results tab's filter)
- `created_at`, `created_by`
- `UNIQUE (meta_ad_account_id, meta_campaign_id)`

**`campaign_daily_results`** — one row per campaign per day.
- `tracked_campaign_id` → CASCADE, `stat_date` DATE
- **`UNIQUE (tracked_campaign_id, stat_date)`** ← the upsert key; this is the restatement fix
- Money as **INTEGER CENTS** (`spend_cents`, `revenue_cents`,
  `incremental_revenue_cents` NULL-able, `cpa_cents`) — matches the precedent
  deliberately set in `src/lib/billing.ts`, avoids float drift when summing
- `purchases` INT, `landing_page_views` INT (stored so LP conversion is auditable, not just asserted)
- `roas`, `unique_outbound_ctr`, `lp_conversion_rate` NUMERIC — **percentages stored as percent** (2.4500 = 2.45%); document this on the column, it is the classic silent bug
- `attribution_window` TEXT DEFAULT `'7d_click'` — pinned so a later window change is visible rather than a mystery step in the chart
- `source` TEXT `'mcp_agent' | 'manual'` — **a `manual` row is never overwritten by the agent** (that's the repair path)
- `warnings` TEXT[] — validation flags, rendered as a badge
- `reported_at` TIMESTAMPTZ — when the agent pulled it (distinct from `stat_date`; matters under restatement)

**`campaign_result_ingests`** — audit trail: `run_at`, `date_range`,
`rows_received`, `rows_upserted`, `rows_rejected`, `warnings` JSONB. Small table,
high value when the agent quietly starts returning garbage.

---

## Ingest endpoint

`src/app/api/results/ingest/route.ts` — mirrors the auth pattern at
`src/app/api/cron/daily/route.ts:283`:
`Authorization: Bearer ${RESULTS_INGEST_SECRET}`, service-role client,
`runtime = 'nodejs'`.

Add `'/api/results'` to `PUBLIC_PREFIXES` in `src/middleware.ts:8` (same
allowance `/api/cron` already has) so the agent can POST without a session cookie.

- **`GET`** → the work list: every live `tracked_campaign` plus the date range it
  needs (`launched_on` → yesterday on first sight; trailing 7 days otherwise).
  This is what keeps the agent prompt stable — the CRM decides what to fetch, the
  agent doesn't have to remember.
- **`POST`** → `{ reported_at, rows: [...] }`, upserted on the unique key.

Validation lives in **`src/lib/results/validate.ts`** — pure and testable, no DB:
- unknown `(ad_account_id, campaign_id)` → **reject the row and report it**; the
  manual link is the contract, ingestion must not invent campaigns
- `stat_date` outside `launched_on … easternToday()` → reject
- arithmetic cross-checks within tolerance: `roas ≈ revenue/spend`,
  `cpa ≈ spend/purchases`, `lp_conversion ≈ purchases/landing_page_views`
- implausible values (negative spend, ROAS > 100) → flag
- Cross-check failures **store the row with a warning**, they don't drop it — a
  dropped row looks identical to "the campaign didn't run".

---

## The scheduled agent (other Claude account)

A daily scheduled task, ~7am Eastern, with a fixed prompt:

1. `GET /api/results/ingest` → work list.
2. For each campaign, pull the daily breakdown from the Meta MCP for the given
   window, at the **7-day-click** attribution window.
3. `POST` the rows **verbatim**. Standing rule in the prompt: *report only what
   the tool returned; if a metric is unavailable send `null`; never estimate,
   interpolate, or round to something that looks better.*
4. Re-pull the **trailing 7 days** daily, plus a **full re-pull weekly**, to
   absorb Meta's restatements.
5. Report the response's rejected rows and warnings back in the run output.

`incremental_revenue` comes straight from the ad account's existing "Incremental
Revenue" column; when an account doesn't have that column configured the agent
sends `null` and the UI renders `—` (the same never-invent rule the marketing
report already follows).

---

## UI

**Sidebar** — new `/results` entry in `src/components/Sidebar.tsx`, placed after
Insights, gated by the same `canEdit()` the other tabs use.

**`src/app/(app)/results/page.tsx`** (server component, matching the
server-components-first architecture — no `useEffect(fetch)`):
- Header tiles across all live campaigns for the selected window: spend, revenue,
  ROAS, purchases.
- One card per live campaign: brand · moment name · campaign name · days live ·
  latest-day metrics · cumulative since launch · a small revenue/spend sparkline.
- **Freshness stamp per campaign** ("updated 6:58am · data through Aug 4"),
  tinted amber past ~36h. Non-negotiable for an LLM-fed pipeline — a stale
  dashboard that looks fresh is worse than an empty one.

**`src/app/(app)/results/[trackedCampaignId]/page.tsx`** — the literal ask: the
full daily table, launch date → last update, one row per day, all eight metrics,
plus day-over-day charts. Warning badges inline; a manual override on a row sets
`source='manual'` so the agent stops overwriting it.

Charts: **Recharts** (already a dependency, `recharts@3.9.1`) for the time
series, using the existing `--viz-*` tokens in `src/app/globals.css:118` so light
and dark both work. Follow `InsightsCharts.tsx` for token usage.

**Linking (on the project, per the decision):** a "Campaign tracking" panel on
`src/app/(app)/brands/[brandId]/projects/[projectId]/page.tsx` — ad account ID,
campaign ID, launch date, and an "end tracking" control. ~10 seconds per moment.

**`src/lib/results-actions.ts`** — `linkCampaign`, `unlinkCampaign`,
`endCampaignTracking`, `overrideDailyRow`. All gated by `canEdit()`, following
`src/lib/offer-actions.ts` / `src/lib/billing-actions.ts`.

**`src/lib/results.ts`** — pure rollup/derivation math (cumulative totals,
day-over-day deltas, freshness, cents↔display formatting). No `new Date()` for
calendar logic; callers pass `easternToday()` from `src/lib/eastern.ts`, exactly
as `billing.ts` does.

---

## Explicitly out of scope for v1

- **Auto-filling the marketing report** from cumulative results (replacing the
  hand-typed metrics in `MomentReportForm`). This is the biggest downstream
  payoff and the reason to build this at all — but it's a second change, once
  the numbers have proven themselves for a few weeks.
- **Ad-level rows** (which creative won). Deliberately deferred: ~30–50× the rows
  and API load. The schema doesn't block it — a future `ad_daily_results` hangs
  off `tracked_campaigns` the same way.
- **AI narrative / "positive spin" on results.** Raw numbers land immutably
  first. Any generated commentary is a separate layer with a
  `findUnverifiedNumbers`-style guard over it, so a persuasive sentence can never
  quietly introduce a figure that isn't in the table.

---

## Verification

Local rendering is blocked — the repo's `.env.local` holds **dummy** Supabase
credentials, so app routes can't render locally (`PROJECT_CONTEXT.md`; the same
constraint hit the billing and timeline work). So:

1. `scripts/verify-results.ts` — standalone checks, no test framework, run with
   `node --experimental-strip-types scripts/verify-results.ts`, following
   `scripts/verify-billing.ts`. Asserts: upsert idempotency (same day twice → one
   row, second wins), restatement (a re-pull with different numbers updates in
   place), each validator rule, cents↔display round-trips, cumulative and
   day-over-day math against a hand-checked fixture.
   `scripts` is already in the tsconfig `exclude` list, so this won't break
   `next build`.
2. `npx tsc --noEmit` and `npm run build` clean. (Pre-existing lint errors in
   `InternalReviewPanel.tsx` and `KanbanView.tsx` are unrelated.)
3. Giovane hand-runs the migration in the Supabase SQL editor and sets
   `RESULTS_INGEST_SECRET` in Vercel.
4. End-to-end on prod: link one real live campaign → `curl` the `GET` work list
   → `curl` a `POST` with a couple of hand-written days → confirm the Results tab
   renders them → re-POST the same dates with changed numbers → confirm it
   updates in place rather than duplicating.
5. Only then point the scheduled Claude agent at it, and check the first three
   daily runs against Ads Manager by eye before trusting the tab.

## Build order

1. Migration + `src/lib/results.ts` + `validate.ts` + verify script (no UI).
2. Ingest endpoint + middleware prefix + env var; prove it with `curl`.
3. Linking panel on the project page + `results-actions.ts`.
4. `/results` tab and the per-campaign daily view.
5. Hand off the agent prompt; watch three runs.
