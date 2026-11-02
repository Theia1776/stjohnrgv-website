/**
 * Deploying the gluten-free work ahead of its migration.
 *
 * The rule on this site is that a migration is applied before the code
 * that needs it, because selecting a column that doesn't exist fails
 * the *whole* query — one new field would have taken down both book
 * pages, every recipe card and the admin queue, not just the new
 * feature.
 *
 * This once, the code had to ship first: the migration can only be run
 * from a laptop and the person who runs it wasn't at one. So every
 * query that mentions `gluten_free` asks for it, and if Postgres says
 * there is no such column, asks again without it. Nothing breaks while
 * the column is missing; the gluten-free listing is simply empty,
 * which is true — nothing can be marked yet.
 *
 * **This file is temporary.** Once migration 020 is applied the
 * fallback paths never run again, and they should be taken out, along
 * with the `fields()` indirection, so the next person reading these
 * endpoints isn't left wondering which columns are real.
 */

/**
 * True when an error is the database saying `gluten_free` isn't there.
 *
 * It is reported two different ways, which is worth knowing because
 * checking for only one of them breaks the half you didn't check:
 *
 *   reading   `42703`    column recipes.gluten_free does not exist
 *   writing   `PGRST204` Could not find the 'gluten_free' column of
 *                        'recipes' in the schema cache
 *
 * A select would have fallen back correctly and a recipe submission
 * would have failed with a 500.
 *
 * The message must name this column either way. Some *other* missing
 * column is a real bug, and quietly retrying it would hide exactly the
 * kind of mistake this fallback makes easy to make.
 */
export function missingGlutenColumn(
  error: { message?: string; code?: string } | null | undefined,
): boolean {
  if (!error) return false;
  const message = String(error.message ?? "");
  if (!/gluten_free/.test(message)) return false;
  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    /does not exist|could not find/i.test(message)
  );
}

/**
 * A select list with or without the column, built from one place so the
 * two versions can't drift apart.
 */
export function recipeFields(parts: string[], withGluten: boolean): string {
  return (withGluten ? parts : parts.filter((p) => p !== "gluten_free")).join(", ");
}
