BEGIN;

-- Add a free-text column to store the onboarding meeting transcript on the
-- brand record. Populated from the Account Details form (paste or load-from-file).
ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS onboarding_transcript TEXT;

COMMIT;
