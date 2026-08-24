/**
 * Cloudflare Pages Function: GET /api/catechism/pdf?key=<storage key>
 *
 * Returns a 60-second signed URL for a catechism lesson PDF. Lesson
 * files live in the existing "library" storage bucket under the
 * `catechism/` prefix (see migration 012), so no separate bucket is
 * needed.
 *
 * Members only. A draft (published = false) is readable only by an
 * admin, so a lesson can be staged and reviewed before it's posted.
 *
 * Response:
 *   200 { url: string }
 *   400 { error }   — missing or empty ?key
 *   401 { error }   — not signed in
 *   403 { error }   — member asking for an unpublished draft
 *   404 { error }   — no matching lesson row / file not in bucket
 *   500 { error }   — server misconfigured or upstream error
 */
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "../../../src/lib/supabase";
import { verifySession, withSessionCookies } from "../../../src/lib/session.ts";

interface Env {
  SUPABASE_SERVICE_ROLE_KEY: string;
}

const BUCKET = "library";
const SIGNED_URL_TTL_SECONDS = 60;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const session = await verifySession(context.request);
  const wrap = (resp: Response) => withSessionCookies(resp, session.refreshedCookies);

  if (!session.user) return wrap(jsonResponse({ error: "Unauthorized" }, 401));

  const url = new URL(context.request.url);
  const key = url.searchParams.get("key")?.trim() || "";
  if (!key) {
    return wrap(jsonResponse({ error: "Missing 'key' query parameter." }, 400));
  }
  if (!context.env.SUPABASE_SERVICE_ROLE_KEY) {
    return wrap(jsonResponse({ error: "Server not configured." }, 500));
  }

  const admin = createClient(SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // The lesson row is the authority on what may be signed — a key that
  // isn't in this table (a library book, say) is simply not found here.
  const { data: lesson, error: lookupError } = await admin
    .from("catechism_lessons")
    .select("published")
    .eq("pdf_storage_key", key)
    .maybeSingle();
  if (lookupError) return wrap(jsonResponse({ error: lookupError.message }, 500));
  if (!lesson) return wrap(jsonResponse({ error: "Lesson not found." }, 404));

  if (!lesson.published) {
    const { data: viewer } = await admin
      .from("profiles")
      .select("role")
      .eq("id", session.user.id)
      .single();
    if (viewer?.role !== "admin") {
      return wrap(jsonResponse({ error: "This lesson hasn't been posted yet." }, 403));
    }
  }

  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(key, SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    const msg = error?.message || "";
    if (/not found|does not exist|object/i.test(msg)) {
      return wrap(jsonResponse({ error: "File not found." }, 404));
    }
    return wrap(jsonResponse({ error: msg || "Could not sign URL." }, 500));
  }

  return wrap(jsonResponse({ url: data.signedUrl }, 200));
}
