/**
 * The categories of An Orthodox Table.
 *
 * Two levels: a handful of groups, each holding the kinds of dish that
 * belong to it. One list, shared by the share form, the two book pages
 * and the admin screen, so a category can never exist in one place and
 * not another.
 *
 * Every group ends in "Misc." on purpose. A fixed list always meets a
 * dish it has no shelf for, and a cook who can't find the right one
 * either picks something wrong or gives up — both worse than a shelf
 * labelled "other things".
 *
 * Fasting cooking is why Main Courses carries Fish & Seafood, Beans &
 * Lentils and Vegetables alongside the meats: in the fasting book those
 * ARE the main courses, and a collection that only offers meat
 * categories has nowhere to put half of what the parish eats.
 *
 * Adding to this list is safe — `recipes.category` is plain text with
 * no constraint, so a new category needs no migration. Removing one
 * leaves existing recipes pointing at a name no longer offered, which
 * is why nothing here should be deleted without moving those recipes
 * first.
 */

export interface CategoryGroup {
  group: string;
  categories: string[];
}

export const RECIPE_CATEGORIES: CategoryGroup[] = [
  {
    group: "Soups & Sides",
    categories: ["Soups", "Breads", "Sides", "Salads", "Misc."],
  },
  {
    group: "Main Courses",
    categories: [
      "Beef",
      "Chicken",
      "Lamb",
      "Pork",
      "Turkey",
      "Fish & Seafood",
      "Beans & Lentils",
      "Vegetables",
      "Pasta & Grains",
      "Misc.",
    ],
  },
  {
    group: "Desserts",
    categories: ["Cakes", "Pies", "Cookies", "Pastries", "Puddings & Custards", "Misc."],
  },
  {
    // Drinks were landing in "Soups & Sides — Misc." for want of
    // anywhere better, which is where a lemonade does not belong.
    group: "Drinks",
    categories: ["Hot Drinks", "Cold Drinks", "Punches", "Misc."],
  },
];

/**
 * The stored value. "Misc." repeats across groups, so a category is
 * kept as "Group — Category" and stays unambiguous on its own, which
 * matters because a printed recipe sheet carries the category with no
 * surrounding page to explain it.
 */
export function categoryValue(group: string, category: string): string {
  return `${group} — ${category}`;
}

/** Every value, in the order they are offered. */
export function allCategoryValues(): string[] {
  return RECIPE_CATEGORIES.flatMap((g) => g.categories.map((c) => categoryValue(g.group, c)));
}

/** The group a stored value belongs to, for grouping a listing. */
export function groupOf(value: string | null | undefined): string {
  if (!value) return "";
  const [group] = String(value).split(" — ");
  return RECIPE_CATEGORIES.some((g) => g.group === group) ? group : "";
}

/** The category half, for a short label beside a recipe's name. */
export function categoryOf(value: string | null | undefined): string {
  if (!value) return "";
  const parts = String(value).split(" — ");
  return parts.length > 1 ? parts.slice(1).join(" — ") : parts[0];
}
