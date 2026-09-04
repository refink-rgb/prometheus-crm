-- Comment authorship + edit honesty.
--
-- project_comments has carried identity as a free-text display name since
-- before this migrations directory existed. That string is neither stable nor
-- trustworthy: the live table holds both "roberto" (14 rows, written from the
-- internal-review screen, which passes the email local-part) and "Roberto"
-- (7 rows, written from the project page, which passes profiles.full_name) for
-- one person. And any client on a share link types their own author_name into
-- a free-text box, so a client can type a teammate's name. An ownership check
-- on the name would be both false-negative and false-positive. This adds the
-- real thing.
--
-- No UPDATE policy is added. project_comments has none for the authenticated
-- role, and every write already goes through the service-role client (see
-- deleteProjectComment / toggleCommentResolved). A USING(true) UPDATE policy
-- would let any signed-in staff member PATCH any comment straight from the
-- browser, bypassing the ownership check in the server action. Keep it closed.
--
-- Safe to re-run.
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/mhizyjlvqrhwzjqywiwz/sql/new

begin;

alter table public.project_comments
  add column if not exists author_id uuid references auth.users(id) on delete set null,
  add column if not exists edited_at timestamptz;

alter table public.brand_comments
  add column if not exists edited_at timestamptz;

-- Backfill: only the staff-written rows (audience='internal') have a knowable
-- author. Those rows carry a handful of distinct author_name values, and each
-- resolves case-insensitively to exactly one profile, by email local-part or by
-- full_name. The NOT EXISTS guard makes the match refuse to guess rather than
-- mis-assign if that ever stops being true. Client-written rows stay NULL,
-- correctly: they were posted anonymously through a share token and have no
-- author to find.
update public.project_comments c
set author_id = p.id
from public.profiles p
where c.audience = 'internal'
  and c.author_id is null
  and lower(btrim(c.author_name)) in (
        lower(split_part(p.email, '@', 1)),
        lower(coalesce(p.full_name, ''))
      )
  and not exists (
        select 1 from public.profiles p2
        where p2.id <> p.id
          and lower(btrim(c.author_name)) in (
                lower(split_part(p2.email, '@', 1)),
                lower(coalesce(p2.full_name, ''))
              )
      );

create index if not exists idx_project_comments_author
  on public.project_comments (author_id);

commit;

-- Check afterwards:
--   select count(*) from project_comments where author_id is not null;
-- Any internal row still NULL is one whose author_name matched no profile —
-- those notes simply stay uneditable, which is the safe outcome.
