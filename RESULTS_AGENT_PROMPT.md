# Daily campaign results — scheduled agent

Everything needed to stand up the ingestion side of the Results tab. The CRM
side is built and deployed; this is the handoff.

---

## What Giovane has to do first

These three are manual and nothing works until they're done.

### 1. Run the migrations

**Two files, in order:**

1. `supabase/migrations/20260805_add_campaign_results.sql` — the three tables
2. `supabase/migrations/20260805_add_adset_tracking.sql` — ad-set level tracking

(Repo convention — migrations are hand-run, see `PROJECT_CONTEXT.md`.) Until
the first lands, `/results` shows a "tables don't exist yet" notice rather than
a broken page.

**Why the second one exists.** The original design assumed one Meta campaign per
marketing moment. That's true for some clients but not all: Noble runs every
moment as an **ad set** inside one evergreen campaign
(`CTC - ACQ - Marketing Moments`, campaign `6987812298183`), which holds five
moments at once. Tracking that campaign as a single moment would have reported
$2,700 of spend against a moment that actually spent $1,304, starting two months
before that moment existed — every number real, the label wrong. So a tracked
row now names an optional ad set.

Verify at the bottom of that file. The one that matters:

```sql
SELECT indexname FROM pg_indexes WHERE indexname = 'uq_campaign_daily_results_campaign_date';
```

That index **is** the restatement fix. Without it the endpoint's upsert
degrades into an append and the daily table grows a duplicate row per campaign
per day, per run.

### 2. Set `RESULTS_INGEST_SECRET` in Vercel

A long random string. Same idea as `CRON_SECRET`.

```bash
openssl rand -hex 32
```

Add it to the Vercel project's environment variables (all environments) and
redeploy. It's the only thing standing between the open internet and this
endpoint, so it does not go in the repo, in a Slack message, or in this file.

### 3. Link one real campaign

Open a project that has a live campaign → **Campaign Tracking** panel → paste
the ad account ID (`act_…`), the numeric campaign ID, the campaign name, and
the launch date.

**Then answer the question that matters:** is this moment a whole campaign, or
one ad set inside a bigger campaign?

- **Whole campaign** — leave the ad set fields blank.
- **One ad set** — fill in the ad set ID and name, and set the launch date to
  the **ad set's** start date, not the campaign's. The agent will pull only
  that ad set.

Getting this wrong doesn't produce an error, it produces confident wrong
numbers, so it's worth thirty seconds in Ads Manager to check.

Don't link both a campaign and an ad set inside it — that counts the ad set's
spend twice on the Results tiles. The schema permits it (they're different
rows) but nothing wants it.

Nothing is auto-discovered. The link is the contract: the ingest endpoint
rejects anything that wasn't linked here, on purpose — otherwise the Results
tab would quietly grow campaigns nobody chose to watch.

---

## Prove it end-to-end before pointing the agent at it

Run these against production with the real secret. Expect exactly what's
described; if any step differs, stop and fix it before scheduling anything.

```bash
export CRM=https://prometheus-crm-psi.vercel.app
export SECRET='<the value from Vercel>'
```

**1. The work list** — should name the campaign you just linked, with
`mode: "backfill"` and a range from its launch date through yesterday.

```bash
curl -s -H "Authorization: Bearer $SECRET" "$CRM/api/results/ingest" | jq
```

**2. Post two hand-written days.** Use the real `act_…` / campaign ID from step
1's output.

```bash
curl -s -X POST "$CRM/api/results/ingest" \
  -H "Authorization: Bearer $SECRET" -H 'Content-Type: application/json' \
  -d '{"reported_at":"2026-08-05T11:00:00Z","rows":[
    {"ad_account_id":"act_XXX","campaign_id":"YYY","stat_date":"2026-08-03","spend":100,"revenue":250,"purchases":5,"roas":2.5,"cpa":20,"landing_page_views":500,"lp_conversion_rate":1.0,"unique_outbound_ctr":1.2},
    {"ad_account_id":"act_XXX","campaign_id":"YYY","stat_date":"2026-08-04","spend":150,"revenue":600,"purchases":12,"roas":4.0,"cpa":12.5,"landing_page_views":800,"lp_conversion_rate":1.5,"unique_outbound_ctr":1.4}
  ]}' | jq
```

Expect `rows_upserted: 2`, `rows_rejected: 0`, `rows_flagged: 0`.

**3. Look at the tab.** `/results` should show the campaign with $250 spend,
$850 revenue, ROAS 3.40x, and a fresh timestamp.

**4. The restatement test — this is the important one.** Re-post the *same two
dates* with different numbers:

```bash
curl -s -X POST "$CRM/api/results/ingest" \
  -H "Authorization: Bearer $SECRET" -H 'Content-Type: application/json' \
  -d '{"reported_at":"2026-08-05T12:00:00Z","rows":[
    {"ad_account_id":"act_XXX","campaign_id":"YYY","stat_date":"2026-08-04","spend":150,"revenue":900,"purchases":18,"roas":6.0,"cpa":8.33,"landing_page_views":800,"lp_conversion_rate":2.25,"unique_outbound_ctr":1.4}
  ]}' | jq
```

