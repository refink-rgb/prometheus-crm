-- A short, searchable code per project, so a media buyer can find every ad set
-- and every ad belonging to one marketing moment by pasting one string into the
-- Ads Manager search box.
--
--   first letters of the brand + first letters of the offer + the date
--   Ion Layer / "Labor Day $150 Off" / 5 Sep 2026  ->  ILLD$O050926
--
-- One solid token, no separators. Slashes and dashes are both already spoken
-- for: the CTC campaign taxonomy separates on " - ", the media-buying scale
-- filter reads " | " as "already scaled", and a slash inside an ad name ends up
-- in a URL wherever utm_content={{ad.name}} is set.
--
-- Generated in the app (src/lib/moment-code.ts), never typed. The unique index
-- is the backstop: verified against all 74 live projects with zero collisions.
--
-- Safe to re-run.
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/mhizyjlvqrhwzjqywiwz/sql/new

alter table public.projects
  add column if not exists moment_code text;

-- Letters, digits and $ only — the character set the generator can emit. No
-- separators, so a substring search cannot half-match.
alter table public.projects
  drop constraint if exists projects_moment_code_format;
alter table public.projects
  add constraint projects_moment_code_format
  check (moment_code is null or moment_code ~ '^[A-Z0-9$%]{4,40}$');

create unique index if not exists uq_projects_moment_code
  on public.projects (moment_code) where moment_code is not null;

comment on column public.projects.moment_code is
  'Searchable brand+offer+date code. Minted on create from src/lib/moment-code.ts; frozen thereafter so a rename never invalidates a live ad name.';
