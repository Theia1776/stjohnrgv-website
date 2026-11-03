-- =============================================================
-- Newsletter images.
--
-- Sections already carry their own photographs: `sections` is jsonb,
-- so `image`, `image_alt`, `image_caption`, `quote` and `quote_by`
-- needed no migration. This adds only the one image that belongs to
-- the issue rather than to any section — the photograph under the
-- masthead.
--
-- Stored as a bare R2 key (`newsletter/<slug>/<file>`) and not a URL,
-- so the route that serves it can change without rewriting every issue
-- that was ever published. An absolute URL is also accepted, for a
-- photograph already hosted elsewhere.
--
-- The alt text is a separate column and not optional in spirit: the
-- newsletter goes out by email to people who may be using a screen
-- reader, and a parish photograph described as "image" tells them
-- nothing. The admin form asks for it next to the file.
--
-- Idempotent — safe to re-apply.
-- =============================================================

alter table public.newsletters
  add column if not exists hero_image text,
  add column if not exists hero_image_alt text;