`/results/<id>` must still show **two** rows, with Aug 4 now reading $900. If
you see three rows, the unique index from step 1 didn't apply — stop, fix that,
delete the duplicates, and re-test.

**5. Check the rejection path works.** Post a campaign ID that isn't linked:

```bash
curl -s -X POST "$CRM/api/results/ingest" \
  -H "Authorization: Bearer $SECRET" -H 'Content-Type: application/json' \
  -d '{"rows":[{"ad_account_id":"act_000","campaign_id":"000","stat_date":"2026-08-04","spend":1,"revenue":1}]}' | jq
```

Expect `rows_rejected: 1` with a reason naming the fix, and `rows_upserted: 0`.

Then delete the hand-written test rows before real data lands:

```sql
DELETE FROM campaign_daily_results WHERE tracked_campaign_id = '<id>';
```

---

## The scheduled agent

Set this up in the other Claude account (the one with the Meta MCP) as a daily
scheduled task at **7:00am Eastern**.

Store the secret in that account's own secret storage, not in the prompt text.

### Prompt

> You are the daily ingestion job for Prometheus CRM's Results tab. Your only
> output is data posted to the CRM — you are not writing a report for a human,
> and you must not summarize, interpret, or editorialize the numbers.
>
> **Step 1 — get the work list.**
>
> `GET https://prometheus-crm-psi.vercel.app/api/results/ingest`
> with header `Authorization: Bearer <RESULTS_INGEST_SECRET>`.
>
> The response lists every entry to pull and the exact date range for each.
> The CRM decides the ranges. Do not substitute your own dates, do not "catch
> up" on ranges it didn't ask for, and do not skip an entry because the range
> looks redundant — the trailing re-pull is deliberate.
>
> **Step 2 — pull each entry from the Meta MCP.**
>
> Each entry has a `level` field. **Read it before you pull.**
>
> - `level: "campaign"` — get the daily breakdown for that `campaign_id`.
> - `level: "adset"` — get the daily breakdown for that `adset_id` ONLY, at ad
>   set level. That campaign holds several marketing moments as sibling ad
>   sets, so campaign totals would be several moments added together. Echo
>   `adset_id` back on every row you post for that entry.
>
> Get the **daily breakdown** (one row per day) over `[from_date, to_date]`
> inclusive, at the **7-day-click attribution window**.
>
> Metrics needed per day: spend, revenue (total attributed), incremental
> revenue, purchases, landing page views, ROAS, CPA, unique outbound CTR, and
> landing-page conversion rate.
>
> `incremental_revenue` comes from the ad account's existing **"Incremental
> Revenue"** column. Read it exactly as reported. If the account has no such
> column configured, send `null`. Never derive it, never estimate it, never
> substitute total revenue for it.
>
> **Step 3 — post the rows back, verbatim.**
>
> `POST` to the same URL with the same Authorization header:
>
> ```json
> {
>   "reported_at": "<ISO 8601 timestamp of when you pulled>",
>   "rows": [
>     {
>       "ad_account_id": "act_123456",
>       "campaign_id": "987654321",
>       "adset_id": "52530393856787",
>       "stat_date": "2026-08-04",
>       "spend": 250.00,
>       "revenue": 1000.00,
>       "incremental_revenue": 350.00,
>       "purchases": 20,
>       "landing_page_views": 1000,
>       "roas": 4.0,
>       "cpa": 12.50,
>       "unique_outbound_ctr": 1.2,
>       "lp_conversion_rate": 2.0,
>       "attribution_window": "7d_click"
>     }
>   ]
> }
> ```
>
> Money in dollars. Percentages as percent (`2.0` means 2.0%, not 200%). ROAS
> as a plain multiple. You may batch every entry's rows into one POST.
>
> Omit `adset_id` (or send null) for `level: "campaign"` entries. Include it for
> every `level: "adset"` entry. Sending campaign totals for an ad-set-tracked
> campaign is REJECTED, not stored — that rejection is a guardrail against
> writing several moments' combined numbers into one moment's history, so if
> you see it, fix the pull rather than working around it.
>
> **STANDING RULE — the one that matters most:** report only what the tool
> returned. If a metric is unavailable, send `null`. Never estimate, never
> interpolate across a missing day, never round to a number that looks better,
> and never fill a gap with a neighbouring day's value. A `null` is a correct
> answer. An invented number is not, and it is worse than no data because it is
> indistinguishable from a real one once it's in the table.
>
> If the MCP returns nothing for a campaign, post nothing for it and say so in
> your run output. Do not post zeros — a zero means "the campaign ran and made
> nothing", which is a different claim.
>
> **Step 4 — report the response.**
>
> The POST response includes `rows_upserted`, `rows_rejected`, `rejected[]`,
> and `flagged[]`. Reproduce all of it in your run output, in full, including
> the reasons. Do not summarize it as "success" if anything was rejected or
> flagged. If `rows_rejected > 0`, the run needs a human — say so plainly at
> the top of your output.
>
> **Weekly:** on Mondays, call the work list with `?full=1` instead. That asks
> for a full re-pull from each campaign's launch date, which absorbs Meta's
> older restatements that fall outside the normal 7-day trailing window.

