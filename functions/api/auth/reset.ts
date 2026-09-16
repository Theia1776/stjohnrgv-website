/**
 * Cloudflare Pages Function: POST /api/auth/reset
 *
 * Body: { email, code, password }
 *
 * Step 2 of the password-reset flow (step 1 is /api/auth/forgot). The
 * member submits the code they were emailed plus a new password. We
 * verify the code against the HMAC stored in public.password_resets,
 * and if it matches we set the new password through the Supabase Admin
 * API and burn the code so it can't be reused.
 *
 * Unlike /api/auth/forgot, this endpoint gives real feedback ("invalid
 * or expired code") — the caller already proved they know both the
 * email and a code, so there's no enumeration value left to protect,
 * and a clear message is far friendlier mid-flow.
 *
 * Config (Cloudflare env): SUPABASE_SERVICE_ROLE_KEY.
 */

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "../../../src/lib/supabase";
import { hashCode, timingSafeEqual, MAX_ATTEMPTS } from "../../../src/lib/reset-code";

// Matches the minimum enforced at registration (functions/api/auth/register.ts).
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
  if (!context.env.SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ error: "Server not configured." }, 500);
  }

  let body: { email?: unknown; code?: unknown; password?: unknown };
  try {
    body = await context.request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !code || !password) {
    return jsonResponse({ error: "Email, code, and new password are required." }, 400);
  }
  if (password.length < MIN_PASSWORD) {
    return jsonResponse(
      { error: `Password must be at least ${MIN_PASSWORD} characters.` },
      400,
    );
  }

  const admin = createClient(SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // Every un-consumed code for this email, newest first.
  //
  // Only the newest used to count, which quietly broke the flow it was
  // meant to serve: reaching the code-entry screen means asking for a
  // code, so a code already sitting in the inbox — from a first attempt,
  // or from someone helping — was dead before it was typed. Nothing was
  // wrong with it and the message said "invalid or expired".
  //
  // Any code that hasn't expired and hasn't been used is honoured. Each
  // is single-use, each dies within the same window, and every code for
  // the address is burned the moment one succeeds, so nothing outlives
  // the reset it belongs to.
  const { data: rows } = await admin
    .from("password_resets")
    .select("id, user_id, code_hash, attempts, expires_at")
    .eq("email", email)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(10);

  const invalid = () =>
    jsonResponse({ error: "That code is invalid or expired. Request a new one." }, 400);

  const live = (rows ?? []).filter(
    (r) => new Date(r.expires_at).getTime() >= Date.now(),
  );
  if (live.length === 0) return invalid();

  // Attempts are counted across the live codes together, so issuing more
  // of them can't be used to widen the guessing budget.
  const attempts = live.reduce((total, r) => total + (r.attempts as number), 0);
  if (attempts >= MAX_ATTEMPTS) {
    return jsonResponse(
      { error: "Too many attempts. Request a new code and try again." },
      429,
    );
  }

  const submittedHash = await hashCode(code, context.env.SUPABASE_SERVICE_ROLE_KEY);
  const row = live.find((r) => timingSafeEqual(submittedHash, r.code_hash as string));
  if (!row) {
    // Burn an attempt so the 6-digit space can't be ground down.
    await admin
      .from("password_resets")
      .update({ attempts: (live[0].attempts as number) + 1 })
      .eq("id", live[0].id);
    return invalid();
  }

  // Code is good — set the new password via the Admin API.
  const { error: updateErr } = await admin.auth.admin.updateUserById(row.user_id, {
    password,
  });
  if (updateErr) {
    return jsonResponse({ error: `Could not update password: ${updateErr.message}` }, 500);
  }

  // Burn this code and any other outstanding codes for the email so
  // none can be replayed.
  await admin
    .from("password_resets")
    .update({ consumed_at: new Date().toISOString() })
    .eq("email", email)
    .is("consumed_at", null);

  return jsonResponse(
    { ok: true, message: "Your password has been changed. You can now sign in." },
    200,
  );
}
