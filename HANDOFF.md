# Prometheus CRM — Handoff (AI creative review loop)

> Read this first. Same Mac user, different Claude account = all files, `~/.ad-lab`, `~/.claude` memory, gh auth, and Supabase creds are already shared. Nothing to copy.

## Where things live
- **Repo:** `~/dev/prometheus-crm` (cloned **off iCloud** — do NOT use `~/Desktop/prometheus-crm`; iCloud "Desktop & Documents" deadlocks `next dev`).
- **GitHub:** `refink-rgb/prometheus-crm`. **Deploy: merge to `main` → Vercel auto-deploys to production** (`prometheus-crm-psi.vercel.app`). `gh` is authed as `refink-rgb`.
- **Supabase:** SAME project as creative-generator (`mhizyjlvqrhwzjqywiwz`). CRM tables: `brands`, `projects`, `creative_assets`, `project_comments`, `project_images`.
- **Secrets:** the CRM's local `.env.local` is a placeholder (real creds are in Vercel). For **direct DB ops** use `~/dev/creative-generator/.env.local` — it has the same Supabase URL + service key + OpenAI key.
- **No CLI DDL access** — schema migrations are run by the USER in the Supabase SQL Editor (`https://supabase.com/dashboard/project/mhizyjlvqrhwzjqywiwz/sql/new`).
- **Testing:** the CRM needs auth + the live DB, so it's hard to run locally. Verify via `npx tsc --noEmit` + the Vercel production deploy (not a local dev server).
- **Vercel preview deployments:** auth wall ("Vercel Authentication") is OFF — but we don't use previews; we ship straight to `main`.

## The workflow (BUILT & LIVE)
- **Sync** pulls creatives from Google Drive → land **internal-only** (`client_visible=false`).
- **Internal review** in the creatives manager: comment, pin comments to a spot.
- **"Generate revision"** → compiles comments into a prompt → **gpt-image-2** edit → revision replaces the original internally (original kept as a thumbnail). **Skips non-actionable comments** (questions).
- **"Publish to client"** (always-available button) → sets `client_visible=true` + freezes `published_url` to the current revision (or original if as-is). Does **NOT** set status.
- **Client review** (`/review/[token]`) shows only `client_visible=true`, image = `published_url ?? drive original`; client navigates, pins, and **approves/rejects**.
- **Loop:** client comments → Generate revision → Publish again. New edits stay internal until re-published.
- **RULES:** internal-first; **publish ≠ approve** (approve is the client's action); no auto-leak (re-edits internal until re-published); re-sync never un-publishes.

## Schema already added (migrations run)
```sql
alter table creative_assets add column if not exists published_url text;
alter table creative_assets add column if not exists client_visible boolean not null default true;
alter table project_comments add column if not exists audience text not null default 'client';
```

## Key code
- `src/lib/actions.ts`:
  - `applyAiEdits` — comments → gpt-image-2 edit (`size:'auto'`) → `revision_url`. `isActionableComment()` filters out questions.
  - `approveAndPublishRevision` — "publish to client": sets `client_visible=true` (+ `published_url`). Does NOT touch `status`.
  - `syncDriveImages` — new creatives set `client_visible=false` (internal-first); only new ones, so re-sync preserves published.
- `src/components/CreativeAssetsManager.tsx` — internal manager: Generate revision + always-available "Publish to client" button.
- `src/components/ImageReviewPanel.tsx` — client review panel: `imgSrc = published_url ?? drive original`.
- `src/app/review/[token]/page.tsx` — client review page: filters `client_visible=true`.

## DONE / LIVE
gpt-image-2 + skip questions · publish gate (`published_url`) · visibility gate (internal-first) · publish ≠ approve.

## REMAINING (next tasks)
1. **Dedicated "Internal Review" page** mirroring the client review UX (arrow-key nav, pins) — e.g. `/brands/[brandId]/projects/[projectId]/internal-review`, reusing `ImageReviewPanel` with **authed** actions instead of the share token.
2. **Internal vs client comment separation** — tag comments with `audience` ('internal' from internal review, 'client' from client review), filter each surface, and feed only **internal** comments into `applyAiEdits`. (Column exists; UI/actions not wired.)

## Today's data state
- **Cosi Care** (brand `341031c2`) UK project: 2 `$→£` revisions — published + pending client approval.
- **PixieLane** (brand `482ca3a3`) Sweet Land project: 19 logo-free revisions — published + pending client approval.
- 22 assets reset `approved→pending` (publish-≠-approve fix). Test comments deleted (1 Mad Viking from Jun 4 remains). Comments backup: `/tmp/crm_comments_backup.json`.

## Sibling project: creative-generator / Ad Lab
- Separate app at `~/dev/creative-generator`, runs `npm run dev` → `localhost:3000`. See its own `HANDOFF.md`. All committed to `refink-rgb/creative-generator` (private).
- Open item there: fix **Tea With Tae** DNA primary color → sage `#B7BAA6` (was wrongly set to `#108474`, which is the Judge.me widget color, not their brand).