---

## Running it on demand

You don't have to wait for 7am. The work list takes filters, so any run can be
narrowed to one brand or one campaign — same endpoint, same POST back, just a
smaller work list.

| Parameter | Effect |
|---|---|
| `?brand=noble` | Case-insensitive substring on brand name |
| `?brand_id=<uuid>` | Exact brand |
| `?tracked_campaign_id=<uuid>` | One tracked campaign or ad set |
| `?days=N` | Override the 7-day trailing window (1–365) |
| `?full=1` | Re-pull from launch, ignoring what's already stored |
| `?include_ended=1` | Include campaigns whose tracking has ended |

They combine. Refresh everything for Noble, from launch:

```bash
curl -s -H "Authorization: Bearer $SECRET" \
  "$CRM/api/results/ingest?brand=noble&full=1" | jq
```

The response echoes a `filters` object back and adds a `note` when filters
matched nothing — so a typo'd brand name reads as "nothing matched", not as a
successful empty run.

**In practice:** ask Claude (this account, which has the Meta MCP) to "refresh
Noble now". It calls the work list with `?brand=noble`, pulls, posts, and
reports what landed. The scheduled 7am task passes no filters and does
everything.

---

## Contribution margin

ROAS says how much revenue a dollar of spend returned. It does not say whether
money was made. A 2.0x ROAS is strong at 30% cost of delivery and a loss at
60%, and nothing on the tab could tell those apart.

So each brand carries a **cost of delivery**, set on the Results detail page:

- **Percent of revenue** — `35` means 35%. `CM = revenue − (35% × revenue) − spend`
- **Dollars per order** — `18.50` means $18.50/order. `CM = revenue − ($18.50 × purchases) − spend`

Pick whichever way the brand actually quotes it; the editor spells out the
formula it will apply before you save, because the wrong mode silently rescales
every margin figure.

Once set, the tab also shows **break-even ROAS** — `1 / (1 − COD)` — and badges
a campaign running below it. That turns "is 2.1x good?" into a yes or no.

An unset COD shows contribution margin as `—`, never as zero. Treating it as
zero would report gross profit as if delivery were free, overstating every
campaign by exactly the cost of delivering it. Margin is recomputed at render
from the brand's current COD, never frozen onto the daily rows, so correcting a
COD fixes every historical day at once.

### Why the trailing re-pull exists

Meta backfills attribution for days *after* the event. Tuesday's ROAS is a
different number next week. Every write is an upsert on
`(tracked_campaign, stat_date)`, so re-pulling a day updates it in place rather
than appending a contradiction. Pulling only yesterday would permanently freeze
each day at its worst, earliest number.

---

## Watch the first three runs

Before trusting the tab, open Ads Manager and compare by eye — spend, revenue,
and purchases for two or three days per campaign.

What to look for:

- **Numbers that are close but not equal.** Usually an attribution-window
  mismatch. Check the `attribution_window` on the row; anything other than
  `7d_click` gets flagged in the UI for exactly this reason.
- **Flagged rows.** A flag means the row's numbers disagree with each other
  (the reported ROAS isn't revenue ÷ spend, say). The row is stored anyway and
  badged — dropping it would have made it indistinguishable from a day the
  campaign didn't run. Investigate before trusting the campaign.
- **A stale timestamp.** The freshness stamp tints amber past ~36h. That means
  a run was missed, not that the campaign stopped.
- **Growing gaps.** A day or two behind is normal restatement lag. A gap that
  keeps growing means the agent isn't running.

If the agent gets a specific day wrong, fix it in the UI — the **Correct**
button on any row in the daily table. That sets `source='manual'` and the agent
will never overwrite that day again. "Hand back to agent" undoes it.

---

## What's deliberately not built yet

- **Auto-filling the marketing report** from cumulative results, replacing the
  hand-typed metrics in `MomentReportForm`. This is the real payoff and the
  reason to build any of this — but the numbers should prove themselves for a
  few weeks first.
- **Ad-level rows** (which creative won). ~30–50× the rows and API load. The
  schema doesn't block it: a future `ad_daily_results` hangs off
  `tracked_campaigns` the same way.
- **AI narrative over the results.** Raw numbers land immutably first. Any
  generated commentary is a separate layer with a `findUnverifiedNumbers`-style
  guard over it, so a persuasive sentence can never quietly introduce a figure
  that isn't in the table.
