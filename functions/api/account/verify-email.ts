/**
 * Cloudflare Pages Function: POST /api/account/verify-email
 *
 * Body: { code }
 *
 * Step 2 of a member changing their sign-in email. They submit the
 * 6-digit code that was emailed to the NEW address by
 * /api/account/change-email. We verify it against the HMAC stored in
 * public.email_changes and, on success, switch the auth.users email
 * (and mirror it onto profiles.email).
 *
 * Config: SUPABASE_SERVICE_ROLE_KEY.
 */
import { verifySession, withSessionCookies } from "../../../src/lib/session.ts";
import { SUPABASE_URL } from "../../../src/lib/supabase";
import { createClient } from "@supabase/supabase-js";
import { hashCode, timingSafeEqual, MAX_ATTEMPTS } from "../../../src/lib/reset-code";

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

  if (!session.user) return wrap(jsonResponse({ error: "Unauthorized" }, 401));
  if (!context.env.SUPABASE_SERVICE_ROLE_KEY) {
    return wrap(jsonResponse({ error: "Server not configured." }, 500));
  }

  let body: { code?: unknown };
  try {
    body = await context.request.json();
  } catch {
    return wrap(jsonResponse({ error: "Invalid JSON body." }, 400));
  }

  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!code) return wrap(jsonResponse({ error: "Enter the code from your email." }, 400));

  const admin = createClient(SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data: row } = await admin
    .from("email_changes")
    .select("id, new_email, code_hash, attempts, expires_at")
    .eq("user_id", session.user.id)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const invalid = () =>
    wrap(jsonResponse({ error: "That code is invalid or expired. Start the change again." }, 400));

  if (!row) return invalid();
  if (new Date(row.expires_at).getTime() < Date.now()) return invalid();
  if (row.attempts >= MAX_ATTEMPTS) {
    return wrap(jsonResponse({ error: "Too many attempts. Start the change again." }, 429));
  }

  const submitted = await hashCode(code, context.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!timingSafeEqual(submitted, row.code_hash)) {
    await admin.from("email_changes").update({ attempts: row.attempts + 1 }).eq("id", row.id);
    return invalid();
  }

  // Code is good — switch the login email.
  const { error: updErr } = await admin.auth.admin.updateUserById(session.user.id, {
    email: row.new_email,
    email_confirm: true,
  });
  if (updErr) {
    if (/registered|exists|duplicate/i.test(updErr.message)) {
      return wrap(jsonResponse({ error: "Another account now uses that email." }, 409));
    }
    return wrap(jsonResponse({ error: `Couldn't update email: ${updErr.message}` }, 500));
  }

  await admin.from("profiles").update({ email: row.new_email }).eq("id", session.user.id);
  await admin
    .from("email_changes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("user_id", session.user.id)
    .is("consumed_at", null);

  return wrap(jsonResponse({ ok: true, changed: true, email: row.new_email }, 200));
}
