-- Prometheus 2.0, phase 1: the foundations every service line shares.
--
--   pods               a team that looks after a set of clients
--   pod_members        who is in a pod, and in which role. The account manager
--                      is the pod lead; a pod has at most one.
--   brands.pod_id      the pod that looks after this client
--   work_templates     how a service line is set up (Test, BFCM, Evergreen...):
--                      its deliverables and default tasks, copied into each
--                      piece of work when it is created, so editing a template
--                      never changes work already running
--   work               one piece of work for one client, whatever the service
--   work_deliverables  what the work produces: offer, landing page, creative set.
--                      A test can be landing page only, creatives only, or both.
--   work_tasks         who does what by when. One owner, one due date, one set
--                      of statuses for every service line. Subtasks via parent_id.
--
-- Nothing here touches the existing Moments, BFCM or Evergreen tables. 2.0 runs
-- alongside them until it takes over new work.
--
-- Role and status lists are CHECK lists so the database refuses typos. Widening
-- one later is a new migration; the app shows an unknown value as plain text.
--
-- Safe to re-run. Run in the Supabase SQL editor:
-- https://supabase.com/dashboard/project/mhizyjlvqrhwzjqywiwz/sql/new

BEGIN;

-- ── pods ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pods (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  archived_at TIMESTAMPTZ,
  created_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Two live pods with the same name would be impossible to tell apart in a picker.
CREATE UNIQUE INDEX IF NOT EXISTS pods_name_active_uniq
  ON public.pods (lower(btrim(name))) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS public.pod_members (
  pod_id     UUID NOT NULL REFERENCES public.pods(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('account_manager', 'designer', 'lp_builder')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (pod_id, profile_id, role)
);
CREATE INDEX IF NOT EXISTS pod_members_profile_idx ON public.pod_members (profile_id);
-- The account manager leads the pod: one per pod.
CREATE UNIQUE INDEX IF NOT EXISTS pod_members_one_lead
  ON public.pod_members (pod_id) WHERE role = 'account_manager';

ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS pod_id UUID REFERENCES public.pods(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS brands_pod_idx ON public.brands (pod_id);

-- ── templates ────────────────────────────────────────────────────────────
-- deliverables: [{ "key": "lp", "kind": "landing_page", "label": "Landing page", "optional": true }]
-- tasks:        [{ "key": "lp_build", "title": "Build the page", "deliverable": "lp",
--                  "role": "lp_builder", "days_before_launch": 12, "parent": null }]
-- (checked by the app: src/lib/v2/templates.ts)
CREATE TABLE IF NOT EXISTS public.work_templates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  description  TEXT CHECK (description IS NULL OR length(description) <= 2000),
  deliverables JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(deliverables) = 'array'),
  tasks        JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(tasks) = 'array'),
  sort_order   INTEGER NOT NULL DEFAULT 0,
  archived_at  TIMESTAMPTZ,
  updated_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS work_templates_name_active_uniq
  ON public.work_templates (lower(btrim(name))) WHERE archived_at IS NULL;

-- ── work ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.work (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id     UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  template_id  UUID REFERENCES public.work_templates(id) ON DELETE SET NULL,
  -- The template's name when the work was made, so renaming or archiving a
  -- template never relabels work already done.
  service_line TEXT NOT NULL CHECK (length(btrim(service_line)) BETWEEN 1 AND 80),
  name         TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'on_hold', 'done', 'cancelled')),
  launch_date  DATE,
  -- Copied from the client when the work is made; moving the client to another
  -- pod moves its open work with it (done in the app, not by a trigger).
  pod_id       UUID REFERENCES public.pods(id) ON DELETE SET NULL,
  owner_id     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS work_brand_idx ON public.work (brand_id, status);
CREATE INDEX IF NOT EXISTS work_pod_idx ON public.work (pod_id, status);
CREATE INDEX IF NOT EXISTS work_launch_idx ON public.work (launch_date);

CREATE TABLE IF NOT EXISTS public.work_deliverables (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id      UUID NOT NULL REFERENCES public.work(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('offer', 'landing_page', 'creative_set')),
  label        TEXT NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 80),
  -- Where its review loop stands. Moved by the app as the work is reviewed.
  review_state TEXT NOT NULL DEFAULT 'not_started' CHECK (review_state IN (
    'not_started', 'in_progress', 'internal_review', 'internal_changes',
    'client_review', 'client_changes', 'approved')),
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS work_deliverables_work_idx ON public.work_deliverables (work_id, sort_order);

CREATE TABLE IF NOT EXISTS public.work_tasks (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id        UUID NOT NULL REFERENCES public.work(id) ON DELETE CASCADE,
  deliverable_id UUID REFERENCES public.work_deliverables(id) ON DELETE CASCADE,
  parent_id      UUID REFERENCES public.work_tasks(id) ON DELETE CASCADE,
  -- The template step this came from, so the app can find "the build task".
  key            TEXT CHECK (key IS NULL OR length(key) <= 60),
  title          TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  -- The pod role the template asked for; owner_id is who that turned out to be.
  role           TEXT CHECK (role IS NULL OR role IN ('account_manager', 'designer', 'lp_builder')),
  owner_id       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  due_date       DATE,
  status         TEXT NOT NULL DEFAULT 'todo' CHECK (status IN (
    'todo', 'in_progress', 'waiting_client', 'changes_requested', 'blocked', 'done', 'not_required')),
  sort_order     INTEGER NOT NULL DEFAULT 0,
  started_at     TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS work_tasks_work_idx ON public.work_tasks (work_id, sort_order);
CREATE INDEX IF NOT EXISTS work_tasks_owner_idx ON public.work_tasks (owner_id, status, due_date);
CREATE INDEX IF NOT EXISTS work_tasks_parent_idx ON public.work_tasks (parent_id);
CREATE INDEX IF NOT EXISTS work_tasks_deliverable_idx ON public.work_tasks (deliverable_id);

-- ── access ───────────────────────────────────────────────────────────────
-- Same posture as the rest of the app: signed-in users read and write, the app
-- decides who may change what (canEdit plus the 2.0 checks). No anon access.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['pods', 'pod_members', 'work_templates', 'work', 'work_deliverables', 'work_tasks'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "auth_all_%s" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "auth_all_%s" ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t, t);
  END LOOP;
END $$;

COMMIT;
