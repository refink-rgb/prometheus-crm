-- BFCM production: a "Not required" task status, for tasks a brand doesn't need.
-- Additive: widens the CHECK list only; the code already deployed never writes it.
BEGIN;
ALTER TABLE public.bfcm_production_steps DROP CONSTRAINT IF EXISTS bfcm_production_steps_status_check;
ALTER TABLE public.bfcm_production_steps ADD CONSTRAINT bfcm_production_steps_status_check
  CHECK (status IN ('todo','in_progress','waiting_client','done','not_required'));
COMMIT;
