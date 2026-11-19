-- =============================================================
-- RSVP on a topic, and a log of what moderators do
--
--   * board_polls.show_voters: an RSVP ("Will you be there?" Yes /
--     Maybe / No) is a poll that also lists who chose what. An ordinary
--     poll stays anonymous.
--
--   * board_mod_log: one row each time a moderator or admin pins,
--     closes, moves, announces or deletes a topic, deletes someone's
--     post, hides or deletes a room, suspends or lifts a suspension,
--     restores a reported post, or changes who the moderators are.
--     Admins can read it. It's there so what happened is never in doubt.
--
-- Applied by hand in the Supabase SQL editor, like the others.
-- =============================================================

alter table public.board_polls add column if not exists show_voters boolean not null default false;

create table if not exists public.board_mod_log (
  id         uuid        primary key default gen_random_uuid(),
  actor_id   uuid        references public.profiles (id) on delete set null,
  action     text        not null,
  target_id  uuid        references public.profiles (id) on delete set null,
  detail     text,
  created_at timestamptz not null default now()
);
create index if not exists board_mod_log_created_idx on public.board_mod_log (created_at desc);

alter table public.board_mod_log enable row level security;
grant all on table public.board_mod_log to service_role;
