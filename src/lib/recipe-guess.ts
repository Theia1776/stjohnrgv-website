/**
 * Guessing a recipe's category from its title and ingredients.
 *
 * Filing 316 recipes by hand is an evening's work. Most of them say
 * plainly what they are — "Lenten Lentil Soup" is a soup, "Apple Pie" is
 * a pie — so a first pass can do the obvious ones and leave a person
 * correcting a handful rather than choosing three hundred times.
 *
 * Deliberately cautious. A recipe it cannot place is left unfiled
 * rather than dropped in a Misc. shelf, because "not yet filed" is
 * honest and a wrong shelf has to be found before it can be fixed.
 *
 * The title is trusted over the ingredients: a beef stew contains
 * onions but it is not a vegetable dish, and the cook who named it
 * already did the categorising.
 */
import { categoryValue } from "./recipe-categories";

/** Checked in order; the first match wins, so put the specific first. */
const RULES: { pattern: RegExp; group: string; category: string }[] = [
  // --- Desserts, which are the most distinctive by name ---
  { pattern: /\b(cheesecake|cupcakes?|torte|cakes?)\b/i, group: "Desserts", category: "Cakes" },
  { pattern: /\b(pies?|tarts?|cobblers?|crisps?|crumbles?|galette)\b/i, group: "Desserts", category: "Pies" },
  { pattern: /\b(cookies?|brownies?|bars?|biscotti|shortbread|macarons?)\b/i, group: "Desserts", category: "Cookies" },
  { pattern: /\b(baklava|strudel|danish|eclairs?|cannoli|donuts?|doughnuts?|scones?|pastry|pastries|turnovers?)\b/i, group: "Desserts", category: "Pastries" },
  { pattern: /\b(pudding|custard|flan|mousse|trifle|tiramisu|panna cotta)\b/i, group: "Desserts", category: "Puddings & Custards" },
  { pattern: /\b(fudge|truffles?|candy|caramels?|toffee|brittle|divinity|pralines?)\b/i, group: "Desserts", category: "Misc." },
  // Dishes that are named rather than described. A cook knows what a
  // snickerdoodle is; a pattern has to be told.
  { pattern: /\b(snickerdoodles?|ginger ?snaps?|madeleines?|macaroons?|spritz|thumbprints?|temptations?|squares?|crispy treats?|church windows)\b/i, group: "Desserts", category: "Cookies" },
  { pattern: /\b(creme brulee|cr[èe]me br[ûu]l[ée]e|curd|posset)\b/i, group: "Desserts", category: "Puddings & Custards" },
  { pattern: /\b(compote|fruit salad|ambrosia)\b/i, group: "Desserts", category: "Misc." },
  { pattern: /\b(crawfish|crayfish|etouff?[ée]e|[ée]touf[ée]e|jambalaya|ceviche)\b/i, group: "Main Courses", category: "Fish & Seafood" },
  { pattern: /\b(cheese ball|mayonnaise|aioli|vinaigrette|chutney)\b/i, group: "Soups & Sides", category: "Misc." },
  { pattern: /\b(knots|breadsticks?|garlic bread|waffles?|pancakes?|crepes?)\b/i, group: "Soups & Sides", category: "Breads" },
  { pattern: /\b(jell-?o|gelatin salad)\b/i, group: "Desserts", category: "Misc." },
  { pattern: /\b(grilled cheese|melts?|paninis?)\b/i, group: "Main Courses", category: "Misc." },
  { pattern: /\b(spanish rice|fried rice|rice)\b/i, group: "Main Courses", category: "Pasta & Grains" },
  { pattern: /\bstuffed (bell )?peppers?\b/i, group: "Main Courses", category: "Vegetables" },
  { pattern: /\bstuffed shells?\b/i, group: "Main Courses", category: "Pasta & Grains" },
  { pattern: /\b(frosting|icing|glaze)\b/i, group: "Desserts", category: "Misc." },
  { pattern: /\b(ice cream|sorbet|sherbet|popsicles?)\b/i, group: "Desserts", category: "Misc." },

  // --- Drinks, checked before the food: "Lemon Dreamy Lemonade" would
  //     otherwise read as a dessert, and iced tea as a side ---
  { pattern: /\b(hot cocoa|hot chocolate|mulled|wassail|hot toddy|chai|espresso|latte|cappuccino)\b/i, group: "Drinks", category: "Hot Drinks" },
  { pattern: /\b(punch|sangria|eggnog)\b/i, group: "Drinks", category: "Punches" },
  { pattern: /\b(lemonade|limeade|iced tea|slush|smoothie|milk ?shakes?|shakes?|malts?|floats?|frappe|julep|spritzer|agua fresca|cream soda|italian soda|soda pop)\b/i, group: "Drinks", category: "Cold Drinks" },
  // These are weak words that also name food: "Apple Cider Pork Chops"
  // is a pork dish, "Tea Ring" is a pastry, "Oranges in Coffee Syrup"
  // is a dessert, and plain "soda" is nearly always baking soda. Cider
  // only counts when the title ends on it; tea and coffee only when no
  // food word follows them.
  { pattern: /\btea\b(?!\s*(sandwich|ring|bread|loaf|biscuits?|towels?))/i, group: "Drinks", category: "Misc." },
  { pattern: /\bcoffee\b(?!\s*(syrup|cake|beans?|rub|glaze|frosting|icing|ice cream|crusted|braised|sauce))/i, group: "Drinks", category: "Misc." },
  { pattern: /\bcider\b\s*$/i, group: "Drinks", category: "Misc." },
  { pattern: /\b(cocktails?|drinks?|beverages?|cocoa)\b/i, group: "Drinks", category: "Misc." },

  // --- Soups & sides ---
  { pattern: /\b(soups?|chowders?|bisques?|stews?|chili|broths?|gumbo)\b/i, group: "Soups & Sides", category: "Soups" },
  { pattern: /\b(breads?|rolls?|buns?|biscuits?|prosphora|loaf|loaves|focaccia|cornbread|baguette|tortillas?|naan|pretzels?|muffins?|banana bread)\b/i, group: "Soups & Sides", category: "Breads" },
  { pattern: /\b(salads?|slaw|coleslaw)\b/i, group: "Soups & Sides", category: "Salads" },
  { pattern: /\b(potatoes|fries|stuffing|dressing|casserole|gratin|rice pilaf|greens|sprouts|asparagus|carrots|corn on the cob|baked beans)\b/i, group: "Soups & Sides", category: "Sides" },
  { pattern: /\b(dips?|spreads?|salsa|hummus|guacamole|sauces?|gravy|relish|pickled|pickles|jam|jelly|preserves|marinade|butter sauce)\b/i, group: "Soups & Sides", category: "Misc." },

  // --- Main courses, by the meat that names them ---
  // Plurals matter: a card says "Hamburgers" and "Meatloaves", and
  // without the optional ending neither matched at all.
  { pattern: /\b(beef|steaks?|brisket|pot roast|hamburgers?|ground chuck|meatloa(f|ves)|meatballs?|stroganoff|goulash|rubens?)\b/i, group: "Main Courses", category: "Beef" },
  { pattern: /\b(chicken|hen|poultry)\b/i, group: "Main Courses", category: "Chicken" },
  { pattern: /\b(lamb|mutton)\b/i, group: "Main Courses", category: "Lamb" },
  { pattern: /\b(pork|bacon|ham|sausage|chops|ribs|carnitas|prosciutto)\b/i, group: "Main Courses", category: "Pork" },
  { pattern: /\b(turkey)\b/i, group: "Main Courses", category: "Turkey" },
  { pattern: /\b(fish|salmon|tuna|cod|shrimp|crab|tilapia|mahi|halibut|scallops?|clams?|oysters?|seafood|lobster)\b/i, group: "Main Courses", category: "Fish & Seafood" },
  { pattern: /\b(lentils?|chickpeas?|beans?|dal|falafel|hummus bowl)\b/i, group: "Main Courses", category: "Beans & Lentils" },
  { pattern: /\b(pasta|spaghetti|lasagna|rigatoni|penne|gnocchi|macaroni|noodles?|risotto|quinoa|couscous|pilaf|pizza|calzone)\b/i, group: "Main Courses", category: "Pasta & Grains" },
  { pattern: /\b(vegetables?|veggie|ratatouille|stir[- ]?fry|eggplant|zucchini|squash|cauliflower|broccoli|mushrooms?|tofu|tempeh|seitan)\b/i, group: "Main Courses", category: "Vegetables" },
  { pattern: /\b(tacos?|enchiladas?|burritos?|quesadillas?|wraps?|sandwich(es)?|burgers?|sliders?)\b/i, group: "Main Courses", category: "Misc." },

  // Fruit in a syrup is a pudding. Deliberately the LAST rule in the
  // list, after every meat: "Oranges in Coffee Syrup" is a dessert but
  // "Ham with Cherry Syrup" is a ham, and putting this last lets the
  // meat win without needing a second rule to say so.
  { pattern: /\b(oranges?|peach(es)?|pears?|plums?|apricots?|cherr(y|ies)|figs?|berries|rhubarb|pineapple)\b.*\bsyrup\b/i, group: "Desserts", category: "Misc." },
];

