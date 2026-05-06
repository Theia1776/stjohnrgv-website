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

import { verifySession } from "../../src/lib/session.ts";

interface PagesContext {
  request: Request;
  next: () => Promise<Response>;
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
