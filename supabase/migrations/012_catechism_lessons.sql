-- =============================================================
-- Catechism lessons — one row per lesson posted to member accounts.
--
-- Lessons are PDFs Fr. Antonios (or the diocese) sends the parish.
-- An admin uploads each one from /admin/catechism/ and it appears
-- immediately in every signed-in member's My Account page. There is
-- no code push or rebuild involved — same table-driven pattern as
-- library_books (migration 005).
--
-- Storage: the PDF itself goes into the EXISTING "library" bucket
-- under a `catechism/` prefix, so no new bucket has to be created in
-- the Supabase dashboard. pdf_storage_key holds the full key,
-- e.g. "catechism/Lesson 3 - The Creed.pdf".
--
-- Visibility is deliberately simpler than the library's three tiers:
--   published = true   → every signed-in member sees it. (default)
--   published = false  → draft; admins only, for a lesson you want
--                        stored now and posted later.
-- Catechism lessons are never public to logged-out visitors.
--
-- Read access: authenticated members via the service-role-backed API
-- in functions/api/catechism/. Writes: service-role only through
-- functions/api/admin/catechism/*, which check profiles.role = 'admin'.
--
-- Idempotent — safe to re-apply.
-- =============================================================

create table if not exists public.catechism_lessons (
  id               uuid        primary key default gen_random_uuid(),
  slug             text        not null unique,
  title            text        not null,
  -- Who taught or sent the lesson (optional) — e.g. "Fr. Antonios".
  teacher          text,
  -- Optional grouping so a multi-part course stays together in the
  -- member's list, e.g. "Introduction to the Faith".
  series           text,
  -- The date of the lesson itself (not the upload date), used as the
  -- primary sort so lessons read in the order they were given.
  lesson_date      date,
  description      text,
  -- Full key inside the "library" storage bucket, always prefixed
  -- "catechism/". Unique so two lesson rows can't claim one file.
  pdf_storage_key  text        not null unique,
  published        boolean     not null default true,
  -- Stamped when the "notify members" email actually went out, so the
  -- admin list can show whether a lesson was announced and we never
  -- double-send for the same upload.
  notified_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists catechism_lessons_published_idx
  on public.catechism_lessons (published)
  where published = true;

create index if not exists catechism_lessons_lesson_date_idx
  on public.catechism_lessons (lesson_date desc nulls last, created_at desc);

-- Touch updated_at on every UPDATE (mirrors library_books).
create or replace function public.catechism_lessons_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists catechism_lessons_set_updated_at on public.catechism_lessons;
create trigger catechism_lessons_set_updated_at
  before update on public.catechism_lessons
  for each row execute function public.catechism_lessons_set_updated_at();

alter table public.catechism_lessons enable row level security;

-- Members read published lessons. Drafts stay invisible to everyone
-- but the admin endpoints (service role). Anon gets no policy at all,
-- so logged-out visitors can never read this table.
drop policy if exists "catechism_lessons: authenticated read" on public.catechism_lessons;
create policy "catechism_lessons: authenticated read"
  on public.catechism_lessons
  for select
  to authenticated
  using (published);

-- No INSERT / UPDATE / DELETE policies — writes go through the
-- service-role key in functions/api/admin/catechism/*, which check
-- profiles.role = 'admin' before each mutation.

-- =============================================================
-- Table-level GRANTs (see 004 for the rationale).
-- =============================================================
grant all on table public.catechism_lessons to service_role;
grant select on table public.catechism_lessons to authenticated;
