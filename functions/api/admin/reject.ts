/**
 * Cloudflare Pages Function: POST /api/admin/reject
 *
 * Body: { id: string }
 *
 * Deletes a pending registration entirely: removes the profile row
 * and the corresponding auth.users entry so the email can be
 * re-registered later if it turns out to be a real person. Admin-
 * only. Used by the Pending Approvals tab when an admin recognises
 * a registration as spam or unwanted.
 *
 * Safety rail: refuses to reject a profile that's already approved,
 * so this endpoint can't be misused to wipe established accounts.
 * For removing approved members, use the role-management flow or
 * delete via Supabase directly.
 */
import { verifySession, withSessionCookies } from "../../../src/lib/session.ts";
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

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const session = await verifySession(context.request);
  const wrap = (resp: Response) => withSessionCookies(resp, session.refreshedCookies);

  try {
    if (!session.user) return wrap(jsonResponse({ error: "Unauthorized" }, 401));

    let body: { id?: unknown };
    try {
      body = await context.request.json();
    } catch {
      return wrap(jsonResponse({ error: "Invalid JSON body." }, 400));
    }

    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) return wrap(jsonResponse({ error: "Missing id." }, 400));

    const supabase = createClient(SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY);

    const { data: requester, error: requesterError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", session.user.id)
      .single();

    if (requesterError) return wrap(jsonResponse({ error: requesterError.message }, 500));
    if (requester?.role !== "admin") return wrap(jsonResponse({ error: "Forbidden" }, 403));

    const { data: target, error: targetError } = await supabase
      .from("profiles")
      .select("approved")
      .eq("id", id)
      .single();

    if (targetError) return wrap(jsonResponse({ error: targetError.message }, 404));
    if (target?.approved === true) {
      return wrap(jsonResponse({ error: "Cannot reject an already-approved member." }, 409));
    }

    // Delete profile first; if that fails we never touch auth. If the
    // auth delete fails after the profile delete, the registrant can
    // still be cleaned up via Supabase manually — better than the
    // reverse, which would leave an orphaned profile row.
    const { error: deleteProfileError } = await supabase
      .from("profiles")
      .delete()
      .eq("id", id);

    if (deleteProfileError) return wrap(jsonResponse({ error: deleteProfileError.message }, 500));

    const { error: deleteAuthError } = await supabase.auth.admin.deleteUser(id);
    if (deleteAuthError) {
      // Surface the auth error but don't try to recreate the profile —
      // the row is already gone and a real admin can finish the cleanup
      // in Supabase. Most callers will see this as "still removed" anyway.
      return wrap(jsonResponse({ error: `Profile deleted but auth cleanup failed: ${deleteAuthError.message}` }, 500));
    }

    return wrap(jsonResponse({ ok: true }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500),
    );
  }
}
