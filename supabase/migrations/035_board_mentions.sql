-- =============================================================
-- Board mentions
--
-- Typing @ and a name in a post tags that person. The post shows the
-- name highlighted, and the person finds it under "Mentions" on the
-- board, with a count beside the link. No email goes out.
--
-- Applied by hand in the Supabase SQL editor, like the others.
-- =============================================================

create table if not exists public.board_mentions (
  user_id    uuid        not null references public.profiles (id) on delete cascade,
  post_id    uuid        not null references public.board_posts (id) on delete cascade,
  by_id      uuid        references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  seen_at    timestamptz,
  primary key (user_id, post_id)
);
create index if not exists board_mentions_user_idx on public.board_mentions (user_id, seen_at);

alter table public.board_mentions enable row level security;
grant all on table public.board_mentions to service_role;
