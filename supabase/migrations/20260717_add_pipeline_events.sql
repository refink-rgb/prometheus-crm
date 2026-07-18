-- Prometheus Evolution — Phase 1: append-only pipeline event log.
--
-- One row per state change anywhere in the system (Production Cycle today,
-- Offer Cycle from Phase 2). This is the measurement source of truth: card
-- state must be reconstructable by replaying a card's events in order.
--
-- Design rules (from the signed-off Phase 0 discovery):
--   * Append-only. Corrections are compensating events, never mutations —
--     enforced by a trigger below, which even the service role can't bypass.
--   * No FKs to projects/brands ON PURPOSE: events must survive card/brand
--     deletion (deleteProject/deleteBrand hard-delete rows today).
--   * Writes go through the service role only (src/lib/events.ts + cron
--     routes). Anon/authenticated get read-only via RLS.

BEGIN;

CREATE TABLE IF NOT EXISTS public.pipeline_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type  TEXT NOT NULL CHECK (event_type IN
                ('stage_changed','assigned','sent_to_client','client_responded','slip_recorded')),
  -- 'production' = projects row; 'offer' = Phase 2 offer card.
  card_kind   TEXT NOT NULL DEFAULT 'production' CHECK (card_kind IN ('production','offer')),
  card_id     UUID NOT NULL,
  brand_id    UUID,
  -- NULL = card-level event (e.g. offer cards have no tracks).
  track       TEXT CHECK (track IN ('lp','creative')),
  -- Populated for stage_changed; NULL otherwise.
  from_stage  TEXT,
  to_stage    TEXT,
  -- auth.users id when a session existed; NULL for system/client actors.
  actor_id    UUID,
  -- email | 'system' (cron jobs) | 'client' (token-gated review actions —
  -- mirrors the offer_locked_by = 'client' precedent).
  actor_label TEXT NOT NULL,
  -- Event-type-specific fields: assignee ids, response_type, slip deltas,
  -- marketing_moment/journey context, etc.
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Query patterns (Phase 0 Q-list): (a) all events for a card in order,
-- (b) all events of a type in a time window, (c) all events for a brand
-- in a time window.
CREATE INDEX IF NOT EXISTS idx_pipeline_events_card  ON public.pipeline_events (card_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pipeline_events_type  ON public.pipeline_events (event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_pipeline_events_brand ON public.pipeline_events (brand_id, created_at);

-- Append-only enforcement. RLS doesn't bind the service role, so the
-- guarantee lives in a trigger instead: any UPDATE or DELETE errors out.
CREATE OR REPLACE FUNCTION public.pipeline_events_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'pipeline_events is append-only — log a compensating event instead of mutating (%).', TG_OP;
END $$;

DROP TRIGGER IF EXISTS pipeline_events_no_mutation ON public.pipeline_events;
CREATE TRIGGER pipeline_events_no_mutation
BEFORE UPDATE OR DELETE ON public.pipeline_events
FOR EACH ROW EXECUTE FUNCTION public.pipeline_events_append_only();

-- RLS: team reads, nobody writes through PostgREST. The service role (event
-- logger + cron) bypasses RLS for inserts; the trigger above still applies.
ALTER TABLE public.pipeline_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pipeline_events_select" ON public.pipeline_events;
CREATE POLICY "pipeline_events_select" ON public.pipeline_events
  FOR SELECT TO authenticated USING (TRUE);

-- No INSERT/UPDATE/DELETE policies on purpose.

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFY (run after applying):
--   INSERT INTO public.pipeline_events (event_type, card_id, actor_label)
--   VALUES ('stage_changed', gen_random_uuid(), 'migration-smoke-test');
--   UPDATE public.pipeline_events SET actor_label = 'x'
--   WHERE actor_label = 'migration-smoke-test';   -- MUST fail (append-only trigger)
--   DELETE FROM public.pipeline_events
--   WHERE actor_label = 'migration-smoke-test';   -- MUST fail too; the smoke row
--                                                 -- stays, which is fine (it's inert).
