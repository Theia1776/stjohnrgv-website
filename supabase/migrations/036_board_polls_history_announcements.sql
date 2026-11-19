-- =============================================================
-- Polls, edit history, front-page announcements
--
--   * polls: a topic can carry one poll (2 to 8 choices, one answer or
--     several). Votes are anonymous on the page: it shows counts, not
--     who voted for what. Anyone on the board can vote and change their
--     vote until the topic is closed.
--
--   * edit history: when a post is edited, what it said before is kept,
--     so moderators can see if an angry post was quietly rewritten.
--     Only moderators and admins can see it.
--
--   * announcements: a moderator can mark a topic to show on the
--     board's front page.
--
-- Applied by hand in the Supabase SQL editor, like the others.
-- =============================================================

create table if not exists public.board_polls (
  id         uuid        primary key default gen_random_uuid(),
  thread_id  uuid        not null unique references public.board_threads (id) on delete cascade,
  multiple   boolean     not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.board_poll_options (
  id       uuid primary key default gen_random_uuid(),
  poll_id  uuid not null references public.board_polls (id) on delete cascade,
  label    text not null check (char_length(label) between 1 and 100),
  position int  not null default 0
);
create index if not exists board_poll_options_poll_idx on public.board_poll_options (poll_id, position);

create table if not exists public.board_poll_votes (
  option_id uuid not null references public.board_poll_options (id) on delete cascade,
  poll_id   uuid not null references public.board_polls (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  primary key (option_id, user_id)
);
create index if not exists board_poll_votes_poll_idx on public.board_poll_votes (poll_id, user_id);

create table if not exists public.board_post_edits (
  id          uuid        primary key default gen_random_uuid(),
  post_id     uuid        not null references public.board_posts (id) on delete cascade,
  body        text        not null,
  edited_by   uuid        references public.profiles (id) on delete set null,
  replaced_at timestamptz not null default now()
);
create index if not exists board_post_edits_post_idx on public.board_post_edits (post_id, replaced_at desc);

alter table public.board_threads add column if not exists announce boolean not null default false;

alter table public.board_polls        enable row level security;
alter table public.board_poll_options enable row level security;
alter table public.board_poll_votes   enable row level security;
alter table public.board_post_edits   enable row level security;
grant all on table public.board_polls        to service_role;
grant all on table public.board_poll_options to service_role;
grant all on table public.board_poll_votes   to service_role;
grant all on table public.board_post_edits   to service_role;
