-- =============================================================
-- Board: question topics, with a discussion under each answer.
--
-- A topic can be marked as a question (is_question). People answer it
-- with ordinary posts; each answer can then be discussed, and those
-- replies hang under that one answer (reply_to points at the answer).
-- Only one level: a reply to a reply is still a reply to the answer.
--
-- Deleting an answer deletes the discussion under it (cascade), the
-- same way deleting a thread deletes its posts.
--
-- Idempotent — safe to re-apply.
-- =============================================================

alter table public.board_threads
  add column if not exists is_question boolean not null default false;

alter table public.board_posts
  add column if not exists reply_to uuid references public.board_posts (id) on delete cascade;

create index if not exists board_posts_reply_to_idx
  on public.board_posts (reply_to)
  where reply_to is not null;
