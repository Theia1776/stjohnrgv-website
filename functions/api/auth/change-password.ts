/**
 * Cloudflare Pages Function: POST /api/auth/change-password
 *
 * Body: { current_password, new_password }
 *
 * Changes the signed-in member's own password, from inside their
 * account. No email, no code, no waiting — the reset-by-code flow
 * (/api/auth/forgot then /api/auth/reset) stays for the case it's meant
 * for: someone locked out who can't sign in at all.
 *
 * The current password is required even though the session already
 * proves who this is. A session can be left open on a shared or stolen
 * machine; asking for the password once means a passer-by can't take
 * the account over with two clicks. It is checked the same way signing
 * in checks it — against Supabase Auth — so a wrong one can't slip past.
 *
 * Config (Cloudflare env): SUPABASE_SERVICE_ROLE_KEY.
 */

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../../../src/lib/supabase";
import { verifySession, withSessionCookies } from "../../../src/lib/session";

// Matches registration and the reset flow.
const MIN_PASSWORD = 8;

interface Env {
  SUPABASE_SERVICE_ROLE_KEY: string;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function onRequestPost(
  context: { request: Request; env: Env },
): Promise<Response> {
  const session = await verifySession(context.request);
  const wrap = (resp: Response) => withSessionCookies(resp, session.refreshedCookies);

  if (!session.user) {
    return wrap(jsonResponse({ error: "Please sign in first." }, 401));
  }
  if (!context.env.SUPABASE_SERVICE_ROLE_KEY) {
    return wrap(jsonResponse({ error: "Server not configured." }, 500));
  }

  let body: { current_password?: unknown; new_password?: unknown };
  try {
    body = await context.request.json();
  } catch {
    return wrap(jsonResponse({ error: "Invalid JSON body." }, 400));
  }

  const currentPassword =
    typeof body.current_password === "string" ? body.current_password : "";
  const newPassword = typeof body.new_password === "string" ? body.new_password : "";
  const email = (session.user.email ?? "").trim().toLowerCase();

  if (!currentPassword || !newPassword) {
    return wrap(
      jsonResponse({ error: "Your current password and a new one are both required." }, 400),
    );
  }
  if (newPassword.length < MIN_PASSWORD) {
    return wrap(
      jsonResponse(
        { error: `Your new password must be at least ${MIN_PASSWORD} characters.` },
        400,
      ),
    );
  }
  if (newPassword === currentPassword) {
    return wrap(
      jsonResponse({ error: "That's the password you already have." }, 400),
    );
  }
  if (!email) {
    // Every account here is created with an email, so this is a
    // should-never-happen — but changing a password on a guess is not
    // something to do quietly.
    return wrap(jsonResponse({ error: "This account has no email on file." }, 400));
  }

  // Check the current password exactly as signing in would. A fresh anon
  // client per request, so nothing is carried between callers.
  const auth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: signIn, error: signInError } = await auth.auth.signInWithPassword({
    email,
    password: currentPassword,
  });
  if (signInError || !signIn.session) {
    return wrap(jsonResponse({ error: "That isn't your current password." }, 401));
  }

  const admin = createClient(SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error: updateError } = await admin.auth.admin.updateUserById(session.user.id, {
    password: newPassword,
  });
  if (updateError) {
    return wrap(
      jsonResponse({ error: `Could not change your password: ${updateError.message}` }, 500),
    );
  }

  return wrap(
    jsonResponse({ ok: true, message: "Your password has been changed." }, 200),
  );
}
