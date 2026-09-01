-- Somewhere to keep the brand's actual rules.
--
-- A guideline document can already be UPLOADED — brand-guidelines/<brandId>-… in
-- storage — but it is parsed into Brand DNA and then forgotten: the path is
-- never stored, so nobody can get back to the thing it came from. And Brand DNA
-- is a structured summary, not the rules as the brand wrote them.
--
-- Distinct from brands.brand_notes, which is the editors' own running commentary
-- ("they always reject X", "AI sensitive"). Guidelines are the CLIENT's word:
-- fonts, colours, logo clear space, what may never appear. One is what we have
-- learned, the other is what we were told, and collapsing them into one field
-- loses which is which the first time they disagree.
--
-- Plain TEXT, pasted. Not a file: an editor mid-layout needs to read a rule, not
-- download a 40MB PDF, and the upload route already exists for the DNA build.

BEGIN;

ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS brand_guidelines TEXT;

COMMIT;

-- VERIFY:
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name='brands' AND column_name='brand_guidelines';
