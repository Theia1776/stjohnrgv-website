/**
 * Cloudflare Pages Function: /api/recipes
 *
 *   GET  — the posted recipes in one book or both.
 *   POST — submit a recipe. Members, catechumens and admins only.
 *
 * Reading is open to everyone, signed in or not: people search for
 * Orthodox fasting food, and a recipe is a gentler door into a parish
 * than a sign-in form.
 *
 * Submitting is not. An inquirer is welcome to read and cook; putting
 * something into the parish's own collection is for those who have
 * taken a step in. And nothing a member submits appears until an admin
 * posts it — a recipe labelled fasting that contains butter is exactly
 * the thing worth a second pair of eyes.
 *
 * GET query: ?fasting=true | false  (omit for both)
 *            ?gluten_free=true      (crosses both books)
 * POST body: { title, fasting, hands_on?, total_time?, serves?,
 *              preheat?, intro?, ingredients[], directions[], notes? }
 */
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "../../../src/lib/supabase";
import { verifySession, withSessionCookies } from "../../../src/lib/session.ts";
import { allCategoryValues } from "../../../src/lib/recipe-categories";
import { missingGlutenColumn, recipeFields } from "../../../src/lib/recipe-columns";

interface Env {
  SUPABASE_SERVICE_ROLE_KEY: string;
}

// Enough for a long recipe, short of someone pasting a book in.
const MAX_INGREDIENTS = 60;
const MAX_DIRECTIONS = 40;
const MAX_FIELD = 400;
const MAX_STEP = 2000;

/** Listed for readers; never the unposted ones. */
const RECIPE_PARTS = [
  "slug",
  "title",
  "fasting",
  "gluten_free",
  "category",
  "hands_on",
  "total_time",
  "serves",
  "preheat",
  "intro",
  "ingredients",
  "directions",
  "notes",
  "submitted_by_name",
  "created_at",
];
const fields = (withGluten: boolean) => recipeFields(RECIPE_PARTS, withGluten);

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function slugify(input: string): string {
  return (
    input
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "recipe"
  );
}

/** One list of lines, cleaned: trimmed, blanks dropped, capped. */
function cleanList(value: unknown, max: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, max)
    .map((v) => v.slice(0, maxLength));
}

function cleanField(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, MAX_FIELD) : "";
}

// ============================================================
// GET — the posted recipes
// ============================================================
export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  // The fasting book is open to the world: people search for Orthodox
  // Lenten cooking, and that is a good door into a parish. The everyday
  // book is the families' own — feast-day food and grandmothers'
  // recipes — and stays inside the parish.
  const session = await verifySession(context.request);
  const wrap = (resp: Response) => withSessionCookies(resp, session.refreshedCookies);
  const signedIn = Boolean(session.user);

  if (!context.env.SUPABASE_SERVICE_ROLE_KEY) {
    return wrap(jsonResponse({ error: "Server not configured." }, 500));
  }

  const url = new URL(context.request.url);
  const fastingParam = url.searchParams.get("fasting");
  const glutenFreeOnly = url.searchParams.get("gluten_free") === "true";
  const slug = url.searchParams.get("slug")?.trim() ?? "";

  const supabase = createClient(SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // One recipe, for the page that prints it. Same endpoint rather than
  // its own file, as the library does with /api/library/book?slug=.
  if (slug) {
    const one = (withGluten: boolean) =>
      supabase
        .from("recipes")
        .select(fields(withGluten))
        .eq("slug", slug)
        .eq("published", true)
        .maybeSingle();

    let { data, error } = await one(true);
    // Migration 020 not applied yet — see src/lib/recipe-columns.ts.
    if (missingGlutenColumn(error)) ({ data, error } = await one(false));
    if (error) return wrap(jsonResponse({ error: error.message }, 500));
    if (!data) return wrap(jsonResponse({ error: "Recipe not found." }, 404));
    if (!data.fasting && !signedIn) {
      return wrap(
        jsonResponse(
          {
            error:
              "This one is from the everyday book, which our parish keeps among " +
              "its own. The fasting recipes are open to everyone.",
          },
          403,
        ),
      );
    }
    return wrap(jsonResponse({ recipe: data }, 200));
  }

  // Asked for the everyday book while signed out: say so rather than
  // answering with an empty shelf, which reads as "there is nothing
  // here" instead of "this is not yours to see yet".
  if (!signedIn && fastingParam === "false") {
    return wrap(
      jsonResponse(
        {
          error:
            "The everyday recipes are for our parish. The fasting book is open " +
            "to everyone.",
          needs_account: true,
        },
        403,
      ),
    );
  }

  const listing = (withGluten: boolean) => {
    let query = supabase
      .from("recipes")
      .select(fields(withGluten))
      .eq("published", true)
      .order("title", { ascending: true });

    if (fastingParam === "true") query = query.eq("fasting", true);
    else if (fastingParam === "false") query = query.eq("fasting", false);

    // Gluten-free crosses both books, so it narrows whatever the viewer
    // is already allowed to see rather than replacing the rule: signed
    // out it means the gluten-free fasting recipes, which is the right
    // answer and not an empty page.
    if (glutenFreeOnly && withGluten) query = query.eq("gluten_free", true);

    // No filter and signed out means the fasting book only.
    if (!signedIn) query = query.eq("fasting", true);
    return query;
  };

  let { data, error } = await listing(true);
  // Migration 020 not applied yet — see src/lib/recipe-columns.ts.
  let glutenPending = false;
  if (missingGlutenColumn(error)) {
    glutenPending = true;
    // Nothing can be marked gluten-free while the column is missing, so
    // that listing is empty rather than unfiltered. An unfiltered one
    // would offer every recipe in the parish as gluten-free, which is
    // the one wrong answer that could actually hurt somebody.
    if (glutenFreeOnly) {
      data = [];
      error = null;
    } else {
      ({ data, error } = await listing(false));
    }
  }
  if (error) return wrap(jsonResponse({ error: error.message }, 500));

  return wrap(
    new Response(JSON.stringify({ recipes: data ?? [], viewer_signed_in: signedIn, gluten_pending: glutenPending }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        // Private, not public: what comes back depends on whether the
        // asker is signed in, and a shared cache would hand one
        // person's answer to the next.
        "Cache-Control": "private, max-age=120",
      },
    }),
  );
}

