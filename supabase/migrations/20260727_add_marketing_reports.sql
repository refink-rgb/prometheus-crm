-- Marketing moment reports — anonymized public case-study pages generated from a
-- completed project.
--
-- A completed project can be turned into a public "marketing moment report" (the
-- conversion-focused case study we send prospects over Slack). The report's
-- content + metrics are authored at generation time (the CRM stores no paid-media
-- metrics) and frozen into `data` as a JSON snapshot shaped like the app's
-- CaseStudy type (src/data/case-studies/types.ts).
--
-- Design rules (mirror the client-review share_token model):
--   * `report_token` is an unguessable 40-char hex string (crypto.randomBytes(20)),
--     minted exactly like projects.share_token. The token IS the capability — the
--     public page (/showcase/<token>) reads the row via the SERVICE ROLE, so no
--     anonymous RLS read policy is needed.
--   * ANONYMIZATION is enforced in the app before insert (creatives relabelled,
--     brand-name leak guard). `data` must never contain the brand name.
--   * One report per project (unique project_id) — regenerating overwrites.

BEGIN;

CREATE TABLE IF NOT EXISTS public.marketing_reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The source project. Cascade so deleting a project cleans up its report.
  project_id    UUID NOT NULL UNIQUE REFERENCES public.projects(id) ON DELETE CASCADE,
  -- Unguessable public slug (= the route). Minted like projects.share_token.
  report_token  TEXT NOT NULL UNIQUE,
  -- Frozen, anonymized CaseStudy snapshot rendered by the public page.
  data          JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Public page looks up by token; the Marketing tab looks up by project.
CREATE INDEX IF NOT EXISTS idx_marketing_reports_token
  ON public.marketing_reports (report_token);
CREATE INDEX IF NOT EXISTS idx_marketing_reports_project
  ON public.marketing_reports (project_id);

-- RLS: authenticated staff have full read/write (matches the app's model where
-- canEdit() is the real gate). Anonymous public reads happen via the service
-- role in the page (token-gated), so there is intentionally NO anon policy.
ALTER TABLE public.marketing_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "marketing_reports_rw_auth" ON public.marketing_reports;
CREATE POLICY "marketing_reports_rw_auth" ON public.marketing_reports
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFY (run after applying):
--   SELECT table_name FROM information_schema.tables
--   WHERE table_name = 'marketing_reports';   -- one row expected.
--   SELECT policyname FROM pg_policies WHERE tablename = 'marketing_reports';
