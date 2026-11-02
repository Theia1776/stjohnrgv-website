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
 * POST body: { title, fasting, hands_on?, total_time?, serves?,
 *              preheat?, intro?, ingredients[], directions[], notes? }
 */
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "../../../src/lib/supabase";
import { verifySession, withSessionCookies } from "../../../src/lib/session.ts";
import { allCategoryValues } from "../../../src/lib/recipe-categories";

interface Env {
  SUPABASE_SERVICE_ROLE_KEY: string;
}

// Enough for a long recipe, short of someone pasting a book in.
const MAX_INGREDIENTS = 60;
const MAX_DIRECTIONS = 40;
const MAX_FIELD = 400;
const MAX_STEP = 2000;

/** Listed for readers; never the unposted ones. */
const RECIPE_FIELDS =
  "slug, title, fasting, category, hands_on, total_time, serves, preheat, intro, " +
  "ingredients, directions, notes, submitted_by_name, created_at";

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
  if (!context.env.SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ error: "Server not configured." }, 500);
  }

  const url = new URL(context.request.url);
  const fastingParam = url.searchParams.get("fasting");
  const slug = url.searchParams.get("slug")?.trim() ?? "";

  const supabase = createClient(SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // One recipe, for the page that prints it. Same endpoint rather than
  // its own file, as the library does with /api/library/book?slug=.
  if (slug) {
    const { data, error } = await supabase
      .from("recipes")
      .select(RECIPE_FIELDS)
      .eq("slug", slug)
      .eq("published", true)
      .maybeSingle();
    if (error) return jsonResponse({ error: error.message }, 500);
    if (!data) return jsonResponse({ error: "Recipe not found." }, 404);
    return jsonResponse({ recipe: data }, 200);
  }

  let query = supabase
    .from("recipes")
    .select(RECIPE_FIELDS)
    .eq("published", true)
    .order("title", { ascending: true });

  if (fastingParam === "true") query = query.eq("fasting", true);
  else if (fastingParam === "false") query = query.eq("fasting", false);

  const { data, error } = await query;
  if (error) return jsonResponse({ error: error.message }, 500);

  return new Response(JSON.stringify({ recipes: data ?? [] }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // Recipes change rarely; a few minutes at the edge keeps the
      // listing quick without anyone waiting on a new one for long.
      "Cache-Control": "public, max-age=300",
    },
  });
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

    const { data: inserted, error } = await supabase
      .from("recipes")
      .insert({
        slug,
        title,
        fasting: body.fasting !== false,
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
      })
      .select("slug, title")
      .single();

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
