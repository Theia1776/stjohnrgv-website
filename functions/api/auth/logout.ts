/**
 * Cloudflare Pages Function: POST /api/auth/logout
 *
 * Wipes the access + refresh cookies. Doesn't bother revoking the
 * Supabase session server-side — once the cookies are gone the
 * browser can't present anything verifySession() will accept, so
 * the session is effectively dead.
 */

import { clearAuthCookies } from "../../../src/lib/session";

export async function onRequestPost(): Promise<Response> {
  const headers = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  for (const cookie of clearAuthCookies()) {
    headers.append("Set-Cookie", cookie);
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}
