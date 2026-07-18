# Phase 3 validation checklist (Trigger A + Trigger B)

Prereqs: migrations `20260717`, `20260718`, **`20260719`** applied; `CRON_SECRET` set in Vercel; latest deploy live.

## Trigger A — monthly generation (do this once, it doubles as the real August run)

```bash
# 1. Force a generation run (creates AUGUST cards now — they're the real ones,
#    they just exist a few days early; the actual 24th run will skip them):
curl -H "Authorization: Bearer YOUR_SECRET" "https://prometheus-crm-psi.vercel.app/api/cron/daily?force_generate=1"
```

Expect in the JSON: `offer_generation.cards_created` = 2 × your active-client count, `cards_already_existed` = 0 (or however many you'd created by hand).

```bash
# 2. Run it AGAIN immediately — idempotency check:
curl -H "Authorization: Bearer YOUR_SECRET" "https://prometheus-crm-psi.vercel.app/api/cron/daily?force_generate=1"
```

Expect: `cards_created: 0`, `cards_already_existed` = the full count. Then open **/offers** — every active client should have `[Brand] · August 2026 · M1 Offer` and `· M2 Offer` sitting in **Auto Generated**.

Without `?force_generate=1` the cron only generates when it's the 24th in US Eastern — the scheduled 06:00 UTC run on July 24 does it automatically.

## Trigger B — approval → production card

1. Create a test offer card (test brand, any month), fill a few Offer Draft fields (offer, product, retail price…), drag it to **Approved**.
2. On the offer detail page: a green **"✓ Production card created — Open it →"** banner appears.
3. Open the production card and verify:
   - It's at **Brief** on both tracks, in a journey named like `August 2026`.
   - Strategic fields carry the offer's values (offer dynamics, offer, offer description, product featured, product description, retail price, page type).
   - Copy fields (headline, body, CTA, ad copy banks) are **blank**.
   - Creative-only fields (competitor reference, ad inspiration, images link) are **blank**.
4. Linkage both ways (SQL editor):
   ```sql
   SELECT o.name, o.derived_production_card_id, p.id, p.source_offer_card_id
   FROM offer_cards o JOIN projects p ON p.source_offer_card_id = o.id
   WHERE o.stage = 'offer_approved';
   ```
   Each row: `derived_production_card_id = p.id` and `source_offer_card_id = o.id`.
5. Idempotency: drag the offer out of Approved and back in — still exactly one production card.
6. Failure mode: the "fail loud" path can't be safely forced in prod. Its nets: a creation failure throws a visible error in the UI, error-logs with the `[offer-to-production] ALERT` prefix, and every daily cron run lists any approved-but-unlinked offer in its `alerts` array (also error-logged). To see it working, check the cron response's `alerts: []` is empty after your tests.

## Defaults Claude chose (flag if wrong — both are PM-editable per card)

- Auto-created production cards are named `[Month Year] · M[1|2] Moment`.
- Their LIVE due date defaults to the **15th** (M1) / **last day** (M2) of the target month.

## Kill switches (Vercel env, no deploy needed beyond redeploy)

- `PROMETHEUS_AUTOCREATE_DISABLED=1` — offers still reach Approved, production cards stop spawning.
- `PROMETHEUS_EVENTS_DISABLED=1` — all event logging + slip scan off.
