-- =============================================================
-- A poll has its own question, and a reported post is hidden
--
--   * board_polls.question: what the poll asks, separate from the
--     topic's title.
--
--   * board_posts.reported_hidden: pressing Report on a post pulls it
--     from the board for everyone but moderators and admins until one
--     of them restores it. Its words and photos aren't sent to anyone
--     else while it's set. Restoring clears the reports on it.
--
--   * the Moderation Forum's description now says what it's for.
--
-- Applied by hand in the Supabase SQL editor, like the others.
-- =============================================================

alter table public.board_polls add column if not exists question text;
alter table public.board_posts add column if not exists reported_hidden boolean not null default false;

update public.board_categories
   set description = 'For moderators and admins. Help requests and reported posts land here.'
 where slug = 'moderation';

-- And the reason a post was reported (added the same day).
alter table public.board_post_reports add column if not exists reason text;
