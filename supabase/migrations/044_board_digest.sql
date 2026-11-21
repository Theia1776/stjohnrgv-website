-- =============================================================
-- Board email digests
--
-- Members can ask for a short email, daily or weekly, listing the
-- topics with new posts (busiest first) and telling them about unread
-- private messages and mentions. Nobody gets one unless they choose
-- it. There is a row here only once someone has answered; no row means
-- they haven't been asked yet and the board offers the choice once.
--
-- last_sent_at is when the last digest went out (or when they opted in,
-- so the first one covers only what came after). The scheduled job asks
-- who is due and sends to them.
--
-- site_settings holds small private values the server needs. The only
-- one so far is the token the scheduled job proves itself with.
--
-- Applied by hand in the Supabase SQL editor, like the others.
-- =============================================================
create table if not exists public.board_digest_prefs (
  user_id      uuid        primary key references public.profiles (id) on delete cascade,
  frequency    text        not null default 'off' check (frequency in ('off', 'daily', 'weekly')),
  last_sent_at timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists board_digest_prefs_freq_idx on public.board_digest_prefs (frequency) where frequency <> 'off';

create table if not exists public.site_settings (
  key   text primary key,
  value text not null
);

alter table public.board_digest_prefs enable row level security;
alter table public.site_settings enable row level security;
grant all on table public.board_digest_prefs to service_role;
grant all on table public.site_settings to service_role;
