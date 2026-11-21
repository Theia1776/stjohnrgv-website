-- =============================================================
-- Board file attachments
--
-- A post can carry files: a catechumen lesson, a newsletter, a flier.
-- The files live in the same R2 bucket as the library and the photos
-- (LIBRARY_BUCKET), under board-files/<id>, because R2 charges nothing
-- for people downloading them and the first 10 GB is free. This table
-- is the record of which file belongs to which post.
--
-- Admins can attach any size the server can take. Everyone else is held
-- to a small limit (see src/lib/board-files.ts) so the free storage
-- stays free.
--
-- Each file is kept forever, or goes away 30 days after it is posted
-- (keep_days = 30 -> expires_at is set when the post is made). Expired
-- files stop being offered at once and are deleted from storage the
-- next time anyone loads the board.
--
-- Like photos, a file starts with no post: it uploads the moment it is
-- picked and is attached when the person presses Submit. One that never
-- gets attached is swept up after 24 hours.
--
-- Applied by hand in the Supabase SQL editor, like the others.
-- =============================================================
create table if not exists public.board_files (
  id           uuid        primary key default gen_random_uuid(),
  post_id      uuid        references public.board_posts (id) on delete cascade,
  uploader_id  uuid        references public.profiles (id) on delete set null,
  name         text        not null check (char_length(name) between 1 and 200),
  content_type text,
  bytes        bigint      not null check (bytes >= 0),
  keep_days    int         check (keep_days is null or keep_days = 30),
  expires_at   timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists board_files_post_idx on public.board_files (post_id);
create index if not exists board_files_expiry_idx on public.board_files (expires_at) where expires_at is not null;
create index if not exists board_files_pending_idx
  on public.board_files (uploader_id, created_at) where post_id is null;

alter table public.board_files enable row level security;
grant all on table public.board_files to service_role;
