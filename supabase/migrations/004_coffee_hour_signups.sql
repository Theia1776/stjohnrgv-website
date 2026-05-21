-- =============================================================
-- Coffee hour signups — one row per "I'll bring X on Sunday Y".
--
-- A parishioner picks an upcoming Sunday on /coffee-hour and
-- writes down what they're bringing. Multiple parishioners can
-- sign up for the same Sunday (potluck-style); a single
-- parishioner may also sign up more than once on the same
-- Sunday (e.g., one row for salad, one row for dessert).
--
-- Writes happen server-side via the service-role key in
-- functions/api/coffee-hour.ts; that endpoint enforces "must
-- own this row" before UPDATE/DELETE. Reads happen via the
-- self-read RLS policy below — any authenticated user can
-- read every row, which matches the intent ("everyone in the
-- parishioners section can see who's bringing what").
--
-- Idempotent — safe to re-apply.
-- =============================================================

create table if not exists public.coffee_hour_signups (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  sunday_date  date        not null,
  display_name text        not null,
  item         text        not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists coffee_hour_signups_sunday_date_idx
  on public.coffee_hour_signups (sunday_date);

create index if not exists coffee_hour_signups_user_id_idx
  on public.coffee_hour_signups (user_id);

alter table public.coffee_hour_signups enable row level security;

-- Any authenticated user can read every signup. Intentionally public
-- to the parishioners section — that's the whole point of the page.
drop policy if exists "coffee_hour_signups: authenticated read" on public.coffee_hour_signups;
create policy "coffee_hour_signups: authenticated read"
  on public.coffee_hour_signups
  for select
  to authenticated
  using (true);

-- No INSERT / UPDATE / DELETE policies — writes go through the
-- service-role key in functions/api/coffee-hour.ts which enforces
-- ownership in code.

-- =============================================================
-- Table-level GRANTs.
--
-- RLS controls *which rows* a role can touch; GRANTs control whether
-- the role can attempt the operation at all. Without these, even the
-- service-role key gets "permission denied" on the table.
--
-- service_role: full access — used by functions/api/coffee-hour.ts.
-- authenticated: DML access — defense-in-depth so a future direct-from-
--   client query (anon-key respecting RLS) would also work. Anon
--   intentionally gets nothing; this page is parishioners-only.
-- =============================================================
grant all on table public.coffee_hour_signups to service_role;
grant select, insert, update, delete on table public.coffee_hour_signups to authenticated;

