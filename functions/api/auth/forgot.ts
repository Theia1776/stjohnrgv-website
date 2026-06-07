/**
 * Cloudflare Pages Function: POST /api/auth/forgot
 *
 * Body: { email }
 *
 * Step 1 of the password-reset flow. Looks up the member by email,
 * generates a short numeric code, stores only its HMAC in
 * public.password_resets, and emails the plaintext code via Resend.
 * Step 2 is /api/auth/reset, where the member submits the code plus a
 * new password.
 *
 * IMPORTANT — this endpoint ALWAYS responds with the same generic 200,
 * whether or not the email matches an account. That prevents using the
 * form to enumerate which addresses are registered. The real outcome
 * (sent / not-found / rate-limited) is only visible in the server log.
 *
 * Config (Cloudflare env, never in the repo):
 *   - SUPABASE_SERVICE_ROLE_KEY  — read the profile, write the code row.
 *   - RESEND_API_KEY             — Resend secret key.
 *   - RESET_EMAIL_FROM           — verified From address.
 */

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "../../../src/lib/supabase";
import { sendEmail } from "../../../src/lib/email";
import {
  generateCode,
  hashCode,
  CODE_TTL_MS,
  MAX_CODES_PER_WINDOW,
} from "../../../src/lib/reset-code";

interface Env {
  SUPABASE_SERVICE_ROLE_KEY: string;
  RESEND_API_KEY: string;
  RESET_EMAIL_FROM: string;
}

interface PagesContext {
  request: Request;
  env: Env;
  waitUntil?: (promise: Promise<unknown>) => void;
}

const GENERIC_OK = {
  ok: true,
  message:
    "If an account exists for that email, a reset code is on its way. " +
    "Check your inbox (and spam folder).",
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function resetEmail(firstName: string, code: string, ttlMinutes: number) {
  const greeting = firstName ? `Hello ${firstName},` : "Hello,";
  const text =
    `${greeting}\n\n` +
    `We received a request to reset the password for your St. John of ` +
    `Kronstadt parish website account.\n\n` +
    `Your reset code is: ${code}\n\n` +
    `Enter it on the reset page along with your new password. The code ` +
    `expires in ${ttlMinutes} minutes.\n\n` +
    `If you didn't request this, you can safely ignore this email — your ` +
    `password won't change.\n\n` +
    `— St. John of Kronstadt Orthodox Mission`;

  const html =
    `<div style="font-family:Georgia,serif;color:#2b2b2b;line-height:1.6;max-width:480px">` +
    `<p>${greeting}</p>` +
    `<p>We received a request to reset the password for your ` +
    `St. John of Kronstadt parish website account.</p>` +
    `<p style="margin:24px 0">Your reset code is:</p>` +
    `<p style="font-size:30px;letter-spacing:8px;font-weight:bold;` +
    `font-family:'Courier New',monospace;margin:0 0 24px">${code}</p>` +
    `<p>Enter it on the reset page along with your new password. ` +
    `The code expires in ${ttlMinutes} minutes.</p>` +
    `<p style="color:#777;font-size:14px">If you didn't request this, you ` +
    `can safely ignore this email — your password won't change.</p>` +
    `<p style="margin-top:24px">— St. John of Kronstadt Orthodox Mission</p>` +
    `</div>`;

  return { text, html };
}

export async function onRequestPost(context: PagesContext): Promise<Response> {
  const { env } = context;
  if (!env.SUPABASE_SERVICE_ROLE_KEY || !env.RESEND_API_KEY || !env.RESET_EMAIL_FROM) {
    return jsonResponse({ error: "Server not configured." }, 500);
  }

  let body: { email?: unknown };
  try {
    body = await context.request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email) {
    return jsonResponse({ error: "Email is required." }, 400);
  }
  // Malformed address can't match an account — respond generically
  // without doing any work (still no enumeration signal).
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return jsonResponse(GENERIC_OK, 200);
  }

  const admin = createClient(SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // Find the account. No match → generic success, send nothing.
  const { data: profile } = await admin
    .from("profiles")
    .select("id, first_name, full_name")
    .eq("email", email)
    .maybeSingle();

  if (!profile) {
    return jsonResponse(GENERIC_OK, 200);
  }

  // Rate-limit: cap how many codes one email can request per window so
  // the endpoint can't be used to spam a member's inbox.
  const windowStart = new Date(Date.now() - CODE_TTL_MS).toISOString();
  const { count } = await admin
    .from("password_resets")
    .select("id", { count: "exact", head: true })
    .eq("email", email)
    .gte("created_at", windowStart);

  if ((count ?? 0) >= MAX_CODES_PER_WINDOW) {
    // Silently stop — still generic so the caller can't tell.
    console.warn(`Password reset rate-limited for ${email}`);
    return jsonResponse(GENERIC_OK, 200);
  }

  const code = generateCode();
  const code_hash = await hashCode(code, env.SUPABASE_SERVICE_ROLE_KEY);
  const expires_at = new Date(Date.now() + CODE_TTL_MS).toISOString();

  const { error: insertErr } = await admin.from("password_resets").insert({
    user_id: profile.id,
    email,
    code_hash,
    expires_at,
  });

  if (insertErr) {
    console.error("Could not store reset code:", insertErr.message);
    // Don't leak internals; treat as generic. Nothing was emailed.
    return jsonResponse(GENERIC_OK, 200);
  }

  const firstName =
    (typeof profile.first_name === "string" && profile.first_name.trim()) ||
    (typeof profile.full_name === "string" ? profile.full_name.trim().split(" ")[0] : "") ||
    "";
  const ttlMinutes = Math.round(CODE_TTL_MS / 60000);
  const { text, html } = resetEmail(firstName, code, ttlMinutes);

  const send = sendEmail({
    apiKey: env.RESEND_API_KEY,
    from: env.RESET_EMAIL_FROM,
    to: email,
    subject: "Your parish website password reset code",
    text,
    html,
  }).then((r) => {
    if (!r.ok) console.error("Reset email failed:", r.error);
  });

  // Don't block the response on the email round-trip when we can defer.
  if (context.waitUntil) {
    context.waitUntil(send);
  } else {
    await send;
  }

  return jsonResponse(GENERIC_OK, 200);
}
