/**
 * Cloudflare Pages Function: GET /api/auth/me
 *
 * Returns the current login state from the session cookie, plus the
 * user's first name and parish role. Header.astro calls this on every
 * page load to decide whether to show Sign In, the user's name, and
 * the Admin link.
 */
import { getFirstName, verifySession, withSessionCookies } from "../../../src/lib/session.ts";
import { SUPABASE_URL } from "../../../src/lib/supabase";
import { createClient } from "@supabase/supabase-js";

interface Env {
  SUPABASE_SERVICE_ROLE_KEY: string;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const session = await verifySession(context.request);
  if (!session.user) {
    return withSessionCookies(jsonResponse({ loggedIn: false }, 200), session.refreshedCookies);
  }

  // Best-effort role lookup. If Supabase is unreachable we still return
  // the logged-in state with the default role, so a transient DB blip
  // doesn't sign the user out of the UI — they just lose any admin
  // affordances until the next request succeeds.
  let role = "member";
  let isMasterAdmin = false;
  try {
    const supabase = createClient(SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data } = await supabase
      .from("profiles")
      .select("role, is_master_admin")
      .eq("id", session.user.id)
      .single();
    if (data?.role) role = data.role;
    if (data?.is_master_admin) isMasterAdmin = true;
  } catch {
    // Keep default.
  }

  return withSessionCookies(
    jsonResponse(
      { loggedIn: true, id: session.user.id, name: getFirstName(session.user), role, is_master_admin: isMasterAdmin },
      200,
    ),
    session.refreshedCookies,
  );
}
