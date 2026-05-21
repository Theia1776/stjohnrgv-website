/**
 * Cloudflare Pages Function: GET /api/directory
 *
 * Parishioner-facing directory. Any logged-in user can read it.
 *
 * Returns only profiles where opt_in_directory = true, with phone /
 * email / address fields nulled out individually based on each
 * person's directory_show_* flags. Includes role and avatar_url so
 * the UI can show a member-cross indicator (☦) and a per-person
 * photo (or initials placeholder).
 *
 * This is the parishioner-scope twin of functions/api/admin/directory.ts:
 * same query and consent logic, but no admin role check, and returns
 * a couple of extra fields the admin view doesn't need.
 */

import { verifySession, withSessionCookies } from "../../src/lib/session.ts";
import { SUPABASE_URL } from "../../src/lib/supabase";
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

export async function onRequestGet(
  context: { request: Request; env: Env },
): Promise<Response> {
  const session = await verifySession(context.request);
  const wrap = (resp: Response) => withSessionCookies(resp, session.refreshedCookies);

  try {
    if (!session.user) return wrap(jsonResponse({ error: "Unauthorized" }, 401));
    if (!context.env.SUPABASE_SERVICE_ROLE_KEY) {
      return wrap(jsonResponse({ error: "Server not configured." }, 500));
    }

    const supabase = createClient(SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select(
        "id, first_name, last_name, role, avatar_url, " +
        "phone, directory_show_phone, " +
        "address_line1, address_line2, city, state, zip, directory_show_address, " +
        "directory_show_email",
      )
      .eq("opt_in_directory", true)
      .order("last_name", { ascending: true })
      .order("first_name", { ascending: true });

    if (profilesError) return wrap(jsonResponse({ error: profilesError.message }, 500));

    // perPage:1000 — Supabase auth.admin.listUsers defaults to 50 per
    // page; we'd silently lose emails past that. Matches the admin
    // directory endpoint's reasoning.
    const { data: authData, error: authError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    if (authError) return wrap(jsonResponse({ error: authError.message }, 500));

    const emailMap: Record<string, string> = {};
    for (const u of authData?.users ?? []) {
      if (u.id) emailMap[u.id] = u.email ?? "";
    }

    const entries = (profiles ?? []).map((p) => ({
      id: p.id,
      first_name: p.first_name,
      last_name: p.last_name,
      role: p.role,
      avatar_url: p.avatar_url,
      phone: p.directory_show_phone ? p.phone : null,
      email: p.directory_show_email ? (emailMap[p.id] ?? "") : null,
      address_line1: p.directory_show_address ? p.address_line1 : null,
      address_line2: p.directory_show_address ? p.address_line2 : null,
      city: p.directory_show_address ? p.city : null,
      state: p.directory_show_address ? p.state : null,
      zip: p.directory_show_address ? p.zip : null,
    }));

    return wrap(jsonResponse({ entries }, 200));
  } catch (err) {
    console.error("directory GET failed:", err);
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500),
    );
  }
}
