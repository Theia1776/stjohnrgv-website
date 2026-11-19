-- =============================================================
-- Events
--
-- A topic in the Events room can be an event: it's made from a form
-- (name, date, time, place, contact, details, gift, and, for the
-- person hosting, a list of things people can sign up to bring). The
-- topic's first post is written from those fields, so it reads the
-- same every time and search and quoting still work. The fields are
-- also kept here so the front page can list what's coming up, an event
-- can be added to a phone's calendar, and the sign-up list works.
--
-- Applied by hand in the Supabase SQL editor, like the others.
-- =============================================================

create table if not exists public.board_events (
  thread_id  uuid        primary key references public.board_threads (id) on delete cascade,
  hosting    boolean     not null default false,
  event_date date        not null,
  start_time time        not null,
  end_time   time,
  place      text        not null check (char_length(place) between 1 and 160),
  address    text        check (char_length(address) <= 200),
  contact    text        check (char_length(contact) <= 120),
  gift       text        check (gift in ('boy', 'girl', 'man', 'woman', 'anyone')),
  created_at timestamptz not null default now()
);
create index if not exists board_events_date_idx on public.board_events (event_date);

-- The host's "please bring" list. Anyone on the board can claim an item.
create table if not exists public.board_event_items (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references public.board_events (thread_id) on delete cascade,
  label      text not null check (char_length(label) between 1 and 80),
  position   int  not null default 0,
  claimed_by uuid references public.profiles (id) on delete set null,
  claimed_at timestamptz
);
create index if not exists board_event_items_thread_idx on public.board_event_items (thread_id, position);

alter table public.board_events      enable row level security;
alter table public.board_event_items enable row level security;
grant all on table public.board_events      to service_role;
grant all on table public.board_event_items to service_role;
