/**
 * Cloudflare Pages Function: GET /api/library/pdf?key=<filename>
 *
 * Returns a 60-second signed URL for a file in the Supabase Storage
 * "library" bucket. Two access paths:
 *   - Logged-in parishioners can read any book in the catalog.
 *   - Anonymous visitors can read only books whose row in
 *     library_books has public_access = true.
 *
 * Response:
 *   200 { url: string }
 *   400 { error }   — missing or empty ?key
 *   403 { error }   — anonymous request for a non-public book
 *   404 { error }   — file not in bucket / no matching book row
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

export async function onRequestGet(
  context: { request: Request; env: Env },
): Promise<Response> {
  const session = await verifySession(context.request);
  const wrap = (resp: Response) => withSessionCookies(resp, session.refreshedCookies);

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

  // Anonymous visitors must be reading a public book. Confirm by
  // looking up the row by storage key — there's a unique index on
  // pdf_storage_key so this is a single-row lookup.
  if (!session.user) {
    const { data: book, error: lookupError } = await admin
      .from("library_books")
      .select("public_access")
      .eq("pdf_storage_key", key)
      .maybeSingle();
    if (lookupError) {
      return wrap(jsonResponse({ error: lookupError.message }, 500));
    }
    if (!book) {
      return wrap(jsonResponse({ error: "File not found." }, 404));
    }
    if (!book.public_access) {
      return wrap(jsonResponse({ error: "This text is for parishioners only. Please sign in." }, 403));
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
