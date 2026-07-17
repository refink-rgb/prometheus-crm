-- Editor API tokens — per-person, read-only access to project bundles for the
-- external creative-generation skill (Claude on an editor's machine).
--
-- The token IS the authorization (mirrors the existing projects.share_token
-- pattern), but is per-user and can span brands. Only the service role (our
-- server-side API routes) ever reads this table; RLS is on with no policies,
-- so the anon/authenticated clients are denied by default.

create table if not exists public.editor_tokens (
  id                uuid primary key default gen_random_uuid(),
  token             text not null unique,           -- opaque random string; sent as Bearer
  label             text,                            -- who it's for, e.g. "Editor – Jane"
  allowed_brand_ids uuid[],                          -- null/empty = all brands
  revoked           boolean not null default false,
  expires_at        timestamptz,                     -- null = no expiry
  created_at        timestamptz not null default now(),
  last_used_at      timestamptz
);

comment on table public.editor_tokens is
  'Read-only API tokens for the external creative skill. Validated server-side with the service role; never exposed to the anon client.';

alter table public.editor_tokens enable row level security;
-- (No policies on purpose: deny all for anon/authenticated. Service role bypasses RLS.)

-- To mint a token (run once per editor, replace the label + brand scope):
--   insert into public.editor_tokens (token, label)
--   values (encode(gen_random_bytes(24), 'hex'), 'Editor – Jane');
-- Scope to specific brands instead of all:
--   insert into public.editor_tokens (token, label, allowed_brand_ids)
--   values (encode(gen_random_bytes(24), 'hex'), 'Editor – Jane', array['<brand-uuid>']::uuid[]);
