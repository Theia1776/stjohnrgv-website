/**
 * Cloudflare Pages Function: POST /api/auth/logout
 *
 * Clears the session cookie. Doesn't bother revoking the Supabase
 * access token server-side — the JWT will expire on its own (1 hour
 * default), and we never store a refresh token, so once the cookie
 * is gone the session is effectively dead.
 */

import { SESSION_COOKIE } from "../../../src/lib/supabase";

export async function onRequestPost(): Promise<Response> {
  const expired = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=0",
  ].join("; ");

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Set-Cookie": expired,
    },
  });
}
