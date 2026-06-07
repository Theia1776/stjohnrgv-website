/**
 * Cloudflare Pages Function: POST /api/admin/remove
 *
 * Body: { id: string }
 *
 * Permanently deletes a member's account — the auth.users row plus
 * everything that references it (profile, directory listing, coffee-
 * hour signups, outstanding password-reset codes all cascade via their
 * `on delete cascade` foreign keys) and their avatar in storage.
 *
 * Unlike /api/admin/reject (which only removes *pending* sign-ups),
 * this works on approved members too. It's the "remove this person
 * from the site" action behind the Remove button on the admin Contact
 * List.
 *
 * Guardrails:
 *   - Admin-only (same role check as the other admin endpoints).
 *   - Refuses to delete the requesting admin's own account, so an admin
 *     can't accidentally lock themselves (or the last admin) out. To
 *     remove your own account, do it from the Supabase dashboard.
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

    // Don't let an admin delete themselves out of the system.
    if (id === session.user.id) {
      return wrap(jsonResponse(
        { error: "You can't remove your own account here. Use the Supabase dashboard if you really mean to." },
        400,
      ));
    }

    const supabase = createClient(SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY);

    const { data: requester, error: requesterError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", session.user.id)
      .single();

    if (requesterError) return wrap(jsonResponse({ error: requesterError.message }, 500));
    if (requester?.role !== "admin") return wrap(jsonResponse({ error: "Forbidden" }, 403));

    // Best-effort avatar cleanup. Storage objects aren't covered by the
    // auth.users cascade, so list and remove anything under this user's
    // avatar folder. Failures here shouldn't block the account deletion.
    try {
      const { data: files } = await supabase.storage.from("avatars").list(id);
      if (files && files.length > 0) {
        await supabase.storage
          .from("avatars")
          .remove(files.map((f) => `${id}/${f.name}`));
      }
    } catch {
      // Ignore — orphaned avatar files are harmless and can be tidied later.
    }

    // Delete the profile first (mirrors reject.ts). The auth delete below
    // would cascade it anyway, but removing it explicitly first means a
    // failure leaves the auth user intact rather than an orphaned profile.
    const { error: deleteProfileError } = await supabase
      .from("profiles")
      .delete()
      .eq("id", id);

    if (deleteProfileError) return wrap(jsonResponse({ error: deleteProfileError.message }, 500));

    // Removing the auth user cascades to anything still keyed on it
    // (coffee_hour_signups, password_resets).
    const { error: deleteAuthError } = await supabase.auth.admin.deleteUser(id);
    if (deleteAuthError) {
      return wrap(jsonResponse(
        { error: `Profile removed but auth cleanup failed: ${deleteAuthError.message}` },
        500,
      ));
    }

    return wrap(jsonResponse({ ok: true }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500),
    );
  }
}
