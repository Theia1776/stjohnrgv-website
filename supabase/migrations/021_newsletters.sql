-- =============================================================
-- The parish newsletter.
--
-- An issue is written once and used twice: it gets a page on the site
-- that can be linked and read later, and it is sent to the parish by
-- email. One row is the single source for both, so the email and the
-- page can never say different things.
--
-- Sections rather than one block of text. A newsletter is a handful of
-- separate items — a word from Fr. Antonios, what is on this month,
-- who to pray for — and keeping them apart means the page can give
-- each a heading and the email can be laid out rather than poured out.
-- Stored as jsonb: [{ "heading": "...", "body": "..." }].
--
-- `audience` defaults to 'parish', and that default is the careful one
-- on purpose. A newsletter carries names: who is ill, who is
-- travelling, whose child was baptised. Getting that wrong in the
-- direction of "public" publishes a parishioner's illness to the open
-- internet, and there is no taking it back. An issue that is genuinely
-- outward-facing can be switched to 'public' per issue, deliberately,
-- on the admin screen.
--
-- Sending is recorded on the row itself — when, to how many, and what
-- failed — because the question an admin asks a week later is "did
-- that go out?", and the answer should live with the thing that went.
--
-- Idempotent — safe to re-apply.
-- =============================================================

create table if not exists public.newsletters (
  id            uuid        primary key default gen_random_uuid(),
  slug          text        not null unique,

  -- "Nativity Fast Begins". The headline of the issue.
  title         text        not null,
  -- "November 2026", "Issue 3" — whatever the parish calls it. Shown
  -- above the title, optional, because the first few issues of
  -- anything are usually numbered after the fact.
  issue_label   text,

  -- A paragraph or two before the sections, if the writer wants one.
  intro         text,

  -- [{ heading, body }] — as many as the issue has.
  sections      jsonb       not null default '[]'::jsonb,

  -- Anything after the sections: a closing line, service times.
  closing       text,

  -- 'parish' — signed-in accounts only. 'public' — anyone.
  audience      text        not null default 'parish',

  -- Admins only until published, the same shape as the recipe queue
  -- and the library's Hidden tier.
  published     boolean     not null default false,
  published_at  timestamptz,

  -- The record of the send, kept beside what was sent.
  sent_at       timestamptz,
  sent_count    integer     not null default 0,
  sent_attempted integer    not null default 0,
  send_error    text,

  written_by      uuid      references auth.users (id) on delete set null,
  written_by_name text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- The back-issue listing, newest first.
create index if not exists newsletters_published_idx
  on public.newsletters (published, published_at desc);

-- Touch updated_at on every UPDATE (mirrors recipes).
create or replace function public.newsletters_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists newsletters_set_updated_at on public.newsletters;
create trigger newsletters_set_updated_at
  before update on public.newsletters
  for each row execute function public.newsletters_set_updated_at();

alter table public.newsletters enable row level security;

-- Only the public, published issues are readable without a key. The
-- parish-only ones are deliberately NOT exposed here: the API reads
-- them with the service-role key after checking the viewer is signed
-- in, the same way the everyday recipe book works. Leaving them to a
-- policy would mean trusting the anon key with them.
drop policy if exists "newsletters: anyone reads published public" on public.newsletters;
create policy "newsletters: anyone reads published public"
  on public.newsletters
  for select
  to anon, authenticated
  using (published and audience = 'public');

-- No INSERT / UPDATE / DELETE policies — writes go through
-- functions/api/admin/newsletter/*.

-- =============================================================
-- Table-level GRANTs (see 004 for the rationale).
-- =============================================================
grant all on table public.newsletters to service_role;
grant select on table public.newsletters to anon, authenticated;
