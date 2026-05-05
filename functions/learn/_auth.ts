/**
 * Shared session-check helper for the /learn/library and /learn/catechumen
 * middlewares. Lives at functions/learn/_auth.ts (underscore-prefixed so
 * Cloudflare doesn't treat it as a route).
 *
 * Verifies the access token in the SESSION_COOKIE by calling Supabase's
 * auth.getUser(jwt) — if it returns a user, the token is valid and not
 * expired. We don't re-check the `approved` flag here; that's enforced at
 * login time and reflected by whether the cookie was issued at all. If
 * approval is later revoked, the user keeps access until their JWT expires
 * (max 1 hour by default).
 */

import { createClient, type User } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SESSION_COOKIE } from "../../src/lib/supabase";

interface PagesContext {
  request: Request;
  next: () => Promise<Response>;
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

/**
 * Returns the Supabase user if the request carries a valid session cookie,
 * or null otherwise. Shared by the page-protecting middleware (which
 * redirects to /login on null) and the JSON API endpoints (which return
 * 401). Keeping the verification in one place means a Supabase client SDK
 * change only needs editing here.
 */
export async function verifySession(request: Request): Promise<User | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;

  const auth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data, error } = await auth.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

function loginRedirect(request: Request): Response {
  const url = new URL(request.url);
  const next = url.pathname + url.search;
  const redirectTo = `/login/?next=${encodeURIComponent(next)}`;
  return new Response(null, {
    status: 302,
    headers: { Location: redirectTo, "Cache-Control": "no-store" },
  });
}

export async function gateRequest(context: PagesContext): Promise<Response> {
  const user = await verifySession(context.request);
  if (!user) return loginRedirect(context.request);
  return context.next();
}
