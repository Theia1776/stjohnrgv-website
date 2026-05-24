/**
 * Cloudflare Pages Function: GET /api/library/books
 *
 * Returns the catalog of library books. Visibility:
 *   - Anonymous visitors get only books with public_access = true.
 *   - Logged-in parishioners (any role) get every book.
 *
 * The /learn/library middleware that previously redirected anon
 * away from the page entirely was removed when the per-book
 * public_access flag landed; gating now lives here so anon users
 * can browse and read the publicly-shared subset.
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
    if (!context.env.SUPABASE_SERVICE_ROLE_KEY) {
      return wrap(jsonResponse({ error: "Server not configured." }, 500));
    }

    const supabase = createClient(SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    let query = supabase
      .from("library_books")
      .select("id, slug, title, author, category, languages, description, pdf_storage_key, public_access")
      .order("title", { ascending: true });

    // Anonymous visitors only see books the admin has explicitly
    // opted into public access.
    if (!session.user) {
      query = query.eq("public_access", true);
    }

    const { data, error } = await query;
    if (error) return wrap(jsonResponse({ error: error.message }, 500));

    return wrap(jsonResponse({ books: data ?? [], viewer_authenticated: !!session.user }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500),
    );
  }
}
