-- =============================================================
-- Library books — Hidden / Staging tier.
--
-- Adds a `hidden` flag giving each book three visibility states:
--
--   hidden = true                          → Staging. Admins only. A
--                                            safe holding area: the book
--                                            and its PDF are stored, but
--                                            invisible to parishioners
--                                            and the public until an
--                                            admin promotes it.
--   hidden = false, public_access = false  → Parishioners only (login).
--   hidden = false, public_access = true   → Public (anyone).
--
-- The point is preservation + curation: every text can be uploaded into
-- the parish's own storage straight away (a second home beyond external
-- backups), then surfaced to parishioners or the public as needed.
--
-- Enforcement lives in the read APIs (functions/api/library/books.ts and
-- pdf.ts), which use the service-role key; the RLS policy updates below
-- are defense-in-depth for any direct client query. Admin endpoints in
-- functions/api/admin/library/* see everything (service role).
--
-- Idempotent — safe to re-apply.
-- =============================================================

alter table public.library_books
  add column if not exists hidden boolean not null default false;

-- Partial index over the visible subset — the parishioner/public catalog
-- query always filters hidden = false.
create index if not exists library_books_hidden_idx
  on public.library_books (hidden)
  where hidden = false;

-- Parishioner read: any authenticated user, but never a hidden book.
drop policy if exists "library_books: authenticated read" on public.library_books;
create policy "library_books: authenticated read"
  on public.library_books
  for select
  to authenticated
  using (not hidden);

-- Public read: anon, only public AND not hidden.
drop policy if exists "library_books: public read" on public.library_books;
create policy "library_books: public read"
  on public.library_books
  for select
  to anon
  using (public_access = true and not hidden);
