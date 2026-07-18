# Vercel setup — Phase 1 (event tracking)

What you need to do in the Vercel dashboard after this deploy. ~5 minutes.

## 1. Add the `CRON_SECRET` environment variable (required)

The daily cron route refuses every request that doesn't carry this secret.
Vercel automatically attaches it to its own cron invocations once the env var
exists — you just have to create it.

1. Vercel dashboard → **prometheus-crm** project → **Settings → Environment Variables**
2. Add:
   - **Name:** `CRON_SECRET`
   - **Value:** any long random string. Easy way to make one — run in your Mac terminal:
     ```
     openssl rand -hex 32
     ```
     and paste the output.
   - **Environments:** Production (Preview/Development don't matter — we don't use them)
3. Save. **Then redeploy** (Deployments → latest → ⋯ → Redeploy) — env vars only
   apply to deployments made after they're added. If you add the variable before
   the auto-deploy from this push finishes, you're already covered.

Nothing else to create: `SUPABASE_SERVICE_ROLE_KEY` and the Supabase URL are
already in Vercel from the creative API work.

## 2. Confirm the cron job appeared

After the deploy: project → **Settings → Cron Jobs** (or the **Crons** tab).
You should see one entry:

| Path | Schedule |
|---|---|
| `/api/cron/daily` | `0 6 * * *` (06:00 UTC = 1–2am Eastern, daily) |

If the tab says crons aren't available on your plan, tell Claude — there's a
fallback design (external pinger), but on Hobby one daily cron is within limits.

## 3. Test the cron by hand (after the migration is applied)

From your Mac terminal, using the same secret you created:

```
curl -H "Authorization: Bearer YOUR_SECRET_HERE" https://prometheus-crm-psi.vercel.app/api/cron/daily
```

Expected response, something like:

```json
{ "ok": true, "date_eastern": "2026-07-17", "open_projects": 26, "slips_recorded": 4 }
```

Run it twice — the second run must report `"slips_recorded": 0` (same-day dedupe;
that's the idempotency working). Without the header you should get a 401.

## 4. The kill switch (only if something misbehaves)

If event logging ever causes trouble in production, add env var
`PROMETHEUS_EVENTS_DISABLED` = `1` and redeploy. All instrumentation goes
silent (the pipeline keeps working exactly as before Phase 1); remove the
variable to re-enable. No code changes needed either way.

## Reminder: the SQL migration comes first

Events only start landing once you've run
`supabase/migrations/20260717_add_pipeline_events.sql` in the
[Supabase SQL editor](https://supabase.com/dashboard/project/mhizyjlvqrhwzjqywiwz/sql/new).
Until then the app runs normally and just logs a warning server-side for each
event it couldn't write. After it's applied, validate end-to-end:

1. Move any test card through 3 stages in the UI.
2. Open `https://prometheus-crm-psi.vercel.app/api/events/replay?project=<that project's uuid>`
   while logged in — expect `"match": true` and `stage_events_replayed` ≥ 3.
