/**
 * Cloudflare Pages Function: POST /api/auth/register
 *
 * Body: { email, password, full_name }
 *
 * Creates a Supabase auth user (using the service-role key so we can
 * skip the email-confirmation flow — approval is manual on our end),
 * inserts a row in public.profiles with approved=false, and notifies
 * the parish office via Formspree (same form as the contact page).
 *
 * The notification is best-effort: if Formspree is unreachable, the
 * registration still succeeds and we log a warning. The admin can
 * always see new pending users in the Supabase dashboard.
 */

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "../../../src/lib/supabase";

interface Env {
  SUPABASE_SERVICE_ROLE_KEY: string;
}

const FORMSPREE_ENDPOINT = "https://formspree.io/f/xaqvqnjr";
// Minimum password length matching Supabase's default policy. Surface a
// readable error before hitting Supabase so users see one consistent
// message instead of Supabase's generic "Password should be at least 6
// characters" buried in an error response.
const MIN_PASSWORD = 8;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function notifyParish(
  full_name: string,
  email: string,
): Promise<void> {
  // Formspree's JSON API: posting JSON with Accept: application/json
  // returns a JSON ack and avoids the HTML redirect flow.
  try {
    await fetch(FORMSPREE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        subject: `New parish website registration — ${full_name}`,
        name: full_name,
        email,
        message:
          `${full_name} (${email}) registered for an account on stjohnrgv.org and is awaiting approval.\n\n` +
          `Approve them in the Supabase dashboard: profiles table → set approved = true.`,
        _subject: `New parish website registration — ${full_name}`,
      }),
    });
  } catch (e) {
    // Best-effort. Log but don't fail the registration.
    console.warn("Formspree notification failed:", (e as Error).message);
  }
}

interface PagesContext {
  request: Request;
  env: Env;
  waitUntil?: (promise: Promise<unknown>) => void;
}

export async function onRequestPost(context: PagesContext): Promise<Response> {
  if (!context.env.SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse(
      {
        error: "Server not configured.",
        debug_keys: Object.keys(context.env || {}),
      },
      500,
    );
  }

  let body: { email?: unknown; password?: unknown; full_name?: unknown };
  try {
    body = await context.request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const full_name = typeof body.full_name === "string" ? body.full_name.trim() : "";

  if (!email || !password || !full_name) {
    return jsonResponse({ error: "Name, email, and password are required." }, 400);
  }
  if (password.length < MIN_PASSWORD) {
    return jsonResponse(
      { error: `Password must be at least ${MIN_PASSWORD} characters.` },
      400,
    );
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return jsonResponse({ error: "Please enter a valid email address." }, 400);
  }

  const admin = createClient(SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // Create the auth user directly (no email confirmation — approval is
  // manual). email_confirm: true marks the email as already verified so
  // the user can log in immediately once approved.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  });

  if (createErr || !created.user) {
    const msg = createErr?.message || "Could not create account.";
    // Surface the duplicate-email case nicely.
    if (/registered|exists|duplicate/i.test(msg)) {
      return jsonResponse({ error: "An account with that email already exists." }, 409);
    }
    return jsonResponse({ error: msg }, 400);
  }

  const { error: profileErr } = await admin.from("profiles").insert({
    id: created.user.id,
    email,
    full_name,
    role: "catechumen",
    approved: false,
  });

  if (profileErr) {
    // Roll back the auth user so the account isn't orphaned.
    await admin.auth.admin.deleteUser(created.user.id);
    return jsonResponse(
      { error: `Could not create profile: ${profileErr.message}` },
      500,
    );
  }

  // Fire and forget — don't block the response on Formspree.
  context.waitUntil?.(notifyParish(full_name, email));
  // If waitUntil isn't available (older runtimes), still try inline.
  if (!context.waitUntil) {
    await notifyParish(full_name, email);
  }

  return jsonResponse(
    {
      ok: true,
      pending: true,
      message:
        "Account created. The parish has been notified and will approve your registration shortly.",
    },
    201,
  );
}
