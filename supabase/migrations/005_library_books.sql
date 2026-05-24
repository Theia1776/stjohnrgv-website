-- =============================================================
-- Library books — one row per book in the parish digital library.
--
-- Replaces src/data/library/books.json so admins can add books
-- through /admin/library/ without a code push and rebuild. The
-- PDF file itself still lives in Supabase Storage under the
-- existing "library" bucket; this table tracks the metadata
-- (title, author, category, languages, description) and the
-- exact storage key the bucket holds.
--
-- Read access: any logged-in parishioner (the library is gated
-- by /functions/learn/library middleware, so anon never reaches
-- the API). Write access: service-role only via the admin
-- endpoints in functions/api/admin/library/, which enforce
-- profiles.role = 'admin' before mutating.
--
-- Idempotent — safe to re-apply.
-- =============================================================

create table if not exists public.library_books (
  id               uuid        primary key default gen_random_uuid(),
  slug             text        not null unique,
  title            text        not null,
  author           text,
  category         text        not null default 'Other',
  -- Stored as a Postgres array so the admin form can edit
  -- per-book languages without a join table. Most books are
  -- English-only; bilingual texts like the Divine Liturgy have
  -- two entries.
  languages        text[]      not null default array['English']::text[],
  description      text,
  -- Filename inside the "library" storage bucket. Unique so a
  -- single PDF can't be claimed by two different book rows; the
  -- admin POST endpoint enforces this before uploading.
  pdf_storage_key  text        not null unique,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists library_books_category_idx
  on public.library_books (category);

create index if not exists library_books_created_at_idx
  on public.library_books (created_at desc);

-- Touch updated_at on every UPDATE so the admin list can sort
-- by "recently changed" without the API having to manage it.
create or replace function public.library_books_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists library_books_set_updated_at on public.library_books;
create trigger library_books_set_updated_at
  before update on public.library_books
  for each row execute function public.library_books_set_updated_at();

alter table public.library_books enable row level security;

-- Any authenticated user can read every book. Matches the prior
-- behaviour where books.json shipped to every parishioner's
-- browser via the static page build.
drop policy if exists "library_books: authenticated read" on public.library_books;
create policy "library_books: authenticated read"
  on public.library_books
  for select
  to authenticated
  using (true);

-- No INSERT / UPDATE / DELETE policies — writes go through the
-- service-role key in functions/api/admin/library/* which check
-- profiles.role = 'admin' before each mutation.

-- =============================================================
-- Table-level GRANTs (see 004 for the rationale).
-- =============================================================
grant all on table public.library_books to service_role;
grant select on table public.library_books to authenticated;

-- =============================================================
-- Seed the two books that previously lived in
-- src/data/library/books.json so the library doesn't go empty
-- the moment we cut over to the table-driven render.
--
-- ON CONFLICT (slug) DO NOTHING — re-running the migration in an
-- environment that already has these rows is a no-op.
-- =============================================================
insert into public.library_books (slug, title, author, category, languages, description, pdf_storage_key)
values
  (
    'divine-liturgy-chrysostom',
    'The Divine Liturgy of Saint John Chrysostom',
    'Compiled by Priest Sergius Sveshnikov, 2012',
    'Liturgical Texts',
    array['English', 'Church Slavonic']::text[],
    'The complete text of the Divine Liturgy in parallel Church Slavonic and English, with the blessing of Archbishop Kyrill of San Francisco and Western America.',
    'Divine Liturgy of Saint John Chrysostom.pdf'
  ),
  (
    'life-of-st-nektarios',
    'Life of Saint Nektarios of Aegina',
    'Anonymous',
    'Hagiography',
    array['English']::text[],
    'The life of Saint Nektarios of Pentapolis (1846–1920), wonderworker and bishop, one of the most beloved saints of modern Orthodoxy. Glorified in 1961.',
    'Life of St Nektarios of Aegina.pdf'
  )
on conflict (slug) do nothing;
