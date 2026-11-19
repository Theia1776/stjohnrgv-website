-- =============================================================
-- The parish board
--
-- An old-fashioned message board: categories down the page, threads
-- inside a category, posts inside a thread. The Book Club, The
-- Kitchen, Scripture & the Faith. Somewhere for the parish to talk
-- that isn't Facebook.
--
-- Who gets in: catechumens, members and admins. Inquirers do not.
-- That line is drawn in the API (src/lib/board-access.ts), not here,
-- because RLS on these tables denies everything to anon and
-- authenticated alike -- every read and write goes through a Pages
-- Function holding the service role key, same as the rest of this
-- site. See 023_prayer_requests.sql for the reasoning.
--
-- Four tables:
--   board_categories  the headings, in the order you set
--   board_threads     a conversation inside a category
--   board_posts       what people actually wrote
--   board_reads       where each person had got to, for "new since
--                     you last looked"
-- =============================================================

-- ---------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------
create table if not exists public.board_categories (
  id          uuid        primary key default gen_random_uuid(),

  -- Used in the URL: /board/?c=the-kitchen. Kept stable so a link
  -- somebody pasted into a text message still works after the
  -- heading gets reworded.
  slug        text        not null unique
                          check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),

  name        text        not null check (length(btrim(name)) between 1 and 80),

  -- The line under the heading: "Recipes, fasting tips, what worked."
  description text,

  -- Smaller sorts first. Gaps are fine, and leaving room between them
  -- makes reordering one category a single update.
  position    int         not null default 0,

  -- Hidden keeps a category and everything in it off the board
  -- without deleting anybody's writing. Admins still see it, marked.
  hidden      boolean     not null default false,

  created_at  timestamptz not null default now()
);

create index if not exists board_categories_order_idx
  on public.board_categories (position, name);

-- ---------------------------------------------------------------
-- Threads
-- ---------------------------------------------------------------
create table if not exists public.board_threads (
  id           uuid        primary key default gen_random_uuid(),

  category_id  uuid        not null
                           references public.board_categories (id) on delete cascade,

  title        text        not null check (length(btrim(title)) between 1 and 160),

  -- Null once the person's account is gone. Their posts stay -- a
  -- conversation with half the lines cut out isn't worth reading --
  -- and the board shows "a former parishioner" in place of a name.
  author_id    uuid        references public.profiles (id) on delete set null,

  pinned       boolean     not null default false,
  locked       boolean     not null default false,

  created_at   timestamptz not null default now(),

  -- Kept up to date by the trigger below so the thread list can sort
  -- by liveliness and show a reply count without counting posts for
  -- every row on every page load.
  last_post_at timestamptz not null default now(),
  post_count   int         not null default 0
);

create index if not exists board_threads_category_idx
  on public.board_threads (category_id, pinned desc, last_post_at desc);

-- ---------------------------------------------------------------
-- Posts
-- ---------------------------------------------------------------
create table if not exists public.board_posts (
  id         uuid        primary key default gen_random_uuid(),

  thread_id  uuid        not null
                         references public.board_threads (id) on delete cascade,

  -- Same reasoning as a thread's author: null means the account went
  -- away, not that the post did.
  author_id  uuid        references public.profiles (id) on delete set null,

  -- 10,000 characters is several screens. Long enough for somebody to
  -- paste in a passage and talk about it, short enough that a runaway
  -- paste can't wedge the page.
  body       text        not null check (length(btrim(body)) between 1 and 10000),

  created_at timestamptz not null default now(),

  -- Set when somebody edits their own post, so the page can say so.
  edited_at  timestamptz
);

create index if not exists board_posts_thread_idx
  on public.board_posts (thread_id, created_at);

-- ---------------------------------------------------------------
-- Who has read what
--
-- One row per person per thread, holding the moment they last opened
-- it. A thread counts as new to you if its newest post landed after
-- that -- or if you've never opened it at all.
-- ---------------------------------------------------------------
create table if not exists public.board_reads (
  user_id      uuid        not null references public.profiles (id) on delete cascade,
  thread_id    uuid        not null references public.board_threads (id) on delete cascade,
  last_read_at timestamptz not null default now(),

  primary key (user_id, thread_id)
);

create index if not exists board_reads_user_idx
  on public.board_reads (user_id, last_read_at desc);

-- ---------------------------------------------------------------
-- Keep a thread's last_post_at and post_count honest
--
-- Recomputed from the posts rather than nudged up and down, so a
-- delete can't leave the count drifting away from reality.
-- ---------------------------------------------------------------
create or replace function public.board_refresh_thread()
returns trigger
language plpgsql
security definer
set search_path = public
as $BOARD$
declare
  target uuid := coalesce(new.thread_id, old.thread_id);
begin
  update public.board_threads t
     set post_count   = (select count(*) from public.board_posts p where p.thread_id = target),
         last_post_at = coalesce(
           (select max(p.created_at) from public.board_posts p where p.thread_id = target),
           t.created_at
         )
   where t.id = target;
  return null;
end;
$BOARD$;

drop trigger if exists board_posts_refresh_thread on public.board_posts;
create trigger board_posts_refresh_thread
  after insert or delete on public.board_posts
  for each row execute function public.board_refresh_thread();

-- ---------------------------------------------------------------
-- Row level security
--
-- Locked shut on purpose. No policy is written for anon or
-- authenticated, so RLS denies them select, insert, update and
-- delete; the only grant is to service_role, which the Pages
-- Functions use after checking that the person signed in is a
-- catechumen, a member or an admin. The board's privacy doesn't rest
-- on a policy being phrased correctly.
-- ---------------------------------------------------------------
alter table public.board_categories enable row level security;
alter table public.board_threads    enable row level security;
alter table public.board_posts      enable row level security;
alter table public.board_reads      enable row level security;

grant all on table public.board_categories to service_role;
grant all on table public.board_threads    to service_role;
grant all on table public.board_posts      to service_role;
grant all on table public.board_reads      to service_role;

-- ---------------------------------------------------------------
-- The three headings to start with. Rename, reorder, add or hide
-- them from the board itself; this is only what's there on day one.
-- ---------------------------------------------------------------
insert into public.board_categories (slug, name, description, position)
values
  ('the-book-club', 'The Book Club',
   'Whatever we are reading. A chapter, a question, a passage worth sitting with.', 10),
  ('the-kitchen', 'The Kitchen',
   'Recipes, fasting tips, what worked and what did not.', 20),
  ('scripture-and-the-faith', 'Scripture & the Faith',
   'Bible discussion and the catechumen lessons.', 30)
on conflict (slug) do nothing;
