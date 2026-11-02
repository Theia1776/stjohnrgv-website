/**
 * Looking for gluten in a list of ingredients.
 *
 * This only ever says "this looks like it contains gluten". It never
 * says the opposite, and nothing on this site may use it to mark a
 * recipe gluten-free.
 *
 * The reason is the asymmetry: being wrong about gluten in one
 * direction is a noisy warning on an admin screen, and being wrong in
 * the other direction makes somebody with coeliac disease ill from food
 * their parish told them was safe. Word-matching over ingredients is
 * not good enough for the second. Gluten hides where no list expects
 * it — soy sauce is made with wheat, stock cubes and gravy granules
 * often are, oats are milled beside wheat, "natural flavouring" can be
 * barley malt — and a recipe's ingredient line says "1 cup flour"
 * without saying which.
 *
 * So the gluten-free mark is set by a person: the cook who made the
 * dish, or the admin who read it. What this file does is catch the
 * obvious contradiction — a recipe marked gluten-free with bread
 * crumbs in it — and show it to the admin as a question, never as a
 * decision.
 */

/**
 * Words that mean wheat, barley or rye, or a product usually made from
 * them. Rough on purpose: a false warning costs a second glance.
 */
const GLUTEN_WORDS = [
  // The grains themselves.
  "wheat",
  "barley",
  "rye",
  "spelt",
  "farro",
  "kamut",
  "bulgur",
  "semolina",
  "durum",
  "triticale",
  "einkorn",
  "freekeh",
  "seitan",
  "vital wheat gluten",
  // Oats are not wheat, but almost all are milled on wheat equipment,
  // and a coeliac needs the certified kind. Worth a question.
  "oats",
  "oatmeal",
  "rolled oats",
  // Flour and what is made of it.
  "flour",
  "bread",
  "breadcrumbs",
  "bread crumbs",
  "panko",
  "croutons",
  "crackers",
  "graham",
  "biscuit mix",
  "cake mix",
  "pastry",
  "phyllo",
  "filo",
  "puff pastry",
  "pie crust",
  "pie shell",
  "tortillas",
  "pita",
  "naan",
  "wonton",
  "matzo",
  "matzah",
  "pretzels",
  "wafers",
  "cookie crumbs",
  "vanilla wafers",
  "stuffing mix",
  "roux",
  // Pasta.
  "pasta",
  "spaghetti",
  "macaroni",
  "noodles",
  "egg noodles",
  "lasagna noodles",
  "orzo",
  "couscous",
  "ramen",
  "farfalle",
  "penne",
  "rigatoni",
  "fettuccine",
  "linguine",
  "vermicelli",
  // Where it hides. This is the half that matters.
  "soy sauce",
  "shoyu",
  "teriyaki",
  "hoisin",
  "oyster sauce",
  "worcestershire",
  "malt",
  "malt vinegar",
  "malted",
  "beer",
  "ale",
  "stout",
  "brewer's yeast",
  "bouillon",
  "stock cube",
  "gravy mix",
  "gravy granules",
  "onion soup mix",
  "cream of mushroom soup",
  "cream of chicken soup",
  "soy protein",
  "modified food starch",
  "licorice",
  "liquorice",
  "communion bread",
  "prosphora",
];

/**
 * Words just before a match that make it harmless. "Gluten-free flour"
 * is flour; "rice noodles" are not wheat. Kept short deliberately —
 * this exists to silence the warnings that would otherwise fire on
 * every well-labelled gluten-free recipe, not to excuse anything
 * doubtful.
 */
const SAFE_QUALIFIERS = [
  "gluten free",
  "gluten-free",
  "glutenfree",
  "gf",
  "rice",
  "corn",
  "almond",
  "coconut",
  "cassava",
  "tapioca",
  "chickpea",
  "garbanzo",
  "buckwheat",
  "quinoa",
  "millet",
  "sorghum",
  "potato",
  "oat", // only reaches here as "oat flour", which is its own question
  "tamari",
  "certified",
  "lentil",
  "edamame",
  "shirataki",
  "konjac",
  "plantain",
  "cauliflower",
  "zucchini",
  "almond meal",
];

function normalise(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * True when a safe qualifier sits in the few words before the match.
 * Mirrors the approach the category guesser takes with "Plant-Based
 * Burger": the words immediately before a loaded one usually change
 * what it means.
 */
function qualified(haystack: string, index: number): boolean {
  const before = haystack.slice(0, index).trim().split(" ").slice(-3).join(" ");
  return SAFE_QUALIFIERS.some((q) => before.includes(normalise(q)));
}

/**
 * The ingredient lines that look like they contain gluten, each with
 * the word that caught it. Empty means nothing obvious was found —
 * which is NOT the same as gluten-free, and must never be read that
 * way.
 */
export function glutenWarnings(ingredients: string[]): { line: string; word: string }[] {
  const found: { line: string; word: string }[] = [];
  for (const raw of ingredients ?? []) {
    const line = String(raw ?? "");
    const hay = ` ${normalise(line)} `;
    for (const word of GLUTEN_WORDS) {
      const needle = ` ${normalise(word)} `;
      const at = hay.indexOf(needle);
      if (at === -1) continue;
      if (qualified(hay, at)) continue;
      found.push({ line, word });
      break; // One warning per line is enough to prompt a look.
    }
  }
  return found;
}
