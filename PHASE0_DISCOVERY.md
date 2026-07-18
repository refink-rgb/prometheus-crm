# Phase 0 Discovery — Prometheus Evolution

**Status: SIGNED OFF by Giovane 2026-07-17.** Confirmed decisions:

- **Timezone:** US Eastern (`America/New_York`) — always. Cron date-boundaries computed in Eastern.
- **Active client:** `brands.is_active = true` (trials included, retainer ignored).
- **Journey naming:** cron find-or-creates a journey named `"<Month> <Year>"` (e.g. `August 2026`)
  per brand for the *following* month (run in July → August 2026, run in August → September 2026).
- **Offer Cycle:** new table (not `projects` columns). Idempotency key `(brand_id, target_month, moment_slot)`.
- **Field categorization:** as proposed below, ⚑ defaults accepted (`page_type` strategic,
  `competitor_reference` creative-only, `ad_copy_url` copy, `target_audience` excluded/legacy).
- **`sent_to_client`:** emitted on a track entering `client_review` + on `publishAssets` (creative track).
- **`client_responded`:** project/track-level only; per-asset responses excluded.
- **Mid-month onboarded clients:** wait for the next 24th; admin notification logged.
- **Validation:** on production with a test brand/card. Migrations hand-run by Giovane in the SQL editor.

Sources: repo at `~/prometheus-crm` (branch `main`, commit `bef0e50`, clean tree).
Caveat inherited from `PROJECT_CONTEXT.md`: `supabase/schema.sql` is **stale** vs. production;
`src/lib/types.ts` is the maintained mirror of the live DB and is what this document trusts.
No DB credentials exist on this machine (`.env.local` absent), so anything marked
**[verify in prod]** needs one query in the Supabase SQL editor to confirm.

---

## Q1 — Where does the Production Cycle live?

**One table: `projects`.** One row = one marketing moment for one brand. There is no
separate "card" or "track" table — both tracks are columns on the row.

| Concern | Where |
|---|---|
| Card state (all fields) | `projects` table; TS mirror in `src/lib/types.ts:103-183` (`Project` interface) |
| Stage enum | `src/lib/types.ts:1` — `'brief' \| 'in_progress' \| 'internal_review' \| 'client_review' \| 'live' \| 'done'`; labels/order at `types.ts:305-314` |
| Stage per track | `projects.lp_stage`, `projects.creatives_stage` (`types.ts:170-171`) |
| Assignments | `projects.lp_editor_id`, `projects.creative_editor_id` — FKs to `profiles.id` (migration `20260715`) |
| Brand/client | `brands` table (`types.ts:77-94`) |
| Grouping | `journeys` (`types.ts:96-101`: id, brand_id, name) + `projects.journey_id` + `projects.marketing_moment` (1 \| 2 \| null) — **M1/M2 already exists as a concept** |
| All mutations | Server actions in `src/lib/actions.ts` (single file, ~1700 lines), every one gated by `canEdit()` (`src/lib/permissions.ts` — still the hardcoded email array; the profiles-based gate from migration `20260715` has NOT shipped to code) |
| Main views | `/` dashboard, `/pipeline` kanban (`KanbanView.tsx`), brand page, project detail page (`StageTracker.tsx` per-track controls) |

