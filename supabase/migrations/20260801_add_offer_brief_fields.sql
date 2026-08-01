-- Offer Cycle: the three "why are we doing this" brief fields.
--
-- Added to the Offer Draft so a card carries its own rationale — the problem
-- it exists to solve, the metric that decides whether it worked, and the
-- limits it must stay inside. Previously all of that lived in people's heads
-- (or Slack) and was gone by the time the moment was reviewed.
--
-- All nullable on purpose. Offer cards are auto-generated empty by the monthly
-- trigger (stage 'auto_generated', every field NULL), so NOT NULL here would
-- break card creation outright. These are optional at every stage — no DB
-- constraint and no stage gate.
--
-- Success criterion is deliberately TWO columns rather than one free-text
-- line: the metric name stays sortable/groupable, and the target stays a real
-- number so it can be compared against actuals later without parsing prose.

BEGIN;

ALTER TABLE public.offer_cards
  -- "Problem we're solving" — a short 2-line statement.
  ADD COLUMN IF NOT EXISTS problem_statement TEXT,
  -- "How we'll judge it" — the metric ('Purchase conversion rate') …
  ADD COLUMN IF NOT EXISTS success_metric TEXT,
  -- … and its target. NUMERIC, not TEXT: unit-free so it fits %, $, or a
  -- count, and the label above carries the unit.
  ADD COLUMN IF NOT EXISTS success_target NUMERIC,
  -- "Guardrails" — one bullet per line, stored as newline-separated text.
  -- Plain TEXT rather than TEXT[]: it round-trips through the uncontrolled
  -- textarea/FormData pattern the offer form already uses without a
  -- serialization step on either side.
  ADD COLUMN IF NOT EXISTS guardrails TEXT;

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFY (run after applying):
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'offer_cards'
--     AND column_name IN ('problem_statement','success_metric','success_target','guardrails');
--   -- four rows expected, all is_nullable = 'YES'.
