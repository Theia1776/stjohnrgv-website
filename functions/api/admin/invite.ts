/**
 * Cloudflare Pages Function: POST /api/admin/invite
 *
 * Body: { email, firstName, lastName?, role?, send? }   (lastName can be left out; they fill it in themselves)
 *
 * Admin-only. Sets up an account for someone who would rather not sign
 * up themselves, then (when `send` is true) emails them a button. The
 * button opens /welcome/ with one box for choosing a password and drops
 * them into their account.
 *
 * - The account is created already approved, with a long random
 *   password nobody knows (the person chooses their own on the welcome
 *   page). Role defaults to "inquirer"; an admin raises it later.
 * - If the account already exists and the person has never signed in,
 *   this just issues a fresh link, so it doubles as "send it again".
 * - The link is a random token. Only its HMAC is stored (in the same
 *   password_resets table the reset codes use), good for 14 days, and
 *   used once.
 */

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "../../../src/lib/supabase";
import { verifySession, withSessionCookies } from "../../../src/lib/session.ts";
import { hashCode } from "../../../src/lib/reset-code";
import { sendEmail } from "../../../src/lib/email";
import { welcomeEmail } from "../../../src/lib/welcome-email";

interface Env {
  SUPABASE_SERVICE_ROLE_KEY: string;
  RESEND_API_KEY: string;
  RESET_EMAIL_FROM: string;
}

const WELCOME_DAYS = 14;
const ROLES = ["inquirer", "catechumen", "member"] as const;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function onRequestPost(
  context: { request: Request; env: Env },
): Promise<Response> {
  const { env } = context;
  const session = await verifySession(context.request);
  const wrap = (r: Response) => withSessionCookies(r, session.refreshedCookies);

  try {
    if (!session.user) return wrap(json({ error: "Unauthorized" }, 401));
    if (!env.SUPABASE_SERVICE_ROLE_KEY) return wrap(json({ error: "Server not configured." }, 500));

    const admin = createClient(SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const { data: me } = await admin.from("profiles").select("role").eq("id", session.user.id).single();
    if (me?.role !== "admin") return wrap(json({ error: "Forbidden" }, 403));

    const body = (await context.request.json().catch(() => ({}))) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const email = str(body.email).toLowerCase();
    const firstName = str(body.firstName);
    const lastName = str(body.lastName);
    const role = ROLES.includes(str(body.role) as (typeof ROLES)[number]) ? str(body.role) : "inquirer";
    const send = body.send === true;

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return wrap(json({ error: "That email address isn't valid." }, 400));
    if (!firstName) return wrap(json({ error: "A first name is needed." }, 400));

    // Find or create.
    let userId: string;
    let created = false;
    const { data: existing } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
    if (existing) {
      userId = existing.id as string;
      const { data: au } = await admin.auth.admin.getUserById(userId);
      if (au?.user?.last_sign_in_at) {
        return wrap(json({ error: "That person has already signed in. They can use Forgot password if they need a new one." }, 409));
      }
    } else {
      const full_name = `${firstName} ${lastName}`.trim();
      const { data: made, error: makeErr } = await admin.auth.admin.createUser({
        email,
        password: randomHex(32),
        email_confirm: true,
        user_metadata: { full_name },
      });
      if (makeErr || !made.user) return wrap(json({ error: makeErr?.message || "Could not create the account." }, 400));
      userId = made.user.id;
      const { error: profErr } = await admin.from("profiles").insert({
        id: userId,
        email,
        full_name,
        first_name: firstName,
        last_name: lastName || null,
        role,
        approved: true,
      });
      if (profErr) {
        await admin.auth.admin.deleteUser(userId);
        return wrap(json({ error: `Could not create the profile: ${profErr.message}` }, 500));
      }
      created = true;
    }

    if (!send) return wrap(json({ ok: true, created, sent: false }, 200));

    if (!env.RESEND_API_KEY || !env.RESET_EMAIL_FROM) return wrap(json({ error: "Email isn't set up on the server." }, 500));

    // A fresh link replaces any earlier unused ones.
    await admin.from("password_resets").update({ consumed_at: new Date().toISOString() }).eq("user_id", userId).is("consumed_at", null);
    const token = randomHex(24);
    const { error: tokErr } = await admin.from("password_resets").insert({
      user_id: userId,
      email,
      code_hash: await hashCode(token, env.SUPABASE_SERVICE_ROLE_KEY),
      expires_at: new Date(Date.now() + WELCOME_DAYS * 86400000).toISOString(),
    });
    if (tokErr) return wrap(json({ error: tokErr.message }, 500));

    const origin = new URL(context.request.url).origin;
    const { subject, text, html } = welcomeEmail(`${firstName} ${lastName}`.trim(), `${origin}/welcome/?t=${token}`, WELCOME_DAYS);
    const result = await sendEmail({
      apiKey: env.RESEND_API_KEY,
      from: env.RESET_EMAIL_FROM,
      to: email,
      replyTo: "parishoffice@stjohnrgv.org",
      subject,
      text,
      html,
    });
    if (!result.ok) return wrap(json({ error: `The email didn't go out: ${result.error}` }, 502));
    return wrap(json({ ok: true, created, sent: true, messageId: result.id }, 200));
  } catch (err) {
    return wrap(json({ error: err instanceof Error ? err.message : "Unexpected error." }, 500));
  }
}
