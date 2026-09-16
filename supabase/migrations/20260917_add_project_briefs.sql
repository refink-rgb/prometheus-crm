-- Creative briefs: the client's brief FILES on a project, and what AI read out of them.
--
-- A brief had nowhere to live. The one project-level brief in the system
-- ("Caley M1 — No Tour Tax Sales Page.pdf") is filed under BRAND documents
-- because that was the only upload box. Briefs are per campaign, die with the
-- project, and belong on the Creatives tab next to the offer they describe.
--
-- A TABLE, for the reasons in 20260906: rows do not collide when two editors
-- upload at once, and each carries its uploader and timestamps. It also holds
-- the AI read:
--   extraction         JSONB object. ALWAYS read through normalizeBriefExtraction
--                      (src/lib/project-briefs.ts) — a model's JSON is not a type.
--   extraction_status  pending -> reading -> done | failed. 'reading' is claimed
--                      atomically by the read route. A 'reading' row older than
--                      330s is treated as stopped (the route's ceiling is 300s).
--   images             JSONB array of stored preview PATHS (never URLs: the
--                      bucket is private, every URL is signed on demand).
--
-- ── ITS OWN PRIVATE BUCKET, NOT A FOLDER IN brand-docs ───────────────────
-- 1. allowed_mime_types is per bucket. Briefs need image types (screenshot
--    briefs, and the previews made from every brief); adding them to
--    brand-docs opens every brand upload to images too.
-- 2. 20260906 upserts brand-docs' type list on re-run, which would silently
--    strip image types and break brief uploads.
-- 3. Storage policies cover a whole bucket: a folder gets zero separation, and
--    an orphan sweep matching brand-docs to brand_documents would delete briefs.
-- Never project-images: it is public and listable with the anon key.
--
-- One bucket for the original AND its previews (same confidentiality, same
-- lifetime), one folder per brief, so removal is one list + one delete:
--   <project_id>/<brief_id>/source.<ext>
--   <project_id>/<brief_id>/img-001-full.webp    1600px
--   <project_id>/<brief_id>/img-001-thumb.webp   768px
--
-- Safe to re-run.
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/mhizyjlvqrhwzjqywiwz/sql/new

begin;

create table if not exists public.project_briefs (
  -- Supplied by createProjectBriefUploadUrl, which mints it BEFORE the row
  -- exists so the storage folder can be named after the brief.
  id           uuid primary key default gen_random_uuid(),

  -- Cascade removes rows only. deleteProject / deleteBrand collect brief ids,
  -- delete the rows, then sweep the folders (removeBriefFolder); a project
  -- deleted straight from the dashboard leaves orphaned bytes.
  project_id   uuid not null references public.projects(id) on delete cascade,

  storage_path text not null unique,
  file_name    text not null check (btrim(file_name) <> ''),
  mime_type    text not null check (mime_type in (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'image/png',
    'image/jpeg',
    'image/webp'
  )),
  byte_size    bigint not null check (byte_size > 0),

  uploaded_by      uuid references auth.users(id) on delete set null,
  uploaded_by_name text,
  created_at       timestamptz not null default now(),

  extraction_status     text not null default 'pending'
    check (extraction_status in ('pending', 'reading', 'done', 'failed')),
  extraction            jsonb check (extraction is null or jsonb_typeof(extraction) = 'object'),
  extraction_error      text,
  extraction_model      text,
  extraction_started_at timestamptz,
  extracted_at          timestamptz,

  images        jsonb not null default '[]'::jsonb check (jsonb_typeof(images) = 'array'),
  images_status text not null default 'none'
    check (images_status in ('none', 'done', 'failed')),
  -- A failure reason ('password-protected') or a note ('12 more pictures not shown').
  images_note   text,
  -- PDFs only: the real page count, so "previews cover 40 of 212 pages" can be said.
  page_count    integer check (page_count is null or page_count > 0)
);

create index if not exists idx_project_briefs_project_created
  on public.project_briefs (project_id, created_at desc);

-- Same combined policy as brand_documents. canEdit() in the app is the real
-- boundary. NO anon policy, ever: /review and /portal serve logged-out browsers.
alter table public.project_briefs enable row level security;
drop policy if exists "project_briefs_rw_auth" on public.project_briefs;
create policy "project_briefs_rw_auth" on public.project_briefs
  for all to authenticated using (true) with check (true);

-- DO UPDATE so a re-run corrects the limit and type list.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-briefs', 'project-briefs', false,
  52428800,  -- 50MB. MUST equal MAX_BRIEF_BYTES in src/lib/project-briefs.ts.
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'image/png',
    'image/jpeg',
    'image/webp'
  ]
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- UPDATE exists here (not on brand-docs): previews are re-made in place with
-- upsert, and Storage checks an upsert against UPDATE.
drop policy if exists "project_briefs_obj_insert_auth" on storage.objects;
create policy "project_briefs_obj_insert_auth" on storage.objects
  for insert to authenticated with check (bucket_id = 'project-briefs');

drop policy if exists "project_briefs_obj_select_auth" on storage.objects;
create policy "project_briefs_obj_select_auth" on storage.objects
  for select to authenticated using (bucket_id = 'project-briefs');

drop policy if exists "project_briefs_obj_update_auth" on storage.objects;
create policy "project_briefs_obj_update_auth" on storage.objects
  for update to authenticated using (bucket_id = 'project-briefs') with check (bucket_id = 'project-briefs');

drop policy if exists "project_briefs_obj_delete_auth" on storage.objects;
create policy "project_briefs_obj_delete_auth" on storage.objects
  for delete to authenticated using (bucket_id = 'project-briefs');

commit;
