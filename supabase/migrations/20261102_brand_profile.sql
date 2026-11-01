-- Brand page as the source of truth for a client: points of contact, how they
-- like to be reached, the onboarding call, typed files, the client's standing
-- feedback, and a Brand DNA digest of all of it.
--
-- ADDITIVE ONLY. New tables and nullable/defaulted columns; nothing existing is
-- changed or dropped. Safe to re-run.

BEGIN;

-- ── How the client wants to be reached ─────────────────────────────────────
ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS preferred_channel TEXT
  CHECK (preferred_channel IN ('email', 'whatsapp', 'slack', 'phone', 'sms', 'other'));
-- Where exactly, and any habits: "Slack Connect #acme-mm, replies mornings EST".
ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS channel_details TEXT;
-- What the client answered on intake, pasted or typed. The intake form file
-- itself, if there is one, is a brand_documents row of kind 'intake'.
ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS intake_answers TEXT;
-- The onboarding call: pasted transcript and/or a link to the recording.
-- 20260701_add_onboarding_transcript.sql was never applied to live.
ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS onboarding_transcript TEXT;
ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS onboarding_call_url TEXT;

-- ── Points of contact ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.brand_contacts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id     UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  name         TEXT NOT NULL CHECK (btrim(name) <> ''),
  role         TEXT,                 -- "Founder", "Approves offers", ...
  email        TEXT,
  phone        TEXT,
  is_primary   BOOLEAN NOT NULL DEFAULT false,
  notes        TEXT,                 -- "Signs off on anything with a discount"
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_brand_contacts_brand ON public.brand_contacts (brand_id, sort_order);

-- ── File types ─────────────────────────────────────────────────────────────
-- guidelines: the brand book every client should have. contract: the signed SOW.
-- intake: their intake form. other: anything else they send.
-- Every file on live so far came through the "brand guidelines" panel, so those
-- start as guidelines; new rows default to other.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'brand_documents' AND column_name = 'kind'
  ) THEN
    ALTER TABLE public.brand_documents ADD COLUMN kind TEXT NOT NULL DEFAULT 'guidelines';
    ALTER TABLE public.brand_documents ALTER COLUMN kind SET DEFAULT 'other';
  END IF;
END $$;
ALTER TABLE public.brand_documents DROP CONSTRAINT IF EXISTS brand_documents_kind_check;
ALTER TABLE public.brand_documents ADD CONSTRAINT brand_documents_kind_check
  CHECK (kind IN ('guidelines', 'contract', 'intake', 'other'));
UPDATE public.brand_documents SET kind = 'contract'
WHERE id IN (SELECT document_id FROM public.brand_contracts WHERE document_id IS NOT NULL);

-- ── Brand DNA as the one reference ─────────────────────────────────────────
-- client_context: everything the client told us (calls, intake, contract terms,
-- feedback, team notes), digested once at build time so nothing downstream has
-- to read the raw material. built_from: what that build read, so the page can
-- say when new information has arrived instead of rebuilding blindly.
ALTER TABLE public.brand_dna ADD COLUMN IF NOT EXISTS client_context TEXT;
ALTER TABLE public.brand_dna ADD COLUMN IF NOT EXISTS built_from JSONB;

-- ── Client rules ───────────────────────────────────────────────────────────
-- Standing feedback: things the client has told us that apply to everything we
-- make for them, not to one piece. One-off feedback stays on its review.
--
-- area decides where a rule is shown: offers, landing pages, ads, etc.
CREATE TABLE IF NOT EXISTS public.client_rules (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id           UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  area               TEXT NOT NULL DEFAULT 'general'
                     CHECK (area IN ('general', 'offers', 'copy', 'design', 'landing_pages', 'ads', 'video')),
  rule               TEXT NOT NULL CHECK (btrim(rule) <> ''),
  -- The client's reason, when they gave one. Helps judge edge cases.
  why                TEXT,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  retired_reason     TEXT,
  retired_at         TIMESTAMPTZ,
  -- Bumped when the client says it again or someone checks it is still true.
  last_confirmed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by         UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_client_rules_brand ON public.client_rules (brand_id, status, area);

-- Every time the client told us. More than one row means they had to repeat
-- themselves, which is the thing this feature exists to stop, so it is counted
-- and shown rather than merged away.
CREATE TABLE IF NOT EXISTS public.client_rule_mentions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id             UUID NOT NULL REFERENCES public.client_rules(id) ON DELETE CASCADE,
  brand_id            UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  source              TEXT NOT NULL DEFAULT 'other'
                      CHECK (source IN ('review', 'offer', 'call', 'email', 'chat', 'other')),
  -- The client's own words, as close as we have them.
  quote               TEXT,
  project_comment_id  UUID REFERENCES public.project_comments(id) ON DELETE SET NULL,
  project_id          UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  offer_card_id       UUID REFERENCES public.offer_cards(id) ON DELETE SET NULL,
  said_on             DATE NOT NULL DEFAULT current_date,
  noted_by            UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_client_rule_mentions_rule ON public.client_rule_mentions (rule_id, said_on);
CREATE INDEX IF NOT EXISTS idx_client_rule_mentions_comment ON public.client_rule_mentions (project_comment_id);

-- Previous wording of a rule, written by trigger on every change, so an edit
-- can always be traced back to what the client actually said.
CREATE TABLE IF NOT EXISTS public.client_rule_history (
  id          BIGSERIAL PRIMARY KEY,
  rule_id     UUID NOT NULL REFERENCES public.client_rules(id) ON DELETE CASCADE,
  area        TEXT NOT NULL,
  rule        TEXT NOT NULL,
  why         TEXT,
  status      TEXT NOT NULL,
  changed_by  UUID,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_client_rule_history_rule ON public.client_rule_history (rule_id, changed_at DESC);

CREATE OR REPLACE FUNCTION public.client_rules_keep_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (OLD.rule, OLD.area, OLD.why, OLD.status) IS DISTINCT FROM (NEW.rule, NEW.area, NEW.why, NEW.status) THEN
    INSERT INTO public.client_rule_history (rule_id, area, rule, why, status, changed_by)
    VALUES (OLD.id, OLD.area, OLD.rule, OLD.why, OLD.status, NEW.updated_by);
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS client_rules_history ON public.client_rules;
CREATE TRIGGER client_rules_history BEFORE UPDATE ON public.client_rules
  FOR EACH ROW EXECUTE FUNCTION public.client_rules_keep_history();

-- ── RLS: authenticated staff read/write; canEdit() in the app is the gate ──
ALTER TABLE public.brand_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_rule_mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_rule_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS brand_contacts_staff ON public.brand_contacts;
CREATE POLICY brand_contacts_staff ON public.brand_contacts FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS client_rules_staff ON public.client_rules;
CREATE POLICY client_rules_staff ON public.client_rules FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS client_rule_mentions_staff ON public.client_rule_mentions;
CREATE POLICY client_rule_mentions_staff ON public.client_rule_mentions FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- History is read-only from the app; only the trigger writes it.
DROP POLICY IF EXISTS client_rule_history_read ON public.client_rule_history;
CREATE POLICY client_rule_history_read ON public.client_rule_history FOR SELECT TO authenticated USING (true);

COMMIT;
