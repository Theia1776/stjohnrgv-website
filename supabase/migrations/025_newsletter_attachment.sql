-- =============================================================
-- A file attached to the newsletter email.
--
-- The parish lays the newsletter out in a design tool and exports a
-- PDF. That PDF is the newsletter. The website page and the email body
-- still exist and still say the same things, but the thing people
-- actually keep and print is the file, so the email has to carry it.
--
-- Stored as a bare R2 key (`newsletter/<slug>/<file>`), the same way
-- hero_image is, so the route that serves it can change without
-- rewriting every issue ever published.
--
-- The filename is kept separately because the key has a random tail on
-- it to stop two uploads called "newsletter.pdf" overwriting each
-- other, and nobody wants `november-2026-a3f9c1.pdf` landing in their
-- inbox. The size is kept so the admin screen can say plainly how big
-- the thing is before it goes to a hundred mailboxes.
--
-- Idempotent — safe to re-apply.
-- =============================================================

alter table public.newsletters
  add column if not exists attachment_key text,
  add column if not exists attachment_name text,
  add column if not exists attachment_bytes bigint;
