-- =============================================================
-- Suspensions and reports on public posts
--
--   * suspensions: a moderator or admin can stop a member posting for
--     a set time (or until it is lifted). They can still read the
--     board. The server refuses every write while a suspension is on;
--     it ends by itself when the time is up.
--
--   * post reports: any member can report a post in a topic. One row per
--     reporter per post, so pressing it twice does nothing new, and
--     note_thread_id remembers the note written in the Moderation Forum
--     so a second report adds to that note instead of starting another.
--
-- Applied by hand in the Supabase SQL editor, like the others.
-- =============================================================

create table if not exists public.board_suspensions (
  user_id      uuid        primary key references public.profiles (id) on delete cascade,
  until        timestamptz,
  reason       text,
  suspended_by uuid        references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);

create table if not exists public.board_post_reports (
  post_id        uuid        not null references public.board_posts (id) on delete cascade,
  reporter_id    uuid        not null references public.profiles (id) on delete cascade,
  note_thread_id uuid        references public.board_threads (id) on delete set null,
  created_at     timestamptz not null default now(),
  primary key (post_id, reporter_id)
);

alter table public.board_suspensions  enable row level security;
alter table public.board_post_reports enable row level security;
grant all on table public.board_suspensions  to service_role;
grant all on table public.board_post_reports to service_role;