// ============================================================
// POST — submit one
// ============================================================
export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const session = await verifySession(context.request);
  const wrap = (resp: Response) => withSessionCookies(resp, session.refreshedCookies);

  try {
    if (!session.user) {
      return wrap(jsonResponse({ error: "Please sign in to share a recipe." }, 401));
    }
    if (!context.env.SUPABASE_SERVICE_ROLE_KEY) {
      return wrap(jsonResponse({ error: "Server not configured." }, 500));
    }

    const supabase = createClient(SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, first_name, last_name, full_name")
      .eq("id", session.user.id)
      .single();

    const role = profile?.role ?? "";
    if (!["member", "catechumen", "admin"].includes(role)) {
      return wrap(
        jsonResponse(
          {
            error:
              "Sharing a recipe is for catechumens and members. You're very welcome " +
              "to cook from the collection in the meantime.",
          },
          403,
        ),
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await context.request.json();
    } catch {
      return wrap(jsonResponse({ error: "Invalid JSON body." }, 400));
    }

    const title = cleanField(body.title);
    if (!title) return wrap(jsonResponse({ error: "A title is needed." }, 400));

    const ingredients = cleanList(body.ingredients, MAX_INGREDIENTS, MAX_FIELD);
    const directions = cleanList(body.directions, MAX_DIRECTIONS, MAX_STEP);
    if (ingredients.length === 0) {
      return wrap(jsonResponse({ error: "A recipe needs at least one ingredient." }, 400));
    }
    if (directions.length === 0) {
      return wrap(jsonResponse({ error: "A recipe needs at least one step." }, 400));
    }

    const submitterName =
      [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim() ||
      (profile?.full_name as string | null) ||
      "";

    // Two cooks can both send "Lenten Lentil Soup"; the second gets a
    // suffix rather than a refusal.
    let slug = slugify(title);
    const { data: taken } = await supabase.from("recipes").select("slug").eq("slug", slug).maybeSingle();
    if (taken) slug = `${slug}-${crypto.randomUUID().slice(0, 6)}`;

    const newRecipe = (withGluten: boolean) => ({
      slug,
      title,
      fasting: body.fasting !== false,
      // Only ever what the cook ticked. Nothing here reads the
      // ingredients to decide this — see src/lib/recipe-gluten.ts
      // for why that would be the wrong kind of helpful.
      ...(withGluten ? { gluten_free: body.gluten_free === true } : {}),
      // Checked against the shared list rather than trusted: a value
      // that isn't offered anywhere would file the recipe on a shelf
      // no page knows how to show.
      category: allCategoryValues().includes(String(body.category ?? ""))
        ? String(body.category)
        : null,
      hands_on: cleanField(body.hands_on) || null,
      total_time: cleanField(body.total_time) || null,
      serves: cleanField(body.serves) || null,
      preheat: cleanField(body.preheat) || null,
      intro: typeof body.intro === "string" ? body.intro.trim().slice(0, 1200) || null : null,
      ingredients,
      directions,
      notes: typeof body.notes === "string" ? body.notes.trim().slice(0, 1200) || null : null,
      submitted_by: session.user.id,
      submitted_by_name: submitterName || null,
      // An admin's own recipe still waits, so the queue is the one
      // place every recipe passes through and nothing gets forgotten
      // in a half-finished state.
      published: false,
    });

    const send = (withGluten: boolean) =>
      supabase.from("recipes").insert(newRecipe(withGluten)).select("slug, title").single();

    let { data: inserted, error } = await send(true);
    // Migration 020 not applied yet. Losing the tick is a pity; losing
    // the recipe would be worse, so it goes in without it and an admin
    // can mark it once the column exists.
    if (missingGlutenColumn(error)) ({ data: inserted, error } = await send(false));

    if (error) return wrap(jsonResponse({ error: error.message }, 500));

    return wrap(
      jsonResponse(
        {
          ok: true,
          recipe: inserted,
          message:
            "Thank you — your recipe has been sent to the parish office. " +
            "It will appear once it's been looked over.",
        },
        201,
      ),
    );
  } catch (err) {
    return wrap(jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500));
  }
}
