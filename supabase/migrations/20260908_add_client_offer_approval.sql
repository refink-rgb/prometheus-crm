-- Client-facing offer approval.
--
-- An offer in Client Review is pitched to the client on a link keyed by the
-- brand's existing client_token (the same token behind /portal). The client
-- either approves it — which moves the card to Offer Approved and spawns the
-- production card, exactly as a staff approval does — or asks for changes,
-- which records their note and LEAVES the card in Client Review for the team
-- to decide what to do.
--
-- Deliberately separate from the internal approval columns added in 20260907:
-- those two sign-offs gate Internal Review and are cleared on re-approval,
-- while these record an external party's answer and must survive as an audit
-- trail. Reusing them would make "who approved this" ambiguous.
--
-- No new token: brands.client_token already exists and is minted the same way
-- (crypto.randomBytes(20) → 40-char hex) by generateClientToken().

BEGIN;

ALTER TABLE public.offer_cards
  ADD COLUMN IF NOT EXISTS client_approved_at             TIMESTAMPTZ,
  -- The name the client typed when approving. Not an FK — they have no account.
  ADD COLUMN IF NOT EXISTS client_approved_by             TEXT,
  ADD COLUMN IF NOT EXISTS client_changes_requested_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS client_changes_requested_by    TEXT,
  ADD COLUMN IF NOT EXISTS client_changes_requested_note  TEXT;

-- The client page looks brands up by token on every load.
CREATE INDEX IF NOT EXISTS idx_brands_client_token
  ON public.brands (client_token);

COMMIT;

-- VERIFY:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'offer_cards' AND column_name LIKE 'client_%';
--   -- client_approval_message plus the five columns above.
