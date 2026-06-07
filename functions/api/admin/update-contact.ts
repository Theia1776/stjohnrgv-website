/**
 * Cloudflare Pages Function: POST /api/admin/update-contact
 *
 * Body: { id: string, updates: { ...profile fields, email? } }
 *
 * Lets an admin edit another member's contact details from the Contact
 * List. The self-service /api/profile PATCH only edits the logged-in
 * user's own row; this is the admin equivalent, keyed by an explicit
 * `id`.
 *
 * `email` is handled specially: it lives on auth.users (the login
 * identity), not just the profile, so when it changes we update the
 * auth user too and mirror it onto profiles.email.
 *
 * Admin-only, same role check as the other admin endpoints.
 */
import { verifySession, withSessionCookies } from "../../../src/lib/session.ts";
import { SUPABASE_URL } from "../../../src/lib/supabase";
import { createClient } from "@supabase/supabase-js";

interface Env {
  SUPABASE_SERVICE_ROLE_KEY: string;
}

// Profile columns an admin may edit here. Mirrors the self-service
// allow-list in functions/api/profile.ts, minus the avatar (no upload
// path from the admin UI) and the per-field directory toggles (not
// surfaced on the Contact List). `email` is handled separately below.
const PATCH_ALLOWED = [
  "first_name", "last_name", "phone",
  "address_line1", "address_line2", "city", "state", "zip",
  "emergency_name", "emergency_relationship", "emergency_phone",
  "emergency_name_2", "emergency_relationship_2", "emergency_phone_2",
  "opt_in_directory",
] as const;

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

    let body: { id?: unknown; updates?: unknown };
    try {
      body = await context.request.json();
    } catch {
      return wrap(jsonResponse({ error: "Invalid JSON body." }, 400));
    }

    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) return wrap(jsonResponse({ error: "Missing id." }, 400));

    const updates = (body.updates && typeof body.updates === "object")
      ? body.updates as Record<string, unknown>
      : {};

    const supabase = createClient(SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY);

    const { data: requester, error: requesterError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", session.user.id)
      .single();

    if (requesterError) return wrap(jsonResponse({ error: requesterError.message }, 500));
    if (requester?.role !== "admin") return wrap(jsonResponse({ error: "Forbidden" }, 403));

    // Build the profile patch from the allow-list.
    const profileUpdates: Record<string, unknown> = {};
    for (const key of PATCH_ALLOWED) {
      if (key in updates) profileUpdates[key] = updates[key];
    }

    // Handle an email change against auth.users first — if it fails
    // (e.g. duplicate), we bail before touching the profile so the two
    // stay in sync.
    if ("email" in updates) {
      const newEmail = typeof updates.email === "string" ? updates.email.trim().toLowerCase() : "";
      if (!newEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newEmail)) {
        return wrap(jsonResponse({ error: "Please enter a valid email address." }, 400));
      }
      const { error: emailErr } = await supabase.auth.admin.updateUserById(id, { email: newEmail });
      if (emailErr) {
        if (/registered|exists|duplicate/i.test(emailErr.message)) {
          return wrap(jsonResponse({ error: "Another account already uses that email." }, 409));
        }
        return wrap(jsonResponse({ error: `Couldn't update email: ${emailErr.message}` }, 500));
      }
      profileUpdates.email = newEmail;
    }

    if (Object.keys(profileUpdates).length > 0) {
      const { error: updateError } = await supabase
        .from("profiles")
        .update(profileUpdates)
        .eq("id", id);
      if (updateError) return wrap(jsonResponse({ error: updateError.message }, 500));
    }

    return wrap(jsonResponse({ ok: true }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500),
    );
  }
}
