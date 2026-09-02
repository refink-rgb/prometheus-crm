-- A running thread of context per brand.
--
-- brands.brand_notes is a single shared text box: whoever saves last wins, and
-- two people writing at once silently lose one of them. What the team actually
-- does is accumulate hard-won facts about a client over months — "rejects
-- anything AI-looking", "their product folder is EU-only" — which is a
-- conversation, not a document.
--
-- Brand-level on purpose. A project is one moment; the knowledge outlives it and
-- has to be there on the next one, and on the one after a brand changes hands.
--
-- brand_notes is NOT dropped here. The backfill below posts each brand's
-- existing note as the first entry so nothing is lost, and the column stays
-- readable by the creative bundle API until that is migrated separately.

BEGIN;

CREATE TABLE IF NOT EXISTS public.brand_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Cascade: a deleted brand should not leave its context behind.
  brand_id    UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,

  -- Denormalised on purpose, like project_comments.author_name: the display name
  -- at the time of writing. Joining to profiles would rewrite history when
  -- someone's name changes, and would lose the author entirely if they leave.
  author_name TEXT NOT NULL,
  -- Nullable so a post survives the author being deleted from auth.
  author_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  content     TEXT NOT NULL CHECK (btrim(content) <> ''),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The only read: one brand's thread, newest first.
CREATE INDEX IF NOT EXISTS idx_brand_comments_brand_created
  ON public.brand_comments (brand_id, created_at DESC);

-- Combined policy, matching the newer standalone tables. Authenticated staff
-- read/write; canEdit() in the app is the real boundary. No anon policy — no
-- client-facing surface reads this, and it must never gain one: this is where
-- the team writes things like "they claim real photos are AI".
ALTER TABLE public.brand_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "brand_comments_rw_auth" ON public.brand_comments;
CREATE POLICY "brand_comments_rw_auth" ON public.brand_comments
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── Backfill: the 8 brands that already have notes ─────────────────────────
-- Posted as the first entry, attributed to the team rather than to a person,
-- because the column has no author and inventing one would be a lie.
-- Guarded so re-running does nothing.
INSERT INTO public.brand_comments (brand_id, author_name, content, created_at)
SELECT b.id, 'Team', btrim(b.brand_notes), COALESCE(b.created_at, NOW())
FROM public.brands b
WHERE btrim(COALESCE(b.brand_notes, '')) <> ''
  AND NOT EXISTS (SELECT 1 FROM public.brand_comments c WHERE c.brand_id = b.id);

COMMIT;

-- VERIFY:
--   SELECT count(*) FROM public.brand_comments;   -- 8 after the backfill
