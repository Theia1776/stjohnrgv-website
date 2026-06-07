/**
 * Cloudflare Pages Function: GET /api/admin/directory
 *
 * Parish directory view. Returns only profiles that opted into the
 * directory (`opt_in_directory = true`), and only includes the
 * fields each member individually consented to share (phone / email
 * / address). Phone, email, and address are nulled out for members
 * who haven't toggled the corresponding directory_show_* flag, so
 * the admin UI can render them uniformly without having to repeat
 * the consent check.
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
        "id, first_name, last_name, " +
        "phone, directory_show_phone, " +
        "address_line1, address_line2, city, state, zip, directory_show_address, " +
        "directory_show_email, public_email",
      )
      .eq("opt_in_directory", true)
      .order("last_name", { ascending: true });

    if (profilesError) return wrap(jsonResponse({ error: profilesError.message }, 500));

    // perPage:1000 — same reasoning as contacts.ts: Supabase defaults
    // to 50 users per page, and we'd silently lose emails past that.
    const { data: authData, error: authError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    if (authError) return wrap(jsonResponse({ error: authError.message }, 500));

    const emailMap: Record<string, string> = {};
    for (const u of authData?.users ?? []) {
      if (u.id) emailMap[u.id] = u.email ?? "";
    }

    const entries = (profiles ?? []).map((p) => ({
      first_name: p.first_name,
      last_name: p.last_name,
      phone: p.directory_show_phone ? p.phone : null,
      email: p.directory_show_email ? (p.public_email || emailMap[p.id] || "") : null,
      address_line1: p.directory_show_address ? p.address_line1 : null,
      address_line2: p.directory_show_address ? p.address_line2 : null,
      city: p.directory_show_address ? p.city : null,
      state: p.directory_show_address ? p.state : null,
      zip: p.directory_show_address ? p.zip : null,
    }));

    return wrap(jsonResponse({ entries }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500),
    );
  }
}
