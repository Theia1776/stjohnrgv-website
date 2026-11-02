/**
 * Cloudflare Pages Function: GET /api/admin/recipes
 *
 * Every recipe, posted and waiting, for the admin page. The waiting
 * ones come first — that's the list someone actually opens this page
 * to deal with.
 *
 * Admin-only, same role check as the rest of /api/admin/*.
 */
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "../../../../src/lib/supabase";
import { verifySession, withSessionCookies } from "../../../../src/lib/session.ts";

interface Env {
  SUPABASE_SERVICE_ROLE_KEY: string;
}

const RECIPE_FIELDS =
  "id, slug, title, fasting, category, hands_on, total_time, serves, preheat, intro, " +
  "ingredients, directions, notes, submitted_by_name, published, created_at, updated_at";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
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

    // Waiting first, then newest. Someone opening this page is here to
    // clear the queue, not to browse what's already posted.
    const { data, error } = await supabase
      .from("recipes")
      .select(RECIPE_FIELDS)
      .order("published", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) return wrap(jsonResponse({ error: error.message }, 500));

    const recipes = data ?? [];
    return wrap(
      jsonResponse(
        {
          recipes,
          waiting: recipes.filter((r) => !r.published).length,
        },
        200,
      ),
    );
  } catch (err) {
    return wrap(jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500));
  }
}
