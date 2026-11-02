-- =============================================================
-- An Orthodox Table — categories.
--
-- Two levels, stored as one string: "Main Courses — Lamb". The group
-- and the category are kept together because every group ends in
-- "Misc.", and "Misc." on its own says nothing — a printed recipe sheet
-- carries the category with no surrounding page to explain it.
--
-- Plain text with no constraint on purpose. The list lives in
-- src/lib/recipe-categories.ts, shared by the share form, both book
-- pages and the admin screen, so adding a category is a code change and
-- never a migration. Nothing in that list should be deleted without
-- first moving the recipes filed under it.
--
-- Null means not yet filed. A recipe arrives from a cook's kitchen
-- table and is filed when it's read, so unfiled is a normal state, not
-- an error — both book pages group those under "Not yet filed" rather
-- than hiding them.
--
-- Idempotent — safe to re-apply.
-- =============================================================

alter table public.recipes
  add column if not exists category text;

-- For filtering a book down to one kind of dish.
create index if not exists recipes_category_idx
  on public.recipes (category);
