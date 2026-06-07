-- =============================================================
-- Password reset codes — one row per "forgot password" request.
--
-- The member enters their email on /reset-password; the
-- /api/auth/forgot endpoint (service-role key) generates a short
-- numeric code, stores only its HMAC here, and emails the plaintext
-- code via Resend. The member then submits the code plus a new
-- password to /api/auth/reset, which verifies the HMAC, sets the new
-- password through the Supabase Admin API, and marks the row consumed.
--
-- We never store the plaintext code. `code_hash` is an HMAC-SHA256 of
-- the code keyed by the service-role key (see src/lib/reset-code.ts),
-- so a leaked table dump can't be reversed into working codes without
-- the key — and even then the 5-attempt / 15-minute limits below make
-- a 6-digit code impractical to guess online.
--
-- Writes happen exclusively server-side via the service-role key in
-- functions/api/auth/forgot.ts and functions/api/auth/reset.ts. There
-- is intentionally NO RLS policy: this table is pre-authentication
-- (the user isn't logged in yet) so neither the anon nor authenticated
-- role should ever read or write it directly.
--
-- Idempotent — safe to re-apply.
-- =============================================================

create table if not exists public.password_resets (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  email       text        not null,
  code_hash   text        not null,
  attempts    int         not null default 0,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);

-- Looked up by email when verifying a submitted code, and when
-- rate-limiting how many codes a single email may request.
create index if not exists password_resets_email_idx
  on public.password_resets (email);

-- Used to expire/clean stale rows.
create index if not exists password_resets_expires_at_idx
  on public.password_resets (expires_at);

alter table public.password_resets enable row level security;

-- No RLS policies on purpose. All access is server-side via the
-- service-role key, which bypasses RLS. Leaving the table with RLS
-- enabled and zero policies means a stray anon/authenticated query
-- gets nothing back.

-- =============================================================
-- Table-level GRANTs.
--
-- RLS controls *which rows* a role can touch; GRANTs control whether
-- the role can attempt the operation at all. Without this, even the
-- service-role key gets "permission denied" on the table.
--
-- service_role: full access — used by the two /api/auth functions.
-- anon / authenticated: intentionally NOTHING. This table is only
--   ever touched server-side, before the user has a session.
-- =============================================================
grant all on table public.password_resets to service_role;
