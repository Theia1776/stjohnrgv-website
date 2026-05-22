/**
 * Cloudflare Pages Function: GET /api/admin/pending
 *
 * Returns the list of profiles still awaiting admin approval
 * (approved = false), joined with auth.users to surface the email
 * and the registration timestamp. Used by the Pending Approvals
 * tab on /admin/contacts so admins don't have to log into Supabase
 * just to review new sign-ups.
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

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const session = await verifySession(context.request);
  const wrap = (resp: Response) => withSessionCookies(resp, session.refreshedCookies);

  try {
    if (!session.user) return wrap(jsonResponse({ error: "Unauthorized" }, 401));

    const supabase = createClient(SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY);

    const { data: requester, error: requesterError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", session.user.id)
      .single();

    if (requesterError) return wrap(jsonResponse({ error: requesterError.message }, 500));
    if (requester?.role !== "admin") return wrap(jsonResponse({ error: "Forbidden" }, 403));

    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, full_name, first_name, last_name, email, role")
      .eq("approved", false)
      .order("id", { ascending: true });

    if (profilesError) return wrap(jsonResponse({ error: profilesError.message }, 500));

    // Pull auth.users to get the canonical email + created_at. The
    // profiles.email column is filled at registration but auth.users
    // is the source of truth and also gives us the sign-up timestamp.
    const { data: authData, error: authError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    if (authError) return wrap(jsonResponse({ error: authError.message }, 500));

    const authMap: Record<string, { email: string; created_at: string }> = {};
    for (const u of authData?.users ?? []) {
      if (u.id) authMap[u.id] = { email: u.email ?? "", created_at: u.created_at ?? "" };
    }

    const pending = (profiles ?? []).map((p) => ({
      id: p.id,
      full_name: p.full_name,
      first_name: p.first_name,
      last_name: p.last_name,
      email: authMap[p.id]?.email || p.email || "",
      role: p.role,
      created_at: authMap[p.id]?.created_at || "",
    }));

    // Newest first so the people waiting longest are easy to spot at
    // the bottom and brand-new sign-ups land at the top.
    pending.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

    return wrap(jsonResponse({ pending }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500),
    );
  }
}
