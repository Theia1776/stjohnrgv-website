/**
 * Shared session-check helper for the /learn/library and /learn/catechumen
 * middlewares. Lives at functions/learn/_auth.ts (underscore-prefixed so
 * Cloudflare doesn't treat it as a route).
 *
 * Verifies the session via verifySession() in src/lib/session.ts — that
 * helper falls through to the refresh-token path when the access JWT
 * has expired, so a logged-in user whose access token aged out doesn't
 * get bounced to /login. Refreshed cookies (if any) are attached to
 * the downstream response so the browser picks up the new pair.
 *
 * We don't re-check the `approved` flag here; that's enforced at login
 * and reflected by whether the cookie pair was issued at all.
 */

import { verifySession, withSessionCookies } from "../../src/lib/session.ts";

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
  const session = await verifySession(context.request);
  if (!session.user) {
    return withSessionCookies(loginRedirect(context.request), session.refreshedCookies);
  }
  const response = await context.next();
  return withSessionCookies(response, session.refreshedCookies);
}
