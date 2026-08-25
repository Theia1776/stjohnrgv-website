-- =============================================================
-- Library books — page markers in the extracted text.
--
-- The first pass at extraction (migration 015) separated pages with a
-- blank line but recorded nothing about WHICH page was which, so the
-- text view could not tell a reader what page a passage came from. That
-- matters: these texts are cited in class.
--
-- Extraction now writes a marker between pages, and the reader parses
-- them back out to show page dividers, to say which page a search hit
-- is on, and to open that page in the scanned view where the printed
-- number is visible.
--
-- text_pages is how many pages that text carries markers for. It exists
-- so the admin backfill can find books extracted BEFORE markers existed
-- (text_status = 'ok' and text_pages = 0) and re-read just those,
-- skipping the ones already done. Scans and failures are untouched —
-- they have no text either way.
--
-- On page numbering: where a PDF carries proper page labels (many do,
-- covering front matter as i, ii, iii before 1, 2, 3) those real
-- printed numbers are used. Where it doesn't, the PDF's own page
-- position is used, which can sit a few pages off what is printed on
-- the paper.
--
-- Idempotent — safe to re-apply.
-- =============================================================

alter table public.library_books
  add column if not exists text_pages integer not null default 0;

-- Finds books whose text predates page markers.
create index if not exists library_books_text_pages_idx
  on public.library_books (text_pages)
  where text_pages = 0;
