-- The client's own documents, kept beside the rules they came from.
--
-- brands.brand_guidelines is a TEXT box, and its own migration ruled a file out
-- in as many words: "Plain TEXT, pasted. Not a file." That assumed an editor
-- only ever needs a rule, and it is wrong in the case that matters most — the
-- client sends a 30-page brand book as a PDF. Today that PDF is uploaded to
-- build Brand DNA and then thrown away: BrandDnaPanel writes
-- brand-guidelines/<brandId>-<ts>.<ext> into storage and nothing records the
-- path, so nobody can get back to it. This is the fix.
--
-- A TABLE, not a JSONB array on brands, against the precedent of products /
-- competitors / asset_folders. Two reasons, both specific to FILES:
--   1. Every list in this repo that holds UPLOADED BYTES is already a table —
--      project_images (storage_path, storage_url, created_at) and
--      creative_asset_revisions. The JSONB lists hold links somebody typed.
--   2. A JSONB list is rewritten whole and is last-write-wins by design. Uploads
--      are concurrent and additive: two editors dropping a file at the same
--      second would each read the same array and each write it back, and one
--      file would vanish from the list while its bytes sat in the bucket, paid
--      for and unreachable. Rows do not collide.
-- It also buys uploaded_by / created_at per row, which no JSONB list here
-- carries, and drops the 40-row cap a document library would eventually hit.
--
-- ── A NEW, PRIVATE BUCKET ─────────────────────────────────────────────────
-- project-images is public and its SELECT policy grants role `public` over the
-- whole bucket. So any object in it is readable by anyone, with no login — and
-- because that policy sits on storage.objects, anyone holding the anon key (it
-- ships in every JS bundle we serve) can also LIST the bucket and walk it.
-- Images are one thing. A client's brand book, their contract, their price
-- sheet are not ours to put on an open, enumerable URL. brand-docs is private:
-- no `public` policy at all, and reads happen through short-lived signed URLs
-- minted server-side after canEdit(). Nothing legacy lives in it, so there is
-- no stored URL to backfill.
--
-- Safe to re-run.
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/mhizyjlvqrhwzjqywiwz/sql/new

begin;

create table if not exists public.brand_documents (
  id           uuid primary key default gen_random_uuid(),

  -- Cascade: a deleted brand should not leave its documents listed. The storage
  -- objects are removed by removeBrandDocument, not by this, so a brand deleted
  -- straight from the dashboard leaves orphaned bytes in brand-docs.
  brand_id     uuid not null references public.brands(id) on delete cascade,

  -- The object key inside the brand-docs bucket. The PATH, not a URL: the
  -- bucket is private so every URL is signed and expires, and only a path can
  -- be handed to storage.remove().
  storage_path text not null unique,

  -- The name the file actually had. It is the only thing that tells an editor
  -- which of three PDFs is the type specimen. Sanitised in lib/brand-docs.ts.
  file_name    text not null check (btrim(file_name) <> ''),

  -- Decides whether the row can be previewed in place, so it is constrained to
  -- the allowlist: a row can never claim a type the viewer does not handle.
  mime_type    text not null check (mime_type in (
    'application/pdf',
    'text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  )),

  -- Displayed, never trusted: it is what the browser reported. The real ceiling
  -- is the bucket's file_size_limit below.
  byte_size    bigint not null check (byte_size > 0),

  uploaded_by      uuid references auth.users(id) on delete set null,
  -- Denormalised like brand_comments.author_name: the display name at the time
  -- of upload, so the row survives the person leaving.
  uploaded_by_name text,

  created_at   timestamptz not null default now()
);

-- The only read: one brand's documents, newest first.
create index if not exists idx_brand_documents_brand_created
  on public.brand_documents (brand_id, created_at desc);

-- Combined policy, matching brand_comments. Authenticated staff read/write;
-- canEdit() in the app is the real boundary. NO anon policy, and it must never
-- gain one: /review/[token] and /portal/[token] are served to logged-out
-- browsers and a client's own contract must not be listable from them.
alter table public.brand_documents enable row level security;
drop policy if exists "brand_documents_rw_auth" on public.brand_documents;
create policy "brand_documents_rw_auth" on public.brand_documents
  for all to authenticated using (true) with check (true);

-- ── The private bucket ────────────────────────────────────────────────────
-- DO UPDATE, not DO NOTHING: re-running has to be able to correct the size
-- limit and the type list, which DO NOTHING would silently skip.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'brand-docs', 'brand-docs', false,
  41943040,  -- 40MB. The only ceiling a forged client cannot talk its way past.
  array[
    'application/pdf',
    'text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Three policies, all scoped to this bucket, all authenticated-only. SELECT is
-- what lets the server mint a signed URL. There is deliberately no policy for
-- role `public` — that is the whole difference from project-images.
drop policy if exists "brand_docs_insert_auth" on storage.objects;
create policy "brand_docs_insert_auth" on storage.objects
  for insert to authenticated with check (bucket_id = 'brand-docs');

drop policy if exists "brand_docs_select_auth" on storage.objects;
create policy "brand_docs_select_auth" on storage.objects
  for select to authenticated using (bucket_id = 'brand-docs');

drop policy if exists "brand_docs_delete_auth" on storage.objects;
create policy "brand_docs_delete_auth" on storage.objects
  for delete to authenticated using (bucket_id = 'brand-docs');

commit;
