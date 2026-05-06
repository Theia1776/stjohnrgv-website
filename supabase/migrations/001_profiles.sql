-- =============================================================
-- Profiles table — one row per registered user.
--
-- Created by the /api/auth/register endpoint (using the service-role
-- key, which bypasses RLS). Users can read their own row but cannot
-- modify it; approval is performed manually by an admin in the
-- Supabase dashboard.
--
-- The `id` column is a foreign key to auth.users so a profile is
-- automatically deleted if the underlying auth user is deleted.
-- =============================================================

create table if not exists public.profiles (
  id          uuid        primary key references auth.users(id) on delete cascade,
  email       text        not null,
  full_name   text        not null,
  role        text        not null default 'catechumen',
  approved    boolean     not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists profiles_email_idx on public.profiles (email);

alter table public.profiles enable row level security;

-- A signed-in user can read their own row (and only their own).
drop policy if exists "profiles: self read" on public.profiles;
create policy "profiles: self read"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

-- Intentionally no INSERT / UPDATE / DELETE policies for the anon or
-- authenticated roles. Inserts happen server-side via the service-role
-- key in functions/api/auth/register.ts. Approval changes happen in
-- the Supabase dashboard.
