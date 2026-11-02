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
 * Body: { limit?: number }  — how many to do in this call (default 80;
 *                             the page loops)
 * Returns: { filed, left_alone, remaining, examples: [{title, category}] }
 */
import { verifySession, withSessionCookies } from "../../../../src/lib/session.ts";
import { SUPABASE_URL } from "../../../../src/lib/supabase";
import { guessCategory } from "../../../../src/lib/recipe-guess";
import { createClient } from "@supabase/supabase-js";

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

    let body: { limit?: number } = {};
    try {
      body = await context.request.json();
    } catch {
      body = {};
    }
    const limit = Math.min(Math.max(Number(body.limit) || 80, 1), 150);

    // Only the unfiled. Anything already categorised is somebody's
    // decision and is not ours to revisit.
    const { data: unfiled, error } = await supabase
      .from("recipes")
      .select("id, title, fasting, ingredients")
      .is("category", null)
      .order("title", { ascending: true });
    if (error) return wrap(jsonResponse({ error: error.message }, 500));

    const batch = (unfiled ?? []).slice(0, limit);
    let filed = 0;
    let leftAlone = 0;
    const examples: { title: string; category: string }[] = [];

    for (const recipe of batch) {
      const guess = guessCategory(
        String(recipe.title ?? ""),
        Array.isArray(recipe.ingredients) ? (recipe.ingredients as string[]) : [],
        recipe.fasting === true,
      );
      if (!guess.value) {
        leftAlone++;
        continue;
      }
      const { error: updateError } = await supabase
        .from("recipes")
        .update({ category: guess.value })
        .eq("id", recipe.id)
        // Only if it is still unfiled — someone may be sorting by hand
        // in another tab while this runs.
        .is("category", null);
      if (updateError) {
        leftAlone++;
        continue;
      }
      filed++;
      if (examples.length < 8) {
        examples.push({ title: String(recipe.title), category: guess.value });
      }
    }

    return wrap(
      jsonResponse(
        {
          filed,
          left_alone: leftAlone,
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
