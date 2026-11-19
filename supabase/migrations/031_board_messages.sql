-- =============================================================
-- Board messages
--
-- Private conversations between people on the board, outside the
-- topics. Two kinds:
--
--   direct: one person writes to one other person.
--   help:   someone pressed Help on their own topic. It goes to every
--           moderator and admin, and any of them can answer, so the
--           person gets one place to hear back.
--
-- Only the people in a conversation can read it; the board has no
-- screen that lists anyone else's. It is stored as plain text in this
-- database like the rest of the board, not encrypted, and the page
-- says so.
--
-- Ignoring: board_ignores records who a person has chosen to stop
-- hearing from. Their messages still arrive; they just sit under
-- "Ignored" in the inbox and never count as new. It is not blocking:
-- the other person isn't told, can still write, and moderators and
-- admins can't be ignored at all (that rule is in the code).
--
-- Applied by hand in the Supabase SQL editor, like the others.
-- =============================================================

create table if not exists public.board_conversations (
  id              uuid        primary key default gen_random_uuid(),
  kind            text        not null default 'direct' check (kind in ('direct', 'help')),
  subject         text        not null check (char_length(subject) between 1 and 160),
  created_by      uuid        references public.profiles (id) on delete set null,
  -- direct only: who it was written to
  recipient_id    uuid        references public.profiles (id) on delete set null,
  -- help only: the topic the person asked about
  thread_id       uuid        references public.board_threads (id) on delete set null,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  last_author_id  uuid        references public.profiles (id) on delete set null
);

-- Who has it in their inbox, and when they last read it. A null
-- last_read_at means they never have.
create table if not exists public.board_conversation_members (
  conversation_id uuid        not null references public.board_conversations (id) on delete cascade,
  user_id         uuid        not null references public.profiles (id) on delete cascade,
  last_read_at    timestamptz,
  primary key (conversation_id, user_id)
);
create index if not exists board_conversation_members_user_idx
  on public.board_conversation_members (user_id);

create table if not exists public.board_messages (
  id              uuid        primary key default gen_random_uuid(),
  conversation_id uuid        not null references public.board_conversations (id) on delete cascade,
  author_id       uuid        references public.profiles (id) on delete set null,
  body            text        not null check (char_length(body) between 1 and 5000),
  created_at      timestamptz not null default now()
);
create index if not exists board_messages_conversation_idx
  on public.board_messages (conversation_id, created_at);
create index if not exists board_messages_author_idx
  on public.board_messages (author_id, created_at);

create table if not exists public.board_ignores (
  user_id    uuid        not null references public.profiles (id) on delete cascade,
  ignored_id uuid        not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, ignored_id),
  check (user_id <> ignored_id)
);

alter table public.board_conversations        enable row level security;
alter table public.board_conversation_members enable row level security;
alter table public.board_messages             enable row level security;
alter table public.board_ignores              enable row level security;

grant all on table public.board_conversations        to service_role;
grant all on table public.board_conversation_members to service_role;
grant all on table public.board_messages             to service_role;
grant all on table public.board_ignores              to service_role;
