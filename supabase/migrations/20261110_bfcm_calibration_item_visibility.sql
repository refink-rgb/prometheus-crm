-- BFCM calibration: show or hide single samples on the client link.
-- Additive. Every existing sample stays visible (default true), so the client
-- link looks the same until someone unticks a file. The Drive sync never
-- writes this column, so a re-sync can't bring a hidden file back.
ALTER TABLE public.bfcm_calibration_items
  ADD COLUMN IF NOT EXISTS client_visible boolean NOT NULL DEFAULT true;
