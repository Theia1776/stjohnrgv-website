-- =============================================================
-- Board signatures
--
-- A few lines a person can set once and have shown under every post
-- they write, the way every forum has let people do. Kept in its own
-- table rather than on profiles so nothing that reads a whole
-- profile row ever picks it up by accident.
--
-- It is looked up when a thread is shown, not copied into each post.
-- Change it and every post of theirs changes with it; clear it and it
-- disappears everywhere. That is how forums have always worked it,
-- and it means there is nothing to clean up per post.
--
-- Applied by hand in the Supabase SQL editor, like the others.
-- =============================================================
create table if not exists public.board_signatures (
  user_id    uuid        primary key references public.profiles (id) on delete cascade,
  body       text        not null check (length(body) between 1 and 300),
  updated_at timestamptz not null default now()
);

alter table public.board_signatures enable row level security;
grant all on table public.board_signatures to service_role;
