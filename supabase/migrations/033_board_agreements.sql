-- =============================================================
-- Board terms: who agreed, to which version, and when
--
-- The first time someone opens the board they are asked to agree to
-- the Parish Board Terms. The server won't answer any board request
-- until they have agreed to the current version, so this is a real
-- gate, not a pop-up that can be closed. When the terms change, the
-- version in src/lib/board-terms.ts changes and everyone is asked
-- again.
--
-- Applied by hand in the Supabase SQL editor, like the others.
-- =============================================================

create table if not exists public.board_agreements (
  user_id     uuid        not null references public.profiles (id) on delete cascade,
  version     text        not null,
  accepted_at timestamptz not null default now(),
  primary key (user_id, version)
);

alter table public.board_agreements enable row level security;
grant all on table public.board_agreements to service_role;
