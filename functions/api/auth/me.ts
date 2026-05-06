/**
 * Cloudflare Pages Function: GET /api/auth/me
 *
 * Returns the current login state from the session cookie.
 */
import { getFirstName, verifySession } from "../../../src/lib/session.ts";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function onRequestGet(context: { request: Request }): Promise<Response> {
  const user = await verifySession(context.request);
  if (!user) {
    return jsonResponse({ loggedIn: false }, 200);
  }

  return jsonResponse({ loggedIn: true, name: getFirstName(user) }, 200);
}
