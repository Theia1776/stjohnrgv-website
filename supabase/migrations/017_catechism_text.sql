-- =============================================================
-- Catechism lessons — extracted text, with page markers.
--
-- The same treatment library_books got in migrations 015 and 016, for
-- the same reason: a lesson you can't search is a lesson you have to
-- remember the right page of. These are taught from and quoted in
-- class, so finding the passage matters more here than anywhere.
--
-- Extraction happens in the admin's browser at upload (PDF.js, already
-- loaded on that page), never on the server: a Cloudflare Function's
-- CPU budget will not read a long PDF, and the browser does it for
-- free while the upload is being filled in.
--
-- text_status records which case a lesson is in, so the reader can say
-- so plainly instead of showing a blank page:
--
--   'ok'      → text extracted and stored
--   'empty'   → extraction ran and found nothing (a scan; needs OCR,
--               which this does not attempt)
--   'error'   → extraction failed (corrupt or encrypted file)
--   null      → never attempted (every lesson predating this migration)
--
-- text_chars is kept separately so the lesson list can say which
-- lessons are searchable without hauling every lesson's full text
-- across the wire.
--
-- text_pages is how many pages the text carries markers for. A lesson
-- extracted before markers existed reads text_status = 'ok' with
-- text_pages = 0, which is how the admin backfill finds the ones still
-- needing a re-read.
--
-- Idempotent — safe to re-apply.
-- =============================================================

alter table public.catechism_lessons
  add column if not exists text_content      text,
  add column if not exists text_chars        integer not null default 0,
  add column if not exists text_status       text,
  add column if not exists text_pages        integer not null default 0,
  add column if not exists text_extracted_at timestamptz;

-- Finds lessons still needing extraction, for the admin backfill.
create index if not exists catechism_lessons_text_status_idx
  on public.catechism_lessons (text_status);

-- Finds lessons whose text predates page markers.
create index if not exists catechism_lessons_text_pages_idx
  on public.catechism_lessons (text_pages)
  where text_pages = 0;

-- =============================================================
-- Note on reads: text_content is deliberately NOT added to the lesson
-- list query in functions/api/catechism/lessons.ts. Sending every
-- lesson's full text to every member on every page load would be
-- absurd, and the list only needs to know whether text exists. It is
-- served one lesson at a time by functions/api/catechism/text.ts.
--
-- The existing RLS policy covers this column unchanged: an
-- authenticated member may select a published row, and drafts remain
-- invisible to everyone but the service-role admin endpoints. No
-- policy change is needed.
-- =============================================================
