/**
 * Cloudflare Pages Function: POST /api/auth/login
 *
 * Body: { email, password }
 *
 * Validates the credentials against Supabase Auth, then sets an httpOnly
 * cookie containing the access token. The cookie is checked by the
 * /learn/library and /learn/catechumen middlewares; the page never sees
 * the token directly.
 *
 * The user must also be `approved = true` in public.profiles. Unapproved
 * users get a 403 — their auth session is valid, but the parish hasn't
 * vouched for them yet.
 */

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../../../src/lib/supabase";
import { authCookies } from "../../../src/lib/session";

interface Env {
  SUPABASE_SERVICE_ROLE_KEY: string;
}

function jsonResponse(body: unknown, status: number, extraHeaders: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

export async function onRequestPost(
  context: { request: Request; env: Env },
): Promise<Response> {
  let body: { email?: unknown; password?: unknown };
  try {
    body = await context.request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) {
    return jsonResponse({ error: "Email and password are required." }, 400);
  }

  // Use a fresh anon client per request — the shared one in src/lib has
  // session persistence disabled, but it's still safer to isolate.
  const auth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data, error } = await auth.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    return jsonResponse({ error: "Invalid email or password." }, 401);
  }

  // Check approval via the service-role key (bypasses RLS so we can
  // read the row even though the user-side RLS policy would also let
  // them — service role is simpler and removes a code path).
  if (!context.env.SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ error: "Server not configured." }, 500);
  }
  const admin = createClient(SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: profile, error: profileErr } = await admin
    .from("profiles")
    .select("approved")
    .eq("id", data.user!.id)
    .single();

  if (profileErr || !profile) {
    return jsonResponse({ error: "Profile not found. Contact the parish office." }, 403);
  }
  if (!profile.approved) {
    return jsonResponse(
      { error: "Your registration is pending approval. The parish will be in touch." },
      403,
    );
  }

  // Two cookies: the short-lived access JWT plus the long-lived
  // refresh token. Both are written with a 30-day Max-Age; when the
  // access JWT internally expires, verifySession() exchanges the
  // refresh token for a fresh pair on the next request.
  const headers = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  for (const cookie of authCookies(data.session.access_token, data.session.refresh_token)) {
    headers.append("Set-Cookie", cookie);
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}
