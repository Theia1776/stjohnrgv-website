-- =============================================================
-- Name days, baptism days and birthdays
--
-- Entirely optional, and month and day only: no years. A member can
-- add the day of their name saint (with the saint's name), the day of
-- their baptism, and their birthday. The board's front page shows
-- today's, and the next week's, to people on the board. Leaving a
-- field empty means it isn't shown.
--
-- Applied by hand in the Supabase SQL editor, like the others.
-- =============================================================

create table if not exists public.board_celebrations (
  user_id         uuid primary key references public.profiles (id) on delete cascade,
  name_day_month  int  check (name_day_month  between 1 and 12),
  name_day_day    int  check (name_day_day    between 1 and 31),
  name_day_saint  text check (char_length(name_day_saint) <= 60),
  baptism_month   int  check (baptism_month   between 1 and 12),
  baptism_day     int  check (baptism_day     between 1 and 31),
  birthday_month  int  check (birthday_month  between 1 and 12),
  birthday_day    int  check (birthday_day    between 1 and 31),
  updated_at      timestamptz not null default now()
);

alter table public.board_celebrations enable row level security;
grant all on table public.board_celebrations to service_role;
