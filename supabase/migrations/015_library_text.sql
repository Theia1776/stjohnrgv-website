-- =============================================================
-- Library books — extracted text.
--
-- Each PDF's text is pulled out once, in the admin's browser at upload
-- time (PDF.js, the same library the reader already uses), and stored
-- here. Two things come of that:
--
--   1. The reader can offer a "Text" view — reflowing text that sizes
--      up and wraps to a phone screen, instead of a fixed page you have
--      to pinch. It opens instantly because the text is already here.
--   2. It makes searching INSIDE books possible later, rather than only
--      across titles and authors.
--
-- Extraction happens in the browser rather than on the server on
-- purpose: a 300-page book would blow through a Cloudflare Function's
-- CPU budget, and the admin's browser has PDF.js loaded already.
--
-- Not every book yields text. A scanned book — photographs of pages —
-- has none to give, and needs OCR, which this does not attempt.
-- text_status records which case a book is in so the reader can say so
-- plainly instead of showing a blank page:
--
--   'ok'      → text extracted and stored
--   'empty'   → extraction ran and found nothing (a scan)
--   'error'   → extraction failed (corrupt or encrypted file)
--   null      → never attempted (every book predating this migration)
--
-- text_chars is kept separately so the catalog API can report whether a
-- book has text without hauling the text itself across the wire.
--
-- Idempotent — safe to re-apply.
-- =============================================================

alter table public.library_books
  add column if not exists text_content     text,
  add column if not exists text_chars       integer not null default 0,
  add column if not exists text_status      text,
  add column if not exists text_extracted_at timestamptz;

-- Finds books still needing extraction, for the admin backfill.
create index if not exists library_books_text_status_idx
  on public.library_books (text_status);

-- =============================================================
-- Note on reads: text_content is deliberately NOT added to the
-- catalog query in functions/api/library/books.ts — sending every
-- book's full text to every visitor would be absurd. It is served one
-- book at a time by functions/api/library/text.ts, which applies the
-- same public / parishioner / hidden rules as the PDF endpoint.
--
-- The existing RLS policies on library_books cover this column as they
-- stand: a parishioner may select a non-hidden row, anon only a public
-- one. No policy change is needed.
-- =============================================================
