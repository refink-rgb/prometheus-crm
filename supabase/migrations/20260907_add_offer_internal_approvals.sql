-- Internal offer approval: a per-profit-engineer link, and the two sign-offs.
--
-- An offer in Internal Review needs two approvals before it can go to the
-- client: the strategist side (Lucas or Roberto) and the brand's profit
-- engineer. Both are recorded here; the second one to land advances the card
-- to Client Review. Requesting changes sends it back to Offer Draft and
-- clears both, so a re-submitted offer is re-approved from scratch.
--
-- Design rules (mirror the client-review share_token model):
--   * `approval_token` is an unguessable 40-char hex string, minted exactly
--     like projects.share_token. The token IS the capability — the public page
--     (/approvals/<token>) reads via the SERVICE ROLE, so no anonymous RLS
--     read policy is needed.
--   * Anyone holding the link can record either approval. That is the same
--     trust model as the client review link: unguessable, not identity-aware.
--     Who approved is captured as a name so the record is still attributable.

BEGIN;

-- Profit engineers predate this migrations directory, so everything here is
-- written to be safe against whatever shape the table is already in.
CREATE TABLE IF NOT EXISTS public.profit_engineers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- brands.profit_engineer stores the NAME, so the name is the join key and has
-- to be unique for the link to resolve to exactly one engineer.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profit_engineers'::regclass
      AND contype = 'u'
      AND conname = 'profit_engineers_name_key'
  ) THEN
    ALTER TABLE public.profit_engineers
      ADD CONSTRAINT profit_engineers_name_key UNIQUE (name);
  END IF;
END $$;

ALTER TABLE public.profit_engineers
  ADD COLUMN IF NOT EXISTS approval_token TEXT;

-- New engineers get a link automatically; existing rows are backfilled below.
ALTER TABLE public.profit_engineers
  ALTER COLUMN approval_token SET DEFAULT encode(gen_random_bytes(20), 'hex');

UPDATE public.profit_engineers
   SET approval_token = encode(gen_random_bytes(20), 'hex')
 WHERE approval_token IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profit_engineers'::regclass
      AND contype = 'u'
      AND conname = 'profit_engineers_approval_token_key'
  ) THEN
    ALTER TABLE public.profit_engineers
      ADD CONSTRAINT profit_engineers_approval_token_key UNIQUE (approval_token);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_profit_engineers_approval_token
  ON public.profit_engineers (approval_token);

-- The two sign-offs, plus the change request that resets them. Nullable: an
-- offer carries none of this until someone acts on it.
ALTER TABLE public.offer_cards
  ADD COLUMN IF NOT EXISTS strategist_approved_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS strategist_approved_by  TEXT,
  ADD COLUMN IF NOT EXISTS engineer_approved_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS engineer_approved_by    TEXT,
  ADD COLUMN IF NOT EXISTS changes_requested_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS changes_requested_by    TEXT,
  ADD COLUMN IF NOT EXISTS changes_requested_note  TEXT;

-- The approval page filters to one stage; brands are joined by engineer name.
CREATE INDEX IF NOT EXISTS idx_offer_cards_stage
  ON public.offer_cards (stage);
CREATE INDEX IF NOT EXISTS idx_brands_profit_engineer
  ON public.brands (profit_engineer);

-- RLS: authenticated staff read/write as everywhere else in the app. The
-- public approval page uses the service role and is gated by the token, so
-- there is intentionally NO anon policy.
ALTER TABLE public.profit_engineers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profit_engineers_rw_auth" ON public.profit_engineers;
CREATE POLICY "profit_engineers_rw_auth" ON public.profit_engineers
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;

-- VERIFY:
--   SELECT name, approval_token FROM public.profit_engineers ORDER BY name;
--   -- every row has a 40-char hex token.
--
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'offer_cards'
--      AND column_name LIKE '%approved%' OR column_name LIKE '%changes_requested%';
--   -- seven rows expected.
