/**
 * Cloudflare Pages Function: POST /api/admin/recipes/categorise
 *
 * File the unfiled recipes by reading their titles.
 *
 * 316 recipes arrived from the parish's old cards with no category, and
 * choosing a shelf three hundred times by hand is an evening nobody
 * should spend. Most of them say what they are — a pie is a pie — so
 * this does the obvious ones and leaves a person correcting a handful.
 *
 * Touches ONLY recipes with no category at all. Anything already filed,
 * by hand or otherwise, is left exactly as it is: an admin part-way
 * through sorting must not have their work overwritten.
 *
 * A recipe it cannot place stays unfiled rather than being dropped into
 * a Misc. shelf. "Not yet filed" is honest, and a wrong shelf has to be
 * noticed before it can be corrected.
 *
 * One exception, `mode: "drinks"`. When a new group is added to
 * `recipe-categories.ts` the recipes that belong in it are already
 * filed — on whichever Misc. shelf was the least wrong at the time. The
 * drinks sat in "Soups & Sides — Misc." because a lemonade had nowhere
 * else to go. That mode re-reads the titles on the **Misc. shelves
 * only** and moves the ones that now have a proper home. Anything filed
 * under a real category is a deliberate choice and is never touched.
 *
 * Body: { limit?: number, mode?: "unfiled" | "drinks" }
 *                           — how many to do in this call (default 80;
 *                             the page loops)
 * Returns: { filed, left_alone, remaining, examples: [{title, category}] }
 */
import { verifySession, withSessionCookies } from "../../../../src/lib/session.ts";
import { SUPABASE_URL } from "../../../../src/lib/supabase";
import { guessCategory } from "../../../../src/lib/recipe-guess";
import { groupOf, categoryValue, RECIPE_CATEGORIES } from "../../../../src/lib/recipe-categories";
import { createClient } from "@supabase/supabase-js";

/** The "other things" shelves — the only filed ones this will revisit. */
const MISC_SHELVES = RECIPE_CATEGORIES.filter((g) => g.group !== "Drinks").map((g) =>
  categoryValue(g.group, "Misc."),
);

/**
 * The Drinks shelves, revisited too, so the job can undo its own
 * mistakes. The first run read "Oranges in Coffee Syrup" as a drink on
 * the word "coffee"; the rule was tightened, and pressing the button
 * again should put it right rather than leaving a dessert among the
 * lemonades for somebody to notice by chance.
 */
const DRINK_SHELVES = (RECIPE_CATEGORIES.find((g) => g.group === "Drinks")?.categories ?? []).map(
  (c) => categoryValue("Drinks", c),
);

interface Env {
  SUPABASE_SERVICE_ROLE_KEY: string;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const session = await verifySession(context.request);
  const wrap = (resp: Response) => withSessionCookies(resp, session.refreshedCookies);

