-- =============================================================
-- Board moderation
--
--   * moderators: members the admin trusts to help run the board.
--     A flag kept on the board, not a new role on the account, so
--     nothing else on the site (library, directory, lessons) changes
--     for them. They stay ordinary members everywhere else.
--
--   * rooms with an audience: a category can be for everyone, for
--     moderators and admins, or for admins alone. The server checks
--     this on every route that touches a category, a topic, a post or
--     a photo, so a room an account can't see doesn't exist for it.
--
--   * close requests: whoever started a topic can ask for it to be
--     closed to new replies. The request is written into the
--     Moderation Forum, and these columns remember that one is open
--     so it isn't asked twice and moderators can see which topics have
--     one waiting.
--
-- Applied by hand in the Supabase SQL editor, like the others.
-- =============================================================

alter table public.board_categories
  add column if not exists audience text not null default 'members'
  check (audience in ('members', 'moderators', 'admins'));

create table if not exists public.board_moderators (
  user_id    uuid        primary key references public.profiles (id) on delete cascade,
  added_by   uuid        references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.board_moderators enable row level security;
grant all on table public.board_moderators to service_role;

alter table public.board_threads
  add column if not exists close_requested_at timestamptz,
  add column if not exists close_requested_by uuid references public.profiles (id) on delete set null;

-- The two private rooms. Far down the list (900+) so they sit below
-- the parish's own rooms for the people who can see them.
insert into public.board_categories (slug, name, description, position, audience)
values
  ('moderation', 'Moderation Forum',
   'For moderators and admins. Requests to close a topic arrive here.', 900, 'moderators'),
  ('admin', 'Admin Forum',
   'Admins only.', 910, 'admins')
on conflict (slug) do nothing;
