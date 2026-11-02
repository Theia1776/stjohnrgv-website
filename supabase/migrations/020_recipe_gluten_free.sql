-- =============================================================
-- An Orthodox Table — the gluten-free mark.
--
-- A flag rather than a third book, because gluten has nothing to do
-- with fasting: a lentil soup can be both, a Pascha bread neither. Made
-- a column instead of a category so a gluten-free dish keeps its real
-- shelf — a cook wanting a gluten-free dessert should find it under
-- Desserts, not in a separate collection where the cakes are hidden.
--
-- `false` is the honest default and that is why it is NOT NULL. Null
-- would mean "unknown", and the page would then have to decide what to
-- do with unknown — and the only safe answer is to leave it out, which
-- is what false already does. Nothing is listed as gluten-free until a
-- person says so.
--
-- **Never set this by reading ingredients.** Marking a recipe
-- gluten-free is a health claim about somebody with coeliac disease, and
-- gluten hides in soy sauce, stock cubes, oats, malt and seasoning
-- blends. Ingredient-matching may warn that a recipe looks like it
-- contains gluten (see src/lib/recipe-gluten.ts, which the admin page
-- uses to flag a mark that looks wrong) but it must never grant the
-- mark. Only the cook who made it or the admin who read it may.
--
-- Idempotent — safe to re-apply.
-- =============================================================

alter table public.recipes
  add column if not exists gluten_free boolean not null default false;

-- For the gluten-free listing, which crosses both books.
create index if not exists recipes_gluten_free_idx
  on public.recipes (gluten_free, published)
  where gluten_free;
