/**
 * Cloudflare Pages Function: GET /api/admin/contacts
 *
 * Master contact list for parish administrators. Returns every
 * profile that opted into communications, joined with auth.users
 * to pick up the email address. Service-role key required because
 * we hit auth.admin.listUsers().
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
      .select(
        "id, first_name, last_name, phone, " +
        "address_line1, address_line2, city, state, zip, " +
        "emergency_name, emergency_relationship, emergency_phone, " +
        "emergency_name_2, emergency_relationship_2, emergency_phone_2, " +
        "opt_in_directory, directory_show_phone, directory_show_email, directory_show_address, " +
        "avatar_url",
      )
      .eq("opt_in_communications", true)
      .order("last_name", { ascending: true });

    if (profilesError) return wrap(jsonResponse({ error: profilesError.message }, 500));

    // perPage:1000 — Supabase defaults to 50, which would silently
    // truncate the list as the parish grows. The admin API caps each
    // page at 1000; we'd need to paginate explicitly past that.
    const { data: authData, error: authError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    if (authError) return wrap(jsonResponse({ error: authError.message }, 500));

    const emailMap: Record<string, string> = {};
    for (const u of authData?.users ?? []) {
      if (u.id) emailMap[u.id] = u.email ?? "";
    }

    const contacts = (profiles ?? []).map((p) => ({
      ...p,
      email: emailMap[p.id] ?? "",
    }));

    return wrap(jsonResponse({ contacts }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500),
    );
  }
}
