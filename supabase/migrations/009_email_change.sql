-- =============================================================
-- Self-service email changes + a separate "directory email".
--
-- Two related additions:
--
-- 1. profiles.public_email — an optional address a member can show in
--    the parish directory INSTEAD of their sign-in email. Lets someone
--    log in with a personal address while listing, say,
--    parishoffice@stjohnrgv.org publicly. Display-only; no verification.
--
-- 2. email_changes — backs the verified sign-in-email change flow. When
--    a member changes their login email on /account, we email a code to
--    the NEW address and only switch the auth.users email once they
--    enter it (proving they own the new address). The master admin skips
--    this and changes immediately. Mirrors public.password_resets.
--
-- All access is server-side via the service-role key
-- (functions/api/account/change-email.ts and verify-email.ts), so RLS
-- is enabled with no policies.
--
-- Idempotent — safe to re-apply.
-- =============================================================

alter table public.profiles
  add column if not exists public_email text;

create table if not exists public.email_changes (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  new_email   text        not null,
  code_hash   text        not null,
  attempts    int         not null default 0,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists email_changes_user_id_idx
  on public.email_changes (user_id);

alter table public.email_changes enable row level security;

-- Server-side only (service-role bypasses RLS). No anon/authenticated
-- policies or grants on purpose.
grant all on table public.email_changes to service_role;
