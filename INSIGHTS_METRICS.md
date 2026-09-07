# How the Insights charts are calculated

Every number on `/insights` is computed in `src/lib/insights.ts`, read-only over
the `pipeline_events` log (plus `projects`/`profiles` for names and current
assignments). Nothing is stored or mutated — the page recomputes on each load.

## Global rules

- **Event window:** only events from the **last 60 days** are read (hard cap
  50,000 rows as a guard).
- **"Last 7 days"** windows apply to the throughput, queue, utilization, and
  context-switch charts.
- **All dates are US Eastern** (matching the cron/slip logic).
- **Producer attribution** uses each track's **current** editor
  (`lp_editor_id` / `creative_editor_id`), not whoever was assigned at the
  moment of the event. Assignments rarely change mid-flight, so this is the
  honest approximation.
- Every panel shows a **"no data yet"** state until the relevant events exist.

---

## Production Capacity

**Median LP build time / Median creative build time**
Walk each card's `stage_changed` events per track. Entering **In Progress**
opens an interval; leaving it closes one and records the duration in days. Only
**closed** intervals count (a track still in progress hasn't finished, so its
time is unknown). The tile shows the **median** of those durations, LP and
creative tracked separately.

**Shipped to review** (tile)
Count of `stage_changed` events with `to_stage = internal_review` in the **last
7 days**, across all tracks.

**Throughput by producer**
The same "reached Internal Review in the last 7 days" events, **grouped by the
track's current editor**. One bar per producer = how many tracks they pushed to
review this week.

**Queue depth by producer**
For every active (non-complete) project, each track that **has an editor** and is
**still sitting in Brief** counts as one. Grouped by editor = work assigned but
not yet started.

**Utilization by producer**
Re-walk the In Progress intervals, clamp them to the **last 7 days**, and **union
overlapping intervals** per producer (so two parallel cards don't double-count).
Utilization % = busy hours ÷ available hours, where available = (weekdays in the
last 7 days × 8h). Capped at 100%.

**Context-switch load**
Events from the last 7 days that carry a brand (excluding `system` and `client`
actors). For each producer, count the **distinct brands touched per active day**,
then average across the days they were active. A higher number = more brand
juggling per day.

---

## Slip Attribution

Two different mechanisms feed this section:

- **Project-level date math** (due date vs. when it went live) → the histogram,
  rollover rate, and slip-by-client.
- **`slip_recorded` events** (emitted by the daily cron) → slip-attribution-by-
  stage and slip-by-producer.

**Which projects are "evaluated"**
A project counts once its outcome is known: it has a **Live** event, or it's
already **past its due date**. Future-dated cards that haven't shipped are
skipped (nothing to say yet), and completed cards with no Live event are skipped
(they predate the event log — no honest data).

**Projects by slip** (histogram)
For each evaluated project: `endDate` = the date it went Live (latest track to
reach Live), or today if still open. `slip = endDate − due_date` in days.
Buckets:
- **Rolled over** — shipped in a *later calendar month* than the due date's month
- **On time** — slip ≤ 0
- **1–3 / 4–7 / 8+ days late** — by the slip value
(Rollover takes precedence: a project in a later month lands in Rolled Over even
if it's only a few days late.)

**Rollover rate** (headline tile)
Rolled-over projects ÷ evaluated projects, as a %. Tinted amber ≥ 10%, red ≥ 25%.

**Slip attribution by stage**
From the latest `slip_recorded` event per card+track, count by the
`attributed_stage` in the payload — i.e., which stage the card was **sitting in**
when the daily scan flagged it as slipping.

**Slip by client**
Per brand, the **average days late** across that brand's slipped projects
(slip > 0). Top 8 brands shown.

**Slip by producer**
From the latest `slip_recorded` events, the `delta_days` grouped by the track's
current editor, **averaged** per producer.

**Median offer approval** (tile)
From Offer Cycle `stage_changed` events: the time from a card's **first** entry
into Client Review to it reaching **Approved**. Median across all approved offers
in the window.

---

## Reading it honestly

- The dashboards need **~2 weeks of accumulated events** before the medians and
  distributions mean much — with only a few events, one card swings a median.
- Slip-attribution-by-stage and slip-by-producer only populate once the **daily
  cron** has run and emitted `slip_recorded` events for overdue cards.
- Everything is a 60-day rolling view: a producer who was busy two months ago but
  idle now reads as idle.
