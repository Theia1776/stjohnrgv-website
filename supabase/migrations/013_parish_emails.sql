-- =============================================================
-- Parish emails — a record of every message an admin sends from
-- /admin/email/.
--
-- The recipient list itself is NOT stored here. Registered members and
-- their addresses already live in auth.users, which is the one source
-- of truth: if someone changes their email, the next send picks up the
-- new address with no copying, syncing, or stale second list to
-- maintain. This table records what was sent, by whom, to how many,
-- and whether it went out — so an admin can answer "did that
-- announcement actually go?" without guessing.
--
-- Access: admin-only, through functions/api/admin/email.ts using the
-- service-role key. No policies are granted to `authenticated` or
-- `anon` — ordinary members can never read parish mail records.
--
-- Idempotent — safe to re-apply.
-- =============================================================

create table if not exists public.parish_emails (
  id             uuid        primary key default gen_random_uuid(),
  -- The admin who pressed send. References profiles rather than
  -- auth.users so the list can show a name without a second lookup.
  sent_by        uuid        references public.profiles (id) on delete set null,
  sent_by_name   text,
  subject        text        not null,
  body           text        not null,
  -- 'everyone' or 'individuals' — what the admin picked at send time.
  audience       text        not null default 'everyone',
  -- How many addresses the message was actually accepted for, and how
  -- many were attempted. A gap between them means some sends failed.
  recipient_count integer    not null default 0,
  attempted_count integer    not null default 0,
  -- Populated when at least one batch failed, for the admin to see.
  error          text,
  created_at     timestamptz not null default now()
);

create index if not exists parish_emails_created_at_idx
  on public.parish_emails (created_at desc);

alter table public.parish_emails enable row level security;

-- No policies at all: every read and write goes through the
-- service-role key in the admin endpoint, which checks
-- profiles.role = 'admin' first. Members have no path to this table.

-- =============================================================
-- Table-level GRANTs (see 004 for the rationale).
-- =============================================================
grant all on table public.parish_emails to service_role;
