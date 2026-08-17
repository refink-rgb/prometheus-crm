---
name: pull-meta-results
description: Pull daily campaign performance from Meta Ads into Prometheus CRM's Results tab, on demand. Use this whenever Giovane asks to refresh, update, sync, or pull campaign/results/Meta data for Prometheus — phrases like "puxa os dados do Prometheus", "atualiza as campanhas", "refresh results", "roda o ingest da Meta", "atualiza a Noble", or any variant naming a brand plus wanting fresh numbers. This is a MANUAL, on-demand action — there is no automatic daily schedule (a cloud-scheduled agent was attempted and found infeasible, since the org's Meta MCP connector is workspace-provisioned and not attachable to Claude cloud routines). Always use this skill for that task rather than improvising the Meta field names or the ingest payload shape from scratch — the details below were learned the hard way across a real production run and skipping them produces silently wrong numbers.
---

# Pull Meta results into Prometheus CRM

This is the on-demand replacement for a daily agent that couldn't be built (the org's
Meta MCP is workspace-provisioned; Claude cloud routines can't attach to it). Every
time the user wants fresh numbers, run this skill from a session that already has the
org's Meta Ads MCP tools loaded (or load them — they appear as
`mcp__<uuid>__ads_get_ad_entities` and similar; search for `ads_get_ad_entities` if
not already visible).

