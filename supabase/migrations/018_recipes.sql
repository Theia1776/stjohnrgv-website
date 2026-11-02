-- =============================================================
-- An Orthodox Table — the parish recipe collection.
--
-- Two books in one table, told apart by `fasting`:
--   fasting = true   the Fasting (vegan) book — no meat, dairy, eggs
--   fasting = false  everything else anyone wants to share
--
-- Members and catechumens submit their own; nothing appears until an
-- admin posts it (`published`), the same shape as the library's Hidden
-- tier. A recipe labelled fasting that isn't is the thing worth
-- catching, and only a person can catch it.
--
-- Anyone may read a posted recipe, signed in or not — people search for
-- Orthodox Lenten cooking, and this is a good door into the parish.
-- Submitting needs an account.
--
-- On the variable-length parts: a recipe has as many ingredients and
-- steps as it has. They are stored as text arrays rather than one blob
-- so the page can lay ingredients in two columns and number the steps
-- itself, and so a single step can be edited without re-saving the
-- whole recipe as prose.
--
-- Idempotent — safe to re-apply.
-- =============================================================

create table if not exists public.recipes (
  id            uuid        primary key default gen_random_uuid(),
  slug          text        not null unique,
  title         text        not null,

  -- Which book it belongs to.
  fasting       boolean     not null default true,

  -- The line under the title, as on a recipe card. All optional: a
  -- pot of beans has no preheat temperature and nobody times prosphora
  -- to the minute.
  hands_on      text,
  total_time    text,
  serves        text,
  preheat       text,

  -- A sentence or two before the ingredients, if the cook wants one.
  intro         text,

  -- As many as the recipe has.
  ingredients   text[]      not null default '{}',
  directions    text[]      not null default '{}',

  -- Anything after the steps: substitutions, what it goes with, whose
  -- recipe it was.
  notes         text,

  -- Who sent it. The name is kept alongside the id so a recipe still
  -- reads "from Maria" if that account is ever removed — the parish
  -- keeps the gift even when the giver moves on.
  submitted_by      uuid references auth.users (id) on delete set null,
  submitted_by_name text,

  -- Admins only until posted.
  published     boolean     not null default false,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- The two book listings, newest first.
create index if not exists recipes_fasting_published_idx
  on public.recipes (fasting, published, created_at desc);

-- The admin queue: what is waiting to be looked at.
create index if not exists recipes_pending_idx
  on public.recipes (created_at desc)
  where published = false;

-- Touch updated_at on every UPDATE (mirrors library_books).
create or replace function public.recipes_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists recipes_set_updated_at on public.recipes;
create trigger recipes_set_updated_at
  before update on public.recipes
  for each row execute function public.recipes_set_updated_at();

alter table public.recipes enable row level security;

-- Anyone may read a posted recipe, signed in or not. Unposted ones are
-- invisible to everybody here; the admin endpoints reach them with the
-- service-role key after checking profiles.role = 'admin'.
drop policy if exists "recipes: anyone reads posted" on public.recipes;
create policy "recipes: anyone reads posted"
  on public.recipes
  for select
  to anon, authenticated
  using (published);

-- No INSERT / UPDATE / DELETE policies — writes go through
-- functions/api/recipes (which checks the submitter's role) and
-- functions/api/admin/recipes.

-- =============================================================
-- Table-level GRANTs (see 004 for the rationale).
-- =============================================================
grant all on table public.recipes to service_role;
grant select on table public.recipes to anon, authenticated;