// A fasting recipe can never be filed under a meat. "Vegan Meatloaf"
// matches the beef rule on the word "meatloaf", and filing it under
// Beef would be worse than leaving it unfiled.
const MEAT_CATEGORIES = new Set(["Beef", "Chicken", "Lamb", "Pork", "Turkey", "Fish & Seafood"]);

export interface GuessResult {
  value: string | null;
  why: string;
}

/**
 * A category for this recipe, or null when it is not obvious.
 *
 * `fasting` matters: it forbids the meat shelves outright, and sends a
 * dish that looked like one to Vegetables instead, which is what a
 * plant-based version of it actually is.
 */
export function guessCategory(
  title: string,
  ingredients: string[],
  fasting: boolean,
): GuessResult {
  const name = String(title ?? "");

  // "How to Press Tofu" is a technique, not a dish. Left unfiled
  // rather than guessed at: the rules below read the ingredient in the
  // title and would file it as a main course, putting a how-to guide
  // among the dinners. Unfiled is honest and takes one dropdown to
  // correct; a guide filed as a main course has to be noticed first.
  if (/^\s*how\s+to\b/i.test(name)) {
    return { value: null, why: `"${name}" reads as a technique rather than a dish` };
  }

  for (const rule of RULES) {
    if (!rule.pattern.test(name)) continue;

    if (fasting && MEAT_CATEGORIES.has(rule.category)) {
      // A fasting dish named for a meat is an imitation of it.
      return {
        value: categoryValue("Main Courses", "Vegetables"),
        why: `"${name}" reads as ${rule.category}, but it is in the fasting book, so Vegetables`,
      };
    }
    return { value: categoryValue(rule.group, rule.category), why: `title matched ${rule.category}` };
  }

  // Nothing in the title. One narrow fallback: a short list that is
  // mostly flour and sugar is baking, and that is better than nothing.
  const blob = ingredients.join(" ").toLowerCase();
  if (/\bflour\b/.test(blob) && /\b(sugar|honey|molasses)\b/.test(blob) && ingredients.length <= 12) {
    return {
      value: categoryValue("Desserts", "Misc."),
      why: "flour and sugar with a short list — probably baking",
    };
  }

  return { value: null, why: "nothing obvious in the title" };
}
