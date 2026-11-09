-- =============================================================
-- Prayer requests
--
-- Names sent in by the parish for the newsletter's two lists: the
-- living, and the departed.
--
-- These are the most sensitive rows on this site. A prayer list says
-- who is ill, who is dying, whose marriage is in trouble and whose
-- child has died, and it names people who did not fill the form in
-- themselves. So:
--
--   * anyone may INSERT — the form has to work for a parishioner who
--     is not signed in, and for someone reading the newsletter on
--     their phone;
--   * nobody may SELECT. Not the public, not a signed-in member, not
--     the person who submitted it. Reading is done by the admin API
--     with the service role key, which bypasses RLS, so the only way
--     to see this table is to be an admin on this site.
--
-- There is deliberately no "my requests" view. A request is given to
-- the parish to pray over, not stored for the sender to manage, and
-- every route that could list these back to a browser is one more way
-- for a name to end up somewhere it should not be.
-- =============================================================

create table if not exists public.prayer_requests (
  id            uuid        primary key default gen_random_uuid(),

  -- 'living' or 'departed'. The newsletter prints two lists and the
  -- parish is asked for the names that way, so the distinction is
  -- made once, here, by the person who knows.
  kind          text        not null check (kind in ('living', 'departed')),

  -- "Ana G." or "the Gonzalez family". A first name and a last
  -- initial is what the parish asks for and all a prayer list needs;
  -- the column is short on purpose.
  name          text        not null check (length(btrim(name)) between 1 and 120),

  -- Who asked, so the office can follow up. Both optional: a request
  -- may be made anonymously and still be prayed over.
  requested_by  text,
  contact       text,

  -- Anything the sender wanted the priest to know. Not printed.
  note          text,

  -- 'new' until an admin has dealt with it, then 'included' once it
  -- has gone into an issue, or 'archived'.
  status        text        not null default 'new'
                            check (status in ('new', 'included', 'archived')),

  created_at    timestamptz not null default now()
);

create index if not exists prayer_requests_status_idx
  on public.prayer_requests (status, created_at desc);

alter table public.prayer_requests enable row level security;

-- Anyone may send one in.
drop policy if exists "prayer requests are open to send" on public.prayer_requests;
create policy "prayer requests are open to send"
  on public.prayer_requests
  for insert
  with check (true);

-- And nobody reads them through the API key. No select, update or
-- delete policy exists, so RLS denies all three to anon and to signed
-- in members alike. The admin routes use the service role.
