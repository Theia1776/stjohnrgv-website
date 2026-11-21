-- =============================================================
-- Site alerts: remembers which warnings have already been emailed,
-- so the storage warning goes out once per threshold and not on every
-- upload. One row per alert; deleting the row lets it fire again.
--
-- Applied by hand in the Supabase SQL editor, like the others.
-- =============================================================
create table if not exists public.site_alerts (
  key     text        primary key,
  sent_at timestamptz not null default now()
);

alter table public.site_alerts enable row level security;
grant all on table public.site_alerts to service_role;
