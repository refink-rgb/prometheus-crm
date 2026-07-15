-- Profiles-backed editor assignment (LP + Creative).
--
-- Until now there was no user table at all: identity lived as denormalized
-- strings in four incompatible shapes (projects.assigned_designer = a name from
-- a hardcoded TS array, brands.growth_strategist = an email, brands.profit_engineer
-- = a name from a lookup table, project_comments.author_name = free text).
-- projects.created_by held a real auth UUID but was never read, because
-- auth.users isn't reachable through the anon key.
--
-- This adds public.profiles as a readable mirror of auth.users, and points both
-- editor slots at it via real FKs.
--
-- ⚠ RUN THIS BEFORE DEPLOYING THE PHASE 4 AUTH CODE. Once canEdit() reads
-- profiles.can_edit, shipping the code without this table locks everyone out.
-- (The 20260709 index migration was never applied — assume nothing.)

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The roster
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.profiles (
  id                 UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email              TEXT NOT NULL UNIQUE,
  full_name          TEXT,
  -- 'admin' can manage the team (see /team); 'member' cannot.
  role               TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  -- Replaces the hardcoded ALLOWED_EDITORS array in src/lib/permissions.ts.
  can_edit           BOOLEAN NOT NULL DEFAULT FALSE,
  -- Capability flags — each editor dropdown lists only the people it applies to.
  is_lp_editor       BOOLEAN NOT NULL DEFAULT FALSE,
  is_creative_editor BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 2. Auto-create a profile when a user is added in the Supabase dashboard.
--    This is what makes "adding a teammate" a one-step operation.
--    SECURITY DEFINER: the trigger fires in the auth schema but writes to public.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- initcap(split_part(email,'@',1)) turns janella@… into 'Janella'. It's a
  -- starting guess only — the /team page is where names get corrected.
  -- lower(): emails are matched case-insensitively everywhere downstream
  -- (permissions.ts lowercases too). Normalising on the way in keeps the
  -- UNIQUE constraint and every later lookup honest.
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, lower(NEW.email), initcap(split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 3. Backfill the existing users
-- ---------------------------------------------------------------------------

INSERT INTO public.profiles (id, email, full_name)
SELECT id, lower(email), initcap(split_part(email, '@', 1))
FROM auth.users
WHERE email IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- Seed access to exactly today's ALLOWED_EDITORS (src/lib/permissions.ts), so
-- nobody gains or loses access when Phase 4 ships. Listed explicitly rather
-- than `SET can_edit = TRUE` for everyone: a blanket grant would hand access to
-- any auth user who isn't on the allowlist (e.g. a leftover test account).
UPDATE public.profiles SET can_edit = TRUE
WHERE lower(email) IN (
  'roberto@commonthreadglobal.com',
  'lucas@commonthreadglobal.com',
  'jan@commonthreadglobal.com',
  'joy@commonthreadglobal.com',
  'giovane@commonthreadglobal.com',
  'aleksandrs@commonthreadglobal.com',
  'ferran@commonthreadglobal.com',
  'jaspen@commonthreadglobal.com',
  'janella@commonthreadglobal.com'
);

-- Janella and Jaspen are the static/creative editors (the old DESIGNERS array).
UPDATE public.profiles SET is_creative_editor = TRUE
WHERE lower(email) IN ('janella@commonthreadglobal.com', 'jaspen@commonthreadglobal.com');

-- ⚠ CONFIRM BEFORE RUNNING: admins are the only ones who can manage the team.
-- Edit this list if it's wrong.
UPDATE public.profiles SET role = 'admin'
WHERE lower(email) IN ('giovane@commonthreadglobal.com', 'roberto@commonthreadglobal.com');

-- NOTE: no is_lp_editor is seeded — there are no LP editors today. Flag them on
-- the /team page once it ships, otherwise the LP dropdown will be empty.

-- ---------------------------------------------------------------------------
-- 4. RLS — deliberately stricter than every other table in this schema.
--
--    Everything else here is USING (true) with auth enforced in the app layer.
--    profiles cannot follow that pattern: once can_edit is the source of truth
--    for access, a permissive UPDATE policy would let any authenticated user
--    run `update profiles set can_edit = true` straight through PostgREST and
--    grant themselves access — strictly weaker than the hardcoded array this
--    replaces. Reads stay open; writes are admin-only.
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- SECURITY DEFINER so the admin check can read profiles without being subject
-- to profiles' own policies — a plain subquery here recurses infinitely.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE((SELECT role = 'admin' FROM public.profiles WHERE id = auth.uid()), FALSE)
$$;

DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "profiles_admin_update" ON public.profiles;
CREATE POLICY "profiles_admin_update" ON public.profiles
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- No INSERT or DELETE policy on purpose: rows come from the trigger and go away
-- via ON DELETE CASCADE when the auth user is removed.

-- ---------------------------------------------------------------------------
-- 5. Assignment columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS lp_editor_id       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS creative_editor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Migrate the existing string assignments: 'Janella' -> janella@…, 'Jaspen' -> jaspen@….
UPDATE public.projects p
SET creative_editor_id = pr.id
FROM public.profiles pr
WHERE p.assigned_designer IS NOT NULL
  AND p.creative_editor_id IS NULL
  AND lower(p.assigned_designer) = lower(split_part(pr.email, '@', 1));

-- assigned_designer is intentionally LEFT IN PLACE and still populated — it is
-- the rollback path for the Phase 2 code. Drop it in a later cleanup only after
-- the new columns are confirmed good in production.

CREATE INDEX IF NOT EXISTS idx_projects_lp_editor       ON public.projects (lp_editor_id);
CREATE INDEX IF NOT EXISTS idx_projects_creative_editor ON public.projects (creative_editor_id);

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFY (run these after; every one should hold)
-- ---------------------------------------------------------------------------
--
--   -- One profile per auth user, and access matching ALLOWED_EDITORS exactly:
--   SELECT count(*) FROM public.profiles;                       -- expect 9
--   SELECT count(*) FROM public.profiles WHERE can_edit;        -- expect 9
--   -- Anyone with a login but NO access (should be nobody today; if this
--   -- returns rows, they're auth users who were never on the allowlist):
--   SELECT email FROM public.profiles WHERE NOT can_edit;
--   SELECT count(*) FROM public.profiles WHERE role = 'admin';  -- expect 2
--   SELECT count(*) FROM public.profiles WHERE is_creative_editor; -- expect 2
--
--   -- Every string assignment found its profile. MUST be 0 — if not, the
--   -- email prefix didn't match the name and needs mapping by hand:
--   SELECT count(*) FROM public.projects
--   WHERE assigned_designer IS NOT NULL AND creative_editor_id IS NULL;
--
--   -- Trigger works: add a throwaway user in the dashboard, then
--   SELECT * FROM public.profiles WHERE email = '<throwaway>';  -- expect 1 row
--   -- …then delete the auth user and confirm the profile cascades away.
--
--   -- RLS actually bites. From a NON-ADMIN session (not the SQL editor, which
--   -- runs as service_role and bypasses RLS — use the app or an anon-key client):
--   UPDATE public.profiles SET can_edit = TRUE WHERE email = '<someone>';
--   -- must affect 0 rows. If it succeeds, STOP: the escalation hole is open.
