-- A contract file always has a contract record.
--
-- The brand page's "What we agreed" reads brand_contracts, but a PDF uploaded
-- through the Contract files list (or moved to Contract) only made a
-- brand_documents row. The brand then said "No contract on file" with the
-- signed SOW sitting right there (Face the Frost and Chike, 10 Nov).
--
-- Now any brand_documents row of kind 'contract' gets a brand_contracts row
-- linked to it, titled from the file name. The app then reads the terms with
-- AI. Existing contract files without one are backfilled.
--
-- ADDITIVE ONLY: a new function, a new trigger, and inserted rows. Safe to re-run.

BEGIN;

CREATE OR REPLACE FUNCTION public.contract_title_from_file(file_name text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(
    nullif(left(btrim(regexp_replace(regexp_replace(file_name, '\.[^.]+$', ''), '[_\s]+', ' ', 'g')), 200), ''),
    'Contract'
  )
$$;

-- SECURITY DEFINER: staff upload as `authenticated`, which may only read
-- brand_contracts (writes are server-only). The trigger needs to write.
CREATE OR REPLACE FUNCTION public.brand_documents_contract_record()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.kind = 'contract'
     AND NOT EXISTS (SELECT 1 FROM public.brand_contracts c WHERE c.document_id = NEW.id) THEN
    INSERT INTO public.brand_contracts (brand_id, document_id, title, updated_by_name)
    VALUES (NEW.brand_id, NEW.id, public.contract_title_from_file(NEW.file_name), NEW.uploaded_by_name);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS brand_documents_contract_record ON public.brand_documents;
CREATE TRIGGER brand_documents_contract_record
  AFTER INSERT OR UPDATE OF kind ON public.brand_documents
  FOR EACH ROW EXECUTE FUNCTION public.brand_documents_contract_record();

-- Backfill: contract files already uploaded without a record.
INSERT INTO public.brand_contracts (brand_id, document_id, title, updated_by_name)
SELECT d.brand_id, d.id, public.contract_title_from_file(d.file_name), d.uploaded_by_name
FROM public.brand_documents d
WHERE d.kind = 'contract'
  AND NOT EXISTS (SELECT 1 FROM public.brand_contracts c WHERE c.document_id = d.id);

COMMIT;
