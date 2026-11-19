-- =============================================================
-- Board photos
--
-- A post can carry up to four photos: a dish from the kitchen, the
-- flier for an event. The picture files themselves live in the same
-- R2 bucket as the library (LIBRARY_BUCKET), under board/<photo id>/,
-- because R2 charges nothing for people looking at them and the first
-- 10 GB is free. This table is just the record of which photo belongs
-- to which post.
--
-- A photo starts with no post: it is uploaded the moment somebody
-- picks it, so they see it was accepted, and attached when they press
-- Submit. One that never gets attached (they changed their mind and
-- closed the tab) is swept up by the next upload after 24 hours.
--
-- What is stored is already shrunk by the browser to at most 1600
-- pixels on the long side, with a small thumbnail beside it, and the
-- server refuses anything bigger. That is the whole storage plan: a
-- photo costs a few hundred kilobytes, never a few megabytes.
--
-- Applied by hand in the Supabase SQL editor, like the others.
-- =============================================================
create table if not exists public.board_photos (
  id          uuid        primary key default gen_random_uuid(),
  post_id     uuid        references public.board_posts (id) on delete cascade,
  uploader_id uuid        references public.profiles (id) on delete set null,
  width       int         not null check (width  between 1 and 4000),
  height      int         not null check (height between 1 and 4000),
  bytes       int         not null,
  created_at  timestamptz not null default now()
);

create index if not exists board_photos_post_idx on public.board_photos (post_id);
create index if not exists board_photos_pending_idx
  on public.board_photos (uploader_id, created_at) where post_id is null;

alter table public.board_photos enable row level security;
grant all on table public.board_photos to service_role;
