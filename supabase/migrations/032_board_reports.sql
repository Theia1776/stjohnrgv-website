-- =============================================================
-- Board message reports and the admin review log
--
-- Private messages are not kept forever: a conversation is removed
-- from the server once everyone in it has cleared it from their
-- inbox. Nobody can delete or edit a single message inside one.
--
-- When someone presses "Report this conversation", a copy of the
-- whole conversation as it stands is saved here, so what was said
-- survives even if the conversation is later cleared. Only admins can
-- read reports. Every time an admin opens a report, or opens a
-- conversation another way, a row goes in the log with who, when and
-- why, and the log is visible to every admin.
--
-- Applied by hand in the Supabase SQL editor, like the others.
-- =============================================================

create table if not exists public.board_reports (
  id              uuid        primary key default gen_random_uuid(),
  conversation_id uuid,
  reported_by     uuid        references public.profiles (id) on delete set null,
  reason          text,
  subject         text        not null,
  snapshot        jsonb       not null,
  status          text        not null default 'open' check (status in ('open', 'reviewed')),
  created_at      timestamptz not null default now()
);
create index if not exists board_reports_status_idx on public.board_reports (status, created_at desc);

create table if not exists public.board_review_log (
  id              uuid        primary key default gen_random_uuid(),
  admin_id        uuid        references public.profiles (id) on delete set null,
  kind            text        not null check (kind in ('report', 'conversation')),
  report_id       uuid,
  conversation_id uuid,
  reason          text,
  created_at      timestamptz not null default now()
);

alter table public.board_reports    enable row level security;
alter table public.board_review_log enable row level security;
grant all on table public.board_reports    to service_role;
grant all on table public.board_review_log to service_role;
