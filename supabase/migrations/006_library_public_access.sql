-- =============================================================
-- Library books — per-book public access flag.
--
-- Adds a `public_access` boolean so admins can mark individual
-- texts as visitor-accessible. The library overall stays
-- parishioner-only by default; setting public_access = true on a
-- book lets anonymous (logged-out) visitors browse and read it.
--
-- The wiring on top of this column:
--   - GET /api/library/books returns only public books to anon
--     requests, all books to authenticated parishioners.
--   - GET /api/library/pdf?key=... signs the URL for anon
--     requests only when the key belongs to a public book.
--   - The page-level middleware that previously gated all of
--     /learn/library/* is removed; gating moves into the APIs.
--
-- Idempotent — safe to re-apply.
-- =============================================================

alter table public.library_books
  add column if not exists public_access boolean not null default false;

-- Partial index over the public subset so the anon-facing list
-- query is fast even as the catalog grows.
create index if not exists library_books_public_access_idx
  on public.library_books (public_access)
  where public_access = true;

-- Update the parishioner read policy to also let anon read public
-- books. Anon currently has NO SELECT grant on the table, so this
-- policy alone isn't enough — we also extend the GRANT below.
drop policy if exists "library_books: public read" on public.library_books;
create policy "library_books: public read"
  on public.library_books
  for select
  to anon
  using (public_access = true);

grant select on table public.library_books to anon;
