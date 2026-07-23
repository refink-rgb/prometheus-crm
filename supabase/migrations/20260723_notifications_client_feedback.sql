BEGIN;

-- Allow a third notification type: 'client_feedback' — emitted when a client
-- comments, requests a revision, or approves on the public review link. The
-- recipient is the track's assigned editor (see actions.ts). actor_id stays
-- NULL for these (the client is not a profile), which the existing nullable
-- actor_id column already permits.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
    CHECK (type IN ('assigned','mentioned','client_feedback'));

COMMIT;
