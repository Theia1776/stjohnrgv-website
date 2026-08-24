/**
 * Cloudflare Pages Function: GET /api/catechism/lessons
 *
 * The catechism lessons shown in the "My Learning" section of a
 * member's My Account page.
 *
 * Members only — logged-out visitors get 401 (unlike the library,
 * which has a public tier). Published lessons are returned to every
 * signed-in member; unpublished drafts are returned only to admins so
 * they can review one before posting it.
 *
 * Response:
 *   200 { lessons: [...], viewer_is_admin: boolean }
 *   401 { error }   — not signed in
 *   500 { error }   — server misconfigured or upstream error
 */
import { verifySession, withSessionCookies } from "../../../src/lib/session.ts";
import { SUPABASE_URL } from "../../../src/lib/supabase";
import { createClient } from "@supabase/supabase-js";

interface Env {
  SUPABASE_SERVICE_ROLE_KEY: string;
}

const LESSON_FIELDS =
  "id, slug, title, teacher, series, lesson_date, description, pdf_storage_key, published, created_at";

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

    const { data: viewer } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", session.user.id)
      .single();
    const isAdmin = viewer?.role === "admin";

    let query = supabase
      .from("catechism_lessons")
      .select(LESSON_FIELDS)
      // Newest lesson first — lesson_date when the admin supplied one,
      // otherwise the upload time.
      .order("lesson_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });

    // Drafts are admin-only; ordinary members see posted lessons.
    if (!isAdmin) query = query.eq("published", true);

    const { data, error } = await query;
    if (error) return wrap(jsonResponse({ error: error.message }, 500));

    return wrap(jsonResponse({ lessons: data ?? [], viewer_is_admin: isAdmin }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500),
    );
  }
}