  try {
    if (!session.user) return wrap(jsonResponse({ error: "Unauthorized" }, 401));
    if (!context.env.SUPABASE_SERVICE_ROLE_KEY) {
      return wrap(jsonResponse({ error: "Server not configured." }, 500));
    }

    const supabase = createClient(SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", session.user.id)
      .single();
    if (profile?.role !== "admin") return wrap(jsonResponse({ error: "Forbidden" }, 403));

    let body: { limit?: number; mode?: string } = {};
    try {
      body = await context.request.json();
    } catch {
      body = {};
    }
    const limit = Math.min(Math.max(Number(body.limit) || 80, 1), 150);
    const drinksMode = body.mode === "drinks";

    // Normally only the unfiled: anything already categorised is
    // somebody's decision and is not ours to revisit. In drinks mode,
    // the Misc. shelves instead — see the note at the top.
    const query = supabase.from("recipes").select("id, title, fasting, ingredients, category");
    const { data: candidates, error } = await (drinksMode
      ? query.in("category", [...MISC_SHELVES, ...DRINK_SHELVES])
      : query.is("category", null)
    ).order("title", { ascending: true });
    if (error) return wrap(jsonResponse({ error: error.message }, 500));

    // In drinks mode the cap is on *writes*, not on rows read: every
    // Misc. recipe is re-read each round and only the moves are
    // rationed. Capping the rows instead would wedge it — the ones
    // staying put sit at the front of the alphabet and would fill the
    // batch every round, so the drinks behind them are never reached.
    const batch = drinksMode ? (candidates ?? []) : (candidates ?? []).slice(0, limit);
    let filed = 0;
    let leftAlone = 0;
    let examined = 0;
    const examples: { title: string; category: string }[] = [];
    /** On a Drinks shelf, no longer reads as one, nowhere to send it. */
    const stranded: string[] = [];
    /** Writes the database refused, which must never pass as silence. */
    const failed: string[] = [];

    for (const recipe of batch) {
      if (drinksMode && filed >= limit) break;
      examined++;
      const guess = guessCategory(
        String(recipe.title ?? ""),
        Array.isArray(recipe.ingredients) ? (recipe.ingredients as string[]) : [],
        recipe.fasting === true,
      );
      if (drinksMode) {
        const onDrinkShelf = groupOf(recipe.category as string) === "Drinks";
        const readsAsDrink = Boolean(guess.value) && groupOf(guess.value!) === "Drinks";

        // Already where it belongs, either way round.
        if (onDrinkShelf === readsAsDrink && guess.value === recipe.category) {
          leftAlone++;
          continue;
        }
        // On a Misc. shelf and not a drink: that is a sorting decision
        // and not ours to revisit.
        if (!onDrinkShelf && !readsAsDrink) {
          leftAlone++;
          continue;
        }
        // On a drink shelf and no longer readable as a drink, with
        // nothing confident to put in its place. Named in the reply so
        // it can be fixed by hand rather than sitting there unnoticed.
        if (onDrinkShelf && !readsAsDrink && !guess.value) {
          // The book goes in the label because several recipes exist
          // twice, once per book — "Oranges in Coffee Syrup, Oranges in
          // Coffee Syrup" read like a bug rather than like two rows.
          stranded.push(
            `${String(recipe.title ?? "")} (${recipe.fasting === true ? "fasting" : "everyday"})`,
          );
          leftAlone++;
          continue;
        }
      }
      if (!guess.value) {
        leftAlone++;
        continue;
      }
      const update = supabase.from("recipes").update({ category: guess.value }).eq("id", recipe.id);
      // Only if it is still where we found it — someone may be sorting
      // by hand in another tab while this runs.
      const { error: updateError } = await (drinksMode
        ? update.eq("category", recipe.category as string)
        : update.is("category", null));
      if (updateError) {
        // Counting a failed write as "left alone" hid it completely:
        // the job would report a tidy number and one recipe would
        // quietly stay where it was. Say so instead.
        failed.push(`${String(recipe.title ?? "")} — ${updateError.message}`);
        leftAlone++;
        continue;
      }
      filed++;
      if (examples.length < 8) {
        examples.push({ title: String(recipe.title), category: guess.value });
      }
    }

    if (drinksMode) {
      // A moved row leaves the shelves it was read from, so the next
      // call sees a shorter list. `remaining` is what this call did not
      // get to before it ran out of writes.
      return wrap(
        jsonResponse(
          {
            filed,
            left_alone: leftAlone,
            still_unfiled: 0,
            remaining: Math.max(batch.length - examined, 0),
            examples,
            stranded,
            failed,
          },
          200,
        ),
      );
    }

    // How many are STILL unfiled now this batch is done. The page loops,
    // and a recipe whose title says nothing stays in every batch — so
    // adding up "left alone" across rounds counts the same stubborn ones
    // over and over. It once reported 193 unfiled out of 314 recipes.
    // This is a fact about the table rather than about one pass.
    const { count: stillUnfiled } = await supabase
      .from("recipes")
      .select("id", { count: "exact", head: true })
      .is("category", null);

    return wrap(
      jsonResponse(
        {
          filed,
          left_alone: leftAlone,
          failed,
          still_unfiled: stillUnfiled ?? 0,
          remaining: Math.max((unfiled ?? []).length - batch.length, 0),
          examples,
        },
        200,
      ),
    );
  } catch (err) {
    return wrap(jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500));
  }
}
