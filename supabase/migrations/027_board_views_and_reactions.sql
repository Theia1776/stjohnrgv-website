-- =============================================================
-- The board, dressed as a message board
--
-- Two things the old forum layout shows that 026 didn't record:
--
--   * a view count per thread, for the Views column
--   * reactions on a post, so people can answer with a face
--     instead of a whole reply
--
-- Everything else the layout needs was already there: a join date
-- and an avatar on profiles, and a post count we can count.
-- =============================================================

-- ---------------------------------------------------------------
-- Views
--
-- Counted, not precise. Opening a thread bumps it, including your
-- own opens; forums have always worked that way and nobody has ever
-- treated the number as anything but a rough sign of interest.
-- ---------------------------------------------------------------
alter table public.board_threads
  add column if not exists view_count int not null default 0;

create or replace function public.board_bump_views(thread uuid)
returns void
language sql
security definer
set search_path = public
as $BOARD$
  update public.board_threads
     set view_count = view_count + 1
   where id = thread;
$BOARD$;

grant execute on function public.board_bump_views(uuid) to service_role;

-- ---------------------------------------------------------------
-- Reactions
--
-- One row per person per emoji per post, so a person may add more
-- than one different reaction to a post but can't stack the same one
-- twice. Clicking the same face again removes the row.
--
-- The emoji itself is stored, not an id pointing at a list. It keeps
-- the set open and means nothing breaks if the palette changes later;
-- the length check is what stops somebody pasting an essay in here.
-- ---------------------------------------------------------------
create table if not exists public.board_reactions (
  post_id    uuid        not null references public.board_posts (id) on delete cascade,
  user_id    uuid        not null references public.profiles (id) on delete cascade,
  emoji      text        not null check (length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),

  primary key (post_id, user_id, emoji)
);

create index if not exists board_reactions_post_idx
  on public.board_reactions (post_id);

alter table public.board_reactions enable row level security;
grant all on table public.board_reactions to service_role;
