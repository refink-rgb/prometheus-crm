# Project context for future Claude sessions

Handoff notes — read this before starting work on Prometheus CRM. Written
2026-07-09 by a prior Claude session for continuity across accounts.

## What this is

Prometheus CRM — internal tool for a marketing agency to manage brands
(clients), projects (marketing moments per brand), briefs, creative
assets, review flows, and financials. Used by a small team; not a public
product. Auth-gated; `canEdit(user.email)` in `src/lib/permissions.ts`
gates every mutating server action.

## Stack

- **Next.js 16.2.6** with the **App Router**. Turbopack in dev and prod.
  Not the Next.js you have in training data — check
  `node_modules/next/dist/docs/` for API shape before writing code.
  Notable: `middleware.ts` is deprecated in favor of `proxy.ts` (warning
  fires on build; not yet renamed).
- **React 19.2.4**
- **Supabase**: Postgres + Storage + Auth. Server client in
  `src/lib/supabase/server.ts` uses `cookies()`. Browser client for
  uploads.
- **Tailwind 4** + heavy CSS custom-properties for the theme system
  (light/dark toggle in `layout.tsx` — inline script avoids hydration
  flash).
- **OpenAI SDK** (`openai@6`) — used server-side only for
  `gpt-image-2`-based creative revision (`applyAiEdits` /
  `applyDirectPrompt` in `actions.ts`). No `@anthropic-ai/sdk` in the
  repo (yet — see Brand DNA plan below).
- **DnD Kit** for kanban drag-drop.
- **Recharts** for the dashboard chart.

## Architecture

- **Server components first.** Almost all data fetching happens in async
  `page.tsx` server components. Client components handle interaction
  only — no `useEffect(fetch)` anywhere.
- **Server actions** in `src/lib/actions.ts` (1400+ lines, big file).
  All mutating logic gated by `canEdit()`.
- **RLS** on all Supabase tables: authenticated users have full
  read/write; auth is done at the app layer via `canEdit`.
- **Storage bucket**: `project-images` (public read). Contains all
  uploaded images regardless of context (product images, note
  attachments, creative assets). Path conventions differ per feature.
- **Google Drive integration** for creative assets — see
  `moveDriveFile`, `ensureDeleteSubfolder`, `extractDriveFolderId` in
  `actions.ts`. Uses `google-auth-library` server-side.

## Peculiarities (things that will bite you)

1. **`supabase/schema.sql` is stale** relative to the live production
   DB. It only shows `brands`, `projects`, `project_images` with an old
   column set. Real production has `creative_assets`, `project_comments`,
   `journeys`, `note_attachments`, `profit_engineers`, plus many
   additional columns on `brands` (pipeline_status, monthly_retainer,
   is_active, is_trial, brand_notes, onboarding_transcript,
   client_token, client_number, start_date, growth_strategist,
   profit_engineer, created_by) and on `projects`. **Always check
   the actual DB or existing action code — do not trust schema.sql.**
2. **Migrations in `supabase/migrations/` are partial history.** Not
   every schema change was captured — some were run ad-hoc in the
   Supabase dashboard.
3. **`updateBrandDetails`** has a graceful fallback for the
   `onboarding_transcript` column being absent (Postgres 42703). Kept
   for the case where migration wasn't yet applied. See lines around
   288-297 in `actions.ts`.
4. **`ProjectEditForm.tsx` is uncontrolled by design.** Fields use
   `defaultValue` + name + FormData on save (not `useState` per field).
   This was intentional after a re-render perf fix — do not "correct"
   it back to controlled inputs without understanding why. Copy banks
   (headlines/subcopies/eyebrows) and MomentPicker are separate memoized
   subcomponents.
5. **`page.tsx` at brand + project level has `export const maxDuration
   = 300`** — the AI image-edit server actions run 60-90s and hit
   default Vercel timeouts otherwise.
6. **Type casts via `unknown`** appear on Supabase result objects (e.g.
   `as unknown as PipelineProject[]`) — TS can't infer the shape of
   narrowed selects with nested relations. This is intentional; don't
   spend time trying to fully type it.

## Recent work (2026-07-09) — status: pushed to `main`

Two chunks shipped this week, both by the previous Claude session:

### 1. Brand DNA feature — PLANNED, NOT SHIPPED

A plan exists at
`~/.claude/plans/plan-mode-prompt-async-hopcroft.md`
(overwritten later — see below). The feature: add 4 structured fields
to brands (Font, Colors, Photography Style, Logo) displayed in Account
Details, plus a "Generate Brand DNA" button that calls Anthropic API
(web_search + web_fetch tools) to auto-populate 3 of them. Logo is
manual (image upload via Supabase Storage). Sync server action with
`maxDuration=300`. Requires new `@anthropic-ai/sdk` dep and
`ANTHROPIC_API_KEY` env var. **The plan file was later overwritten by
the perf plan — you'll need to re-derive from this doc if you pick it
up.** No code was written for Brand DNA. If asked to build it, ask the
user for approval to re-plan.