Timestamps that exist today on a project: `created_at`, `offer_locked_at`. **There are no
per-stage entry timestamps anywhere.** (The brief assumed "the current stage's entry time
is already there" — it is not. Doesn't change the design: the event log becomes the only
source of stage-entry times, from deploy day forward. Flagged so nobody goes looking for
a column that doesn't exist.)

---

## Q2 — Brief-stage fields and categorization

Field inventory from `NewProjectForm.tsx` (creation form) + `ProjectEditForm.tsx` (edit
form) + `projects` columns. Proposed categorization — **items marked ⚑ need your ruling**:

### `strategic` — auto-populate from Offer Cycle → Production Brief

| Field | Notes |
|---|---|
| `offer_dynamics_type` | dropdown (offer mechanic type) |
| `offer` | offer details one-liner ("Buy 2 Get 1 Free…") |
| `offer_description` | long-form offer description |
| `product_featured` | |
| `product_description` | |
| `retail_price` | |
| `page_type` ⚑ | Listicle / Bundle Builder / Collection / Generic Offer Page — I'd call the LP format a strategic decision made at offer time; confirm |
| `offer_dynamics_detail` | column exists in DB but is on **neither form** — dead field? [verify in prod whether it holds data] |

### `copy` — never on the Offer Cycle, never auto-populated

`headline`, `body_copy`, `supporting_message`, `cta`, `ad_headlines` (bank of 5),
`ad_subcopies` (bank of 5), `ad_eyebrows` (bank of 3), `ad_copy_primary_text`,
`ad_copy_description`, `ad_copy_url` ⚑ (destination URL — copy-adjacent; it's set with
the ad copy so I've kept it here, confirm).

### `creative-only` — may live on the Offer card (your call), never auto-populates

| Field | Notes |
|---|---|
| `competitor_reference` ⚑ | competitor LPs/ads to reference — could be argued strategic (positioning context). My proposal: creative-only. Your call decides whether it flows to Production. |
| `client_ad_inspiration` | |
| `product_images_link` | Drive folder URL |
| `project_images` (uploads) | separate table, image attachments |

### `metadata` — system/PM-managed, not part of the offer

`name`, `due_date` (= LIVE target), `stage_brief_due_date`, `stage_in_progress_due_date`,
`stage_internal_review_due_date`, `stage_client_review_due_date`, `journey_id`,
`marketing_moment`, `lp_editor_id`, `creative_editor_id`, `lp_stage`, `creatives_stage`,
`lp_url`, `creatives_notes`, `shopify_coupon_code`, `motion_link`, `needs_revisions`,
`offer_locked` / `offer_locked_at` / `offer_locked_by`, `share_token`,
`client_approved` / `lp_approved` / `creatives_approved`, `is_complete`.

### Legacy (kept for DB compat, not on any form — excluded from everything)

`font`, `author`, `discount`, `tiered_offer`, `inspiration`, `offer_type`,
`target_audience` ⚑, `notes`, `assigned_designer`.

⚑ **`target_audience` note:** your strategic definition mentions "audience", but the only
audience field is legacy and off the forms. If the Offer Cycle should capture audience,
that's a **new** field on the Offer card with no Production destination (per your rule:
flag, don't silently create columns). Decide whether the Offer Draft form gets one.

### Auto-population summary table

| Field | Category | Auto-populates to Production Brief? |
|---|---|---|
| offer_dynamics_type | strategic | **yes** |
| offer | strategic | **yes** |
| offer_description | strategic | **yes** |
| product_featured | strategic | **yes** |
| product_description | strategic | **yes** |
| retail_price | strategic | **yes** |
| page_type ⚑ | strategic ⚑ | **yes** (if confirmed strategic) |
| competitor_reference ⚑ | creative-only ⚑ | no |
| client_ad_inspiration | creative-only | no |
| product_images_link | creative-only | no |
| all copy fields | copy | no (never on offer) |
| all metadata fields | metadata | no (system-set: brand, journey, moment come from the Offer card's identity, not field-copy) |

---

## Q3 — How do the LP and Creative tracks work?

**One shared row, two independent stage columns** (`lp_stage`, `creatives_stage`). No
parent/child records.

Every stage write in the entire codebase goes through exactly **three server actions** in
`src/lib/actions.ts` — clean chokepoints for event emission:

| Action | Line | Called from | Behavior |
|---|---|---|---|
| `updateProjectStage(projectId, brandId, track, stage)` | `actions.ts:167` | `StageTracker.tsx:40,50` (project page next/prev per track) | moves **one** track; forward or backward |
| `updateProjectStagesBoth(projectId, brandId, stage)` | `actions.ts:190` | `KanbanView.tsx:123` (pipeline kanban drag) | moves **both** tracks to the same column in one UPDATE |
| `markProjectComplete(projectId, brandId)` | `actions.ts:247` | project page | sets both tracks to `done` + `is_complete=true` |

Implications for Phase 1:
- Tracks ARE independent → **every event is track-scoped** (`track ∈ {lp, creative}`).
- A kanban drag or complete-click = **two** `stage_changed` events (one per track), and
  only for tracks that actually changed stage (a drag can be a no-op for one track).
- Backward moves happen (prev button, drag left) — the event schema is direction-agnostic
  (`from_stage` → `to_stage`).
- No external write path exists: the `/api/creative/*` routes (editor-token API, migration
  `20260716`) are **read-only**; client-facing review actions (`approveProject:1202`,
  `updateAssetStatus:918`, `confirmOfferByClient:1334`) never touch stage columns.

Existing signals that map to the brief's other event types:

| Brief event | Today's closest signal |
|---|---|
| `assigned` | `assignProjectEditor` (`actions.ts:1466`) — track-parameterized, has prev/next assignee available |
| `sent_to_client` | no explicit action. Candidates: track enters `client_review` (stage transition), `publishAssets` (`actions.ts:686`, creatives become client-visible), `generateShareToken` (`actions.ts:320`, link minted). **Proposal: emit on transition into `client_review` (per track), which matches "often coincides with a stage change"; treat `publishAssets` as an additional creatives-track `sent_to_client`.** Confirm. |
| `client_responded` | `approveProject` (track approval via review link) → `approved`; `toggleProjectRevisions` (`actions.ts:232`, PM-set) → `revision_requested`; per-asset `updateAssetStatus` is asset-granular — proposal: do NOT emit per asset, only project/track-level responses. Confirm. |
| `slip_recorded` | computable: per-stage expected exit dates already exist (`stage_*_due_date` columns, project-wide — note they are **shared by both tracks**, there are no per-track due dates). `expected_date` = the due date of the stage the track is sitting in; daily job compares against today. |

---

## Q4 — What defines an "active client"?

`brands` has three overlapping signals (`types.ts:77-94`):

1. **`is_active` boolean** — set by `updateBrandDetails` (`actions.ts:275`):
   `is_active = clientStatus === 'active' || clientStatus === 'trial'` — **trials count as
   active** by this flag (with `is_trial=true` alongside).
2. **`monthly_retainer`** — dashboard's "active clients" stat (`app/(app)/page.tsx:48`) uses
   `(monthly_retainer ?? 0) > 0 && is_active`.
3. **`pipeline_status`** — BD pipeline enum; `'active'` renders as "Active Client"
   (`types.ts:3-14`). Not kept in sync with `is_active` by any code I can find.

**Proposed cron definition: `SELECT … FROM brands WHERE is_active = true`** (includes
trials, ignores retainer and pipeline_status).

Confirm with real data — run in the SQL editor; if the proposal is right this returns your
13 actives:

```sql
SELECT name, is_active, is_trial, monthly_retainer, pipeline_status
FROM brands WHERE is_active = true ORDER BY name;
```

**Decide:** (a) do trial clients get auto-generated Offer cards? (b) should a $0-retainer
but is_active brand get them?

---

## Q5 — Scheduled-job infrastructure

**None exists.** No `vercel.json`, no pg_cron migration, no workers, no queues. This is a
prerequisite for **Phase 1's daily slip job**, not just Phase 3 — it moves earlier in the
build order.

Two viable options (app deploys via Vercel auto-deploy from `main`):

1. **Vercel Cron** (recommended): `vercel.json` crons hitting protected API routes
   (`Authorization: Bearer ${CRON_SECRET}`), routes use the existing service-role client
   (`src/lib/supabase/service.ts` — `SUPABASE_SERVICE_ROLE_KEY` already in Vercel env).
   Code lives in the repo, visible in Vercel dashboard, manually re-runnable by hitting
   the route. **Caveat: on the Hobby plan, crons are limited (daily granularity, loose
   timing within the hour). Which Vercel plan is this project on?**
2. **Supabase pg_cron**: runs inside Postgres, precise timing, but logic lives in SQL out
   of the repo, and per `HANDOFF.md` all DB DDL is run by you manually in the SQL editor —
   more moving parts you'd own by hand.

Recommendation stands with Vercel Cron unless the plan doesn't allow two cron jobs
(daily slip scan + monthly generation; the monthly one can be a daily cron that no-ops
except on the 24th, which also sidesteps Hobby-plan restrictions).

---

## Q6 — Timezone

**The app has no timezone handling at all.** All due dates are Postgres `DATE` columns;
the UI deliberately parses them as *browser-local* midnight (`stageColors.ts:49-52`,
`CalendarView.tsx:76-77`). Server code never references a timezone. Vercel/Supabase crons
fire in **UTC**.

So "the 24th at 00:01" is undefined until you pick a reference timezone — this is Open
Question #1 from the brief and **only you can answer it**. The cron will convert your
chosen local time to UTC (and the slip job will use the same timezone to define "today").
Team spans Brazil/SEA/Europe by the look of the roster, so nothing can be inferred.

---

## Additional findings & questions surfaced

1. **Journey naming for auto-generated cards.** `journeys.name` is freeform per brand.
   The cron must attach each generated card to a journey (or leave `journey_id` null).
   What's the convention — should the cron find-or-create a journey named e.g.
   `"August 2026"` per brand? Give me the exact expected journey name format.
2. **Offer Cycle storage will be a new table** (working name `offer_cards`), not new
   columns/values on `projects` — keeps the non-breaking guarantee absolute: no new stage
   enum values, no type-widening on existing queries. Detailed schema comes with Phase 2's
   proposal.
3. **Idempotency key** for Trigger A: `(brand_id, target_month, moment_slot)` unique
   index on the new table — makes double-fires a DB-level no-op, not just app logic.
4. **Actor attribution**: every server action already resolves the auth user
   (`user.id`/`user.email`); events will store `actor_id`. The cron/slip jobs have no user —
   they'll log a sentinel actor (`system`). Client-initiated actions via `/review/[token]`
   have no auth user either — they'll log actor `client` (matches the existing
   `offer_locked_by = 'client'` precedent, `actions.ts:1347`).
5. **No test infrastructure, no local dev DB.** Per `HANDOFF.md`: verification =
   `npx tsc --noEmit` + deploy to prod. The phase validation checklists (walk a card
   through 3 stages, etc.) will run against production with a test brand/card. Confirm
   you're OK with that, or tell me if a staging Supabase project exists now.
6. **All migrations are hand-run by you** in the Supabase SQL editor — each phase will
   hand you a numbered `.sql` file and wait for your "applied" before the code that needs
   it merges. Note the `20260709` perf-index migration is still listed as unapplied in
   `PROJECT_CONTEXT.md` — worth applying while you're in there, and Phase 1's event-table
   indexes will follow the same route.
7. **`sent_to_client` / `client_responded` semantics** need the two confirmations flagged
   in Q3's table (publishAssets double-emission; asset-level responses excluded).
8. **Stale doc note:** `HANDOFF.md` says the repo lives at `~/dev/prometheus-crm`; the
   only clone on this machine is `~/prometheus-crm`.

---

## Decisions needed from Giovane before Phase 1

| # | Question | My default if you just say "defaults" |
|---|---|---|
| 1 | Operating timezone for "the 24th" and daily slip scans | — (no default; must answer) |
| 2 | Active-client predicate: `is_active = true`? Trials in? $0-retainer in? | `is_active = true`, trials **in**, retainer ignored |
| 3 | Field categorization: `page_type`, `competitor_reference`, `ad_copy_url`, `target_audience` rulings (⚑ items above) | strategic / creative-only / copy / excluded |
| 4 | Mid-month onboarded clients | wait for next 24th + admin notification (brief's default) |
| 5 | `sent_to_client`: emit on entering `client_review` per track + on `publishAssets`? | yes to both |
| 6 | `client_responded`: project/track-level only, per-asset excluded? | yes |
| 7 | Journey name convention for auto-generated cards | find-or-create `"<Month> <Year>"` per brand |
| 8 | Vercel plan (Hobby vs Pro) — constrains cron design | daily cron that self-gates on the 24th |
| 9 | Validation on production with a test brand — acceptable? | yes |
