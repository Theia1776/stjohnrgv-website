/**
 * Cloudflare Pages Function: POST /api/admin/approve
 *
 * Body: { id: string }
 *
 * Sets approved=true on the given profile row. Admin-only. Pairs with
 * /api/admin/pending and /api/admin/reject to power the Pending
 * Approvals tab on /admin/contacts.
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

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ approved: true })
      .eq("id", id);

    if (updateError) return wrap(jsonResponse({ error: updateError.message }, 500));

    return wrap(jsonResponse({ ok: true }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500),
    );
  }
}
