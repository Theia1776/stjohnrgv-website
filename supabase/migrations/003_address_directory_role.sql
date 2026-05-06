-- =============================================================
-- Day 13 schema additions for the /account profile page and the
-- new /admin/contacts admin views.
--
-- All three blocks are idempotent. They were run manually in the
-- Supabase SQL editor and are kept here for record-keeping so a
-- fresh environment can be brought up to parity by replaying every
-- migration in order.
-- =============================================================

-- 003a — Address fields
alter table public.profiles
  add column if not exists address_line1 text,
  add column if not exists address_line2 text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists zip text;

-- 003b — Directory opt-in + per-field consent
alter table public.profiles
  add column if not exists opt_in_directory        boolean not null default false,
  add column if not exists directory_show_phone    boolean not null default false,
  add column if not exists directory_show_email    boolean not null default false,
  add column if not exists directory_show_address  boolean not null default false;

-- 003c — Admin role
-- The `role` column was created in 001 with default 'catechumen'.
-- This block is a no-op when 001 has already run (IF NOT EXISTS).
-- Admin assignment is done by hand from the Supabase dashboard:
--   update public.profiles set role = 'admin' where id = '<auth.users.id>';
alter table public.profiles
  add column if not exists role text not null default 'member';
