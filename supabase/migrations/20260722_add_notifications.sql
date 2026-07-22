-- Phase 3 — in-app notifications (assignment + @mention).
--
-- A per-recipient inbox feed. Two producers today:
--   * assignProjectEditor  → type 'assigned'  (you were made LP/Creative editor)
--   * addInternalNote      → type 'mentioned' (someone @mentioned you in a note)
--
-- Design rules (mirrors pipeline_events):
--   * Writes go through the service role only (src/lib/notifications.ts). There
--     is deliberately NO insert policy — a client must never be able to forge a
--     notification for someone else.
--   * Reads/updates are RLS-scoped to the recipient: you only ever see and
--     touch your own rows.
--   * No FK to projects/brands ON PURPOSE: deleteProject/deleteBrand hard-delete
--     rows, and a stale notification should just 404 on click, not block the
--     delete. The denormalized title/body/link keep the bell join-free.

BEGIN;

CREATE TABLE IF NOT EXISTS public.notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Who receives it. Cascade so removing a teammate cleans up their inbox.
  recipient_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Who caused it (nullable = system). SET NULL so the notification survives
  -- the actor leaving the team.
  actor_id      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_label   TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('assigned','mentioned')),
  -- Context for rendering + navigation. No FKs (see header).
  project_id    UUID,
  brand_id      UUID,
  comment_id    UUID,
  title         TEXT NOT NULL,
  body          TEXT,
  link          TEXT,
  -- NULL = unread. Set to NOW() when the recipient opens the inbox.
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The bell's only query: this recipient's rows, newest first, with a fast
-- unread count.
CREATE INDEX IF NOT EXISTS idx_notifications_recipient
  ON public.notifications (recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON public.notifications (recipient_id) WHERE read_at IS NULL;

-- RLS: recipient-scoped read + update (mark read) + delete (dismiss).
-- No INSERT policy — the service role inserts and bypasses RLS.
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own" ON public.notifications
  FOR SELECT TO authenticated USING (recipient_id = auth.uid());

DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own" ON public.notifications
  FOR UPDATE TO authenticated
  USING (recipient_id = auth.uid())
  WITH CHECK (recipient_id = auth.uid());

DROP POLICY IF EXISTS "notifications_delete_own" ON public.notifications;
CREATE POLICY "notifications_delete_own" ON public.notifications
  FOR DELETE TO authenticated USING (recipient_id = auth.uid());

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFY (run after applying):
--   -- Insert one for yourself (service role / SQL editor bypasses the missing
--   -- insert policy):
--   INSERT INTO public.notifications (recipient_id, actor_label, type, title)
--   SELECT id, 'migration-smoke-test', 'mentioned', 'Smoke test' FROM public.profiles LIMIT 1;
--   -- As that user, SELECT * FROM public.notifications; -- returns only their rows.
--   DELETE FROM public.notifications WHERE actor_label = 'migration-smoke-test';