Read `~/prometheus-crm/RESULTS_AGENT_PROMPT.md` if you want the full architectural
background (why upserts, why warn-don't-drop). This file is meant to be
self-contained enough that you don't have to.

## Step 1 — Auth

Read the secret from the repo, never from memory and never hardcoded here:

```
Read ~/prometheus-crm/.env.local
```

Pull the value of `RESULTS_INGEST_SECRET`. It's gitignored and local-only — never
print it to the user, never write it into this file or any other tracked file.

## Step 2 — Get the work list

```
GET https://prometheus-crm-psi.vercel.app/api/results/ingest
Authorization: Bearer <secret>
```

No filters = every live tracked campaign. If the user named a specific brand or
campaign, narrow the request instead of pulling everything:

| Filter | Effect |
|---|---|
| `?brand=noble` | case-insensitive substring on brand name |
| `?brand_id=<uuid>` | exact brand |
| `?tracked_campaign_id=<uuid>` | one tracked campaign or ad set |
| `?days=N` | override the trailing window (1–365) |
| `?full=1` | full re-pull from launch, ignoring what's already stored |
| `?include_ended=1` | include campaigns whose tracking has ended |

The response is a list of entries, each with `tracked_campaign_id`, `ad_account_id`,
`campaign_id`, `adset_id`, `level` (`"campaign"` or `"adset"`), `from_date`,
`to_date`, and display names. **The CRM decided these ranges — pull exactly what's
asked, don't substitute your own dates.**

## Step 3 — Pull each entry from Meta

**Check `level` before you pull anything.** This is the detail that matters most:

- `level: "campaign"` → pull at campaign level, filtered by `campaign.id`.
- `level: "adset"` → pull **only that ad set**, filtered by `adset.id`. Never fall
  back to the parent campaign. Several clients (Noble is the example that surfaced
  this) run every marketing moment as a sibling ad set inside one evergreen
  campaign — pulling the campaign would silently combine every moment's numbers
  under whichever one you're reporting on. Echo `adset_id` on every row you post
  for an adset-level entry.

**Field list.** `ads_get_ad_entities` rejects fields outside a specific supported
set (learned by triggering the tool's own validation error), and — this part cost
a retry the first time — **the set is different at campaign level vs ad set
level**. `attribution_setting` is adset-only; asking for it at `level: "campaign"`
gets rejected outright.

```
adset level:    id, amount_spent, omni_purchase_values, actions:omni_purchase,
                omni_landing_page_view, purchase_roas, cost_per_omni_purchase,
                outbound_clicks_ctr, attribution_setting

campaign level: same list MINUS attribution_setting
```

Use `time_range: {"since": ..., "until": ...}` (not `date_preset`) with
`time_increment: "1"` to get one row per day.

**Attribution window.** At ad set level, Meta's own `attribution_setting` field
reports the account's default as `"1d_view_7d_click"` — not the "7d_click" you
might expect. That's normal, not an error; pass it straight through as
`attribution_window` in the POST payload. At campaign level, where the field
isn't available at all, use `"1d_view_7d_click"` as the default — every account
observed so far uses it, and it's a reasonable assumption absent a way to ask the
campaign directly.

**"Not available" means zero, not unknown.** If a day has real `amount_spent` or
`omni_landing_page_view` — the entity was genuinely active — but
`omni_purchase_values` / `actions:omni_purchase` come back `"Not available"`, that's
Meta saying zero purchases happened, not that the number is missing. Send
`revenue: 0, purchases: 0` for that day (the ingest endpoint requires revenue as a
number and will reject the row otherwise). Leave `roas` / `cpa` as `null` — a ratio
with no denominator isn't zero, it's undefined, and reporting it as 0 would be
inventing a number. If Meta returns genuinely nothing for a date — no row at all,
not even a "Not available" one — don't manufacture a $0 row to fill the gap; leave
it as a gap. A missing day and a real zero are different facts, and only one of
them is true.

**Long ranges can come back truncated — and gaps in the middle need the same
check.** A ~28-day request has been observed to silently return only 12–19 days,
with no error, and shorter requests sometimes skip individual days in the middle
of the range with no error either. After every pull, look at both ends: does the
first/last date you received match `from_date`/`to_date`, and are there any missing
dates in between? For any suspicious gap — end-of-range or mid-range — re-call
narrowed to just that stretch (or even a single day). You'll get one of two
answers:

- **An empty array `[]`, or a single aggregate row with every field `"Not
  available"`** — that's Meta's real answer: the entity had zero activity for
  that stretch. Stop, it's a gap, not a truncation. Don't invent a $0 row to fill
  it (unless the entity later shows real activity resuming — a day sandwiched
  between two active days with its OWN real `$0.00 amount_spent` returned
  explicitly, as opposed to no row at all, is a confirmed real zero, not a gap —
  see the "Not available means zero" rule above for the distinction between an
  explicit $0 and an absent row).
- **More rows appear** — it was truncation; keep narrowing/re-calling until you've
  covered the stretch.

This matters more than it sounds like it should: an ad set can look "paused" from
a wide pull when it's actually still spending, just past whatever row limit that
call silently applied.

**Units for the POST.** Dollars, not cents — the CRM converts to cents server-side.
Percentages as percent (`2.90` means 2.90%, not a fraction). ROAS as a plain
multiple (`2.5`, not `250%`).

## Step 4 — Post the rows back

```
POST https://prometheus-crm-psi.vercel.app/api/results/ingest
Authorization: Bearer <secret>
Content-Type: application/json

{
  "reported_at": "<ISO 8601 now>",
  "rows": [
    {
      "ad_account_id": "act_...",
      "campaign_id": "...",       // context; include when known, omit/null is fine for pure adset rows
      "adset_id": "...",          // REQUIRED for adset-level entries, omit for campaign-level
      "stat_date": "YYYY-MM-DD",
      "spend": 123.45,
      "revenue": 678.90,
      "purchases": 3,
      "landing_page_views": 120,
      "roas": 5.5,
      "cpa": 41.15,
      "unique_outbound_ctr": 1.23,
      "attribution_window": "1d_view_7d_click"
    }
  ]
}
```

You can batch every entity's rows into a single POST call — that's the normal case,
not an exception.

## Step 5 — Report back plainly

Answer in whatever language the user asked in (this user writes in Portuguese).
State clearly:

- `rows_upserted`
- `rows_rejected` — if this is anything above 0, lead with it and show the reasons.
  Don't say "done" and bury a rejection in the details.
- `rows_flagged` — the row was stored but its own numbers disagreed with each other
  (e.g. reported ROAS didn't match revenue/spend); show the warnings.

If the user asked for "tudo" / everything, summarize per brand or per moment rather
than dumping all raw rows — a short table of spend/revenue/ROAS per entity that just
got refreshed is more useful than a wall of JSON.

## A note on moments split across ad sets

Some clients (Mad Viking, WOW Sports) run one marketing moment as TWO sibling
ad sets — "prospecting" and "retention". Both get linked and pulled as
separate `tracked_campaigns` rows; that part of the pipeline doesn't change.
What's different is the Results tab: if Giovane has grouped them (via the
"Group these into one moment" control on the project's Campaign Tracking
panel), they render as ONE combined card instead of two. That grouping is
purely a display-layer join — it doesn't change anything about how you pull
or post data here. Pull and post each tracked entity exactly as described
above; the combining happens after, when the page reads the data back.

## What this skill is not

There is no cron, no daily trigger, nothing running when this conversation isn't
open. If the user seems to think numbers update themselves overnight, say so plainly
— that's exactly the misunderstanding that led to this skill existing in the first
place.
