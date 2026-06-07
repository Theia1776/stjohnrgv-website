/**
 * Cloudflare Pages Function: POST /api/account/change-email
 *
 * Body: { new_email }
 *
 * Step 1 of a member changing their own sign-in (login) email.
 *
 * For an ordinary member we DON'T switch the email yet — we email a
 * 6-digit code to the NEW address and store its HMAC in
 * public.email_changes. The member proves they own the new address by
 * entering the code at /api/account/verify-email, which performs the
 * actual switch. (Re-verification on change.)
 *
 * The master admin is exempt: their change applies immediately, no code.
 *
 * Config: SUPABASE_SERVICE_ROLE_KEY always; RESEND_API_KEY +
 * RESET_EMAIL_FROM for the member (code-sending) path.
 */
import { verifySession, withSessionCookies } from "../../../src/lib/session.ts";
import { SUPABASE_URL } from "../../../src/lib/supabase";
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "../../../src/lib/email";
import { generateCode, hashCode, CODE_TTL_MS } from "../../../src/lib/reset-code";

interface Env {
  SUPABASE_SERVICE_ROLE_KEY: string;
  RESEND_API_KEY: string;
  RESET_EMAIL_FROM: string;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function verifyEmailBody(code: string, ttlMinutes: number) {
  const text =
    `Use this code to confirm your new sign-in email for the St. John of ` +
    `Kronstadt parish website:\n\n` +
    `    ${code}\n\n` +
    `Enter it on the account page to finish the change. The code expires ` +
    `in ${ttlMinutes} minutes. If you didn't request this, you can ignore ` +
    `this email — nothing will change.`;
  const html =
    `<div style="font-family:Georgia,serif;color:#2b2b2b;line-height:1.6;max-width:480px">` +
    `<p>Use this code to confirm your new sign-in email for the ` +
    `St. John of Kronstadt parish website:</p>` +
    `<p style="font-size:30px;letter-spacing:8px;font-weight:bold;` +
    `font-family:'Courier New',monospace;margin:24px 0">${code}</p>` +
    `<p>Enter it on the account page to finish the change. The code ` +
    `expires in ${ttlMinutes} minutes.</p>` +
    `<p style="color:#777;font-size:14px">If you didn't request this, you ` +
    `can ignore this email — nothing will change.</p></div>`;
  return { text, html };
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const session = await verifySession(context.request);
  const wrap = (resp: Response) => withSessionCookies(resp, session.refreshedCookies);

  if (!session.user) return wrap(jsonResponse({ error: "Unauthorized" }, 401));
  if (!context.env.SUPABASE_SERVICE_ROLE_KEY) {
    return wrap(jsonResponse({ error: "Server not configured." }, 500));
  }

  let body: { new_email?: unknown };
  try {
    body = await context.request.json();
  } catch {
    return wrap(jsonResponse({ error: "Invalid JSON body." }, 400));
  }

  const newEmail = typeof body.new_email === "string" ? body.new_email.trim().toLowerCase() : "";
  if (!newEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newEmail)) {
    return wrap(jsonResponse({ error: "Please enter a valid email address." }, 400));
  }
  if (newEmail === (session.user.email ?? "").toLowerCase()) {
    return wrap(jsonResponse({ error: "That's already your sign-in email." }, 400));
  }

  const admin = createClient(SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // Early duplicate check against existing profiles (best-effort; the
  // auth update is the authoritative guard).
  const { data: taken } = await admin
    .from("profiles")
    .select("id")
    .eq("email", newEmail)
    .neq("id", session.user.id)
    .maybeSingle();
  if (taken) {
    return wrap(jsonResponse({ error: "Another account already uses that email." }, 409));
  }

  const { data: me } = await admin
    .from("profiles")
    .select("is_master_admin")
    .eq("id", session.user.id)
    .single();

  // Master admin: apply immediately, no verification.
  if (me?.is_master_admin === true) {
    const { error: updErr } = await admin.auth.admin.updateUserById(session.user.id, {
      email: newEmail,
      email_confirm: true,
    });
    if (updErr) {
      if (/registered|exists|duplicate/i.test(updErr.message)) {
        return wrap(jsonResponse({ error: "Another account already uses that email." }, 409));
      }
      return wrap(jsonResponse({ error: `Couldn't update email: ${updErr.message}` }, 500));
    }
    await admin.from("profiles").update({ email: newEmail }).eq("id", session.user.id);
    return wrap(jsonResponse({ ok: true, changed: true, email: newEmail }, 200));
  }

  // Member path: needs Resend configured to send the code.
  if (!context.env.RESEND_API_KEY || !context.env.RESET_EMAIL_FROM) {
    return wrap(jsonResponse({ error: "Server not configured for email." }, 500));
  }

  const code = generateCode();
  const code_hash = await hashCode(code, context.env.SUPABASE_SERVICE_ROLE_KEY);
  const expires_at = new Date(Date.now() + CODE_TTL_MS).toISOString();

  const { error: insErr } = await admin.from("email_changes").insert({
    user_id: session.user.id,
    new_email: newEmail,
    code_hash,
    expires_at,
  });
  if (insErr) {
    return wrap(jsonResponse({ error: "Couldn't start the email change. Try again." }, 500));
  }

  const ttlMinutes = Math.round(CODE_TTL_MS / 60000);
  const { text, html } = verifyEmailBody(code, ttlMinutes);
  const send = await sendEmail({
    apiKey: context.env.RESEND_API_KEY,
    from: context.env.RESET_EMAIL_FROM,
    to: newEmail,
    subject: "Confirm your new parish website email",
    text,
    html,
  });
  if (!send.ok) {
    console.error("Email-change code failed to send:", send.error);
    return wrap(jsonResponse({ error: "Couldn't send the verification email. Try again." }, 502));
  }

  return wrap(jsonResponse(
    { ok: true, pending: true, message: `We sent a 6-digit code to ${newEmail}.` },
    200,
  ));
}
