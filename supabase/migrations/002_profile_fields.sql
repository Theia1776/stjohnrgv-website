-- =============================================================
-- Add the editable profile fields used by /account and
-- functions/api/profile.ts/index.ts. Each ADD COLUMN is
-- idempotent so this can be re-applied safely against any
-- environment that may already have some of the columns.
-- =============================================================

alter table public.profiles add column if not exists first_name              text;
alter table public.profiles add column if not exists last_name               text;
alter table public.profiles add column if not exists phone                   text;
alter table public.profiles add column if not exists avatar_url              text;
alter table public.profiles add column if not exists emergency_name          text;
alter table public.profiles add column if not exists emergency_relationship  text;
alter table public.profiles add column if not exists emergency_phone         text;
alter table public.profiles add column if not exists emergency_name_2        text;
alter table public.profiles add column if not exists emergency_relationship_2 text;
alter table public.profiles add column if not exists emergency_phone_2       text;
alter table public.profiles add column if not exists opt_in_communications   boolean not null default false;