### 2. Performance pass — SHIPPED (commits `179ef37`, `df337ef`)

Ten blocks — see file changes on `main`:

1. **DB indexes migration**:
   `supabase/migrations/20260709_add_perf_indexes.sql` — 17 indexes on
   FK + sort columns. **⚠ NOT YET APPLIED to production DB — user
   needs to run it in Supabase SQL editor.** Everything else is
   deployed but queries are still doing seq scans until this lands.
2. Fixed N+1s in `publishAssets` and `purgeStaleAssets` /
   `_archiveAssetCore` (`actions.ts`).
3. Trimmed `select('*')` on hot pages (dashboard, brands list,
   financials, brand page, project page). See commit `df337ef` — an
   over-trim on the brands list was fixed after a user screenshot
   showed all cards as "Inactive"; `BrandCard.tsx` was reading
   `is_active`/`is_trial`/`monthly_retainer`. **Rule: grep every
   consumer component, not just the top-level view, before trimming.**
4. Removed `revalidatePath('/')` from mutations that don't affect
   dashboard-visible data. Rule encoded as comment near top of
   `actions.ts`.
5. `next.config.ts`: `optimizePackageImports` for
   lucide/recharts/dnd-kit, `images.remotePatterns` for Supabase
   Storage + Google Drive, `compress`, `poweredByHeader:false`.
6. `ProjectEditForm` re-render storm fix (see peculiarity #4 above).
7. Raw `<img>` → `loading="lazy"` + `decoding="async"` on all 11
   tags (kept as `<img>`; did not migrate to `next/image` yet).
8. `loading.tsx` skeletons for `(app)`, brand page, project detail.
9. **Skipped** — Block 9 (decompose `InternalReviewPanel.tsx` 955
   lines / `CreativeAssetsManager.tsx` 687 lines). Plan flagged as
   optional; user hasn't asked for it.
10. Turbopack in dev script.

## LP preview (client review) — scroll gotcha (2026-09-02)

The client-facing landing page preview (`LpReviewPanel.tsx` → `DeviceFrame`)
renders the LP in a sandboxed iframe at a true 1440px viewport and CSS-scales
it down. A transform only changes painting, not layout: the iframe's layout
box stays ~1500px tall inside a wrapper sized to the scaled height. A wrapper
with `overflow: hidden` is still a scroll container that scripts can scroll,
and Chrome carries scroll-into-view requests out of the sandboxed frame into
the parent's scroll containers. When an LP script focused or scrolled to an
element in its last screenful (footer signup forms, chat widgets), the wrapper
was scrolled by the leftover ~700px, shifting the iframe up: reviewers saw a
short strip of page over a blank white box. Fix: every box around the iframe
uses `overflow: clip` (forbids programmatic scrolling) with an `onScroll`
reset as fallback, and the preview bridge drops `scrollIntoView` / scrolling
`focus()` calls until the reviewer interacts with the page. Keep it that way
when touching the frame markup; do not switch those wrappers back to `hidden`.

## Open pending items

- **Apply the index migration** (blocking bigger perf wins).
- **Brand DNA feature** — planned, no code.
- **Rename `middleware.ts` → `proxy.ts`** (Next 16 deprecation warning
  on every build).
- **Block 9**: decompose the two monolith review components — optional.
- **`InternalReviewPanel.tsx` (955 lines) and `CreativeAssetsManager.tsx`
  (687 lines)** are the largest client components and likely the next
  target if perf regressions appear.

## Key files / where to look

- `src/lib/actions.ts` — every server action, 1450+ lines. Big but
  organized by feature (brands → projects → assets → comments →
  notes → downloads).
- `src/lib/types.ts` — Supabase row shapes. Kept in sync manually with
  the live DB.
- `src/lib/permissions.ts` — `canEdit(email)` gate.
- `src/lib/supabase/server.ts` + `client.ts` — SSR + browser clients.
- `src/app/(app)/` — authed app group.
- `src/app/(public)/` — token-gated public review + portal pages.
- `src/middleware.ts` — auth-gate at request boundary. Will need
  renaming to `proxy.ts` eventually.
- `supabase/migrations/` — partial migration history. Newer changes
  are here; the initial schema lives (stale) in `supabase/schema.sql`.

## User collaboration notes

- User is a solo operator on this codebase; senior enough to review
  and push back but not deeply technical about Next.js internals.
- Prefers concise responses. When asked "why is X slow?" — give the
  short honest answer, not a full essay.
- OK with autonomous multi-step execution; will interrupt when they
  want you to stop.
- Screenshots for bug reports (see the "Inactive brands" example).
  When one lands, check it before assuming what's broken.
- Deploys via Vercel; production URL is `prometheus-crm-psi.vercel.app`.

## Environment

- macOS (darwin 25.5.0), zsh
- Repo at `/Users/giovanerachesilva/prometheus-crm` on this machine —
  path will differ on a new machine
- Git remote: `https://github.com/refink-rgb/prometheus-crm.git`,
  default branch `main`
- Git user on prior sessions: `giovane-cyber`
