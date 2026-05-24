/**
 * Cloudflare Pages Function: GET /api/library/books
 *
 * Returns the full list of library books for the parishioner-facing
 * library index (/learn/library). Any logged-in user can read; the
 * library page is already gated by the /learn/library middleware,
 * which keeps this endpoint behind the same login wall.
 */
import { verifySession, withSessionCookies } from "../../../src/lib/session.ts";
import { SUPABASE_URL } from "../../../src/lib/supabase";
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

    const { data, error } = await supabase
      .from("library_books")
      .select("id, slug, title, author, category, languages, description, pdf_storage_key")
      .order("title", { ascending: true });

    if (error) return wrap(jsonResponse({ error: error.message }, 500));

    return wrap(jsonResponse({ books: data ?? [] }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500),
    );
  }
}
