-- Client intake link: one URL per brand where the client answers the intake
-- questions and uploads their assets. Makers said work starts without product
-- images, logos, fonts, colours, the brand book, copy don'ts and whether AI is
-- OK. The fields existed; nobody asked the client for them. This is the ask.
--
-- Answers land in the fields the brand page already reads (ai_sensitivity,
-- preferred_channel, channel_details, intake_answers, brand_contacts,
-- client_rules). Files land in brand_documents, typed by kind.
--
-- ADDITIVE ONLY. New nullable columns, wider CHECK lists, wider bucket types.
-- Safe to re-run.

BEGIN;

-- ── The link and what was answered ─────────────────────────────────────────
-- Separate from client_token: the portal link shows their projects; this one
-- lets an unauthenticated visitor write to the brand, so it can be rotated on
-- its own without breaking the portal.
ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS intake_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_brands_intake_token ON public.brands (intake_token) WHERE intake_token IS NOT NULL;
-- The structured answers, so the form re-opens filled in and the brand page can
-- say which questions are still blank. intake_answers keeps the readable text.
ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS intake_form JSONB;
-- Last time the client touched the form (autosave), and when they pressed Done.
ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS intake_updated_at TIMESTAMPTZ;
ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS intake_submitted_at TIMESTAMPTZ;

-- ── File types the client sends ────────────────────────────────────────────
-- logo, product_images and fonts join guidelines / contract / intake / other.
ALTER TABLE public.brand_documents DROP CONSTRAINT IF EXISTS brand_documents_kind_check;
ALTER TABLE public.brand_documents ADD CONSTRAINT brand_documents_kind_check
  CHECK (kind IN ('guidelines', 'contract', 'intake', 'other', 'logo', 'product_images', 'fonts'));

-- True when the client uploaded it through the intake link (no staff user).
ALTER TABLE public.brand_documents ADD COLUMN IF NOT EXISTS from_client BOOLEAN NOT NULL DEFAULT false;

-- Images, vector logos, fonts and zips, on top of the document types.
ALTER TABLE public.brand_documents DROP CONSTRAINT IF EXISTS brand_documents_mime_type_check;
ALTER TABLE public.brand_documents ADD CONSTRAINT brand_documents_mime_type_check
  CHECK (mime_type IN (
    'application/pdf',
    'text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic', 'image/tiff',
    'image/svg+xml', 'image/vnd.adobe.photoshop', 'application/postscript',
    'font/ttf', 'font/otf', 'font/woff', 'font/woff2',
    'application/zip'
  ));

UPDATE storage.buckets SET allowed_mime_types = ARRAY[
  'application/pdf',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic', 'image/tiff',
  'image/svg+xml', 'image/vnd.adobe.photoshop', 'application/postscript',
  'font/ttf', 'font/otf', 'font/woff', 'font/woff2',
  'application/zip'
]
WHERE id = 'brand-docs';

COMMIT;
