/**
 * Cloudflare Pages Function: /api/auth/welcome
 *
 * GET  ?t=TOKEN            { ok, firstName }  so the page can greet them
 * POST { token, password } sets the password, signs them in, and the
 *                          page sends them to their account.
 *
 * Tokens come from /api/admin/invite. See that file for how they're kept.
 */

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../../../src/lib/supabase";
import { authCookies } from "../../../src/lib/session";
import { hashCode } from "../../../src/lib/reset-code";

interface Env {
  SUPABASE_SERVICE_ROLE_KEY: string;
}

const MIN_PASSWORD = 8;

function json(body: unknown, status: number, headers?: Headers): Response {
  const h = headers ?? new Headers();
  h.set("Content-Type", "application/json");
  h.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), { status, headers: h });
}

const GONE = "This link has already been used or has expired. Tap \"Forgot password\" on the sign-in page and we will email you a new code, or call the parish office.";

async function lookup(env: Env, token: string) {
  const admin = createClient(SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  if (!/^[0-9a-f]{48}$/.test(token)) return { admin, row: null };
  const hash = await hashCode(token, env.SUPABASE_SERVICE_ROLE_KEY);
  const { data } = await admin
    .from("password_resets")
    .select("id, user_id, email, expires_at")
    .eq("code_hash", hash)
    .is("consumed_at", null)
    .maybeSingle();
  const row = data && new Date(data.expires_at as string).getTime() >= Date.now() ? data : null;
  return { admin, row };
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  if (!context.env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "Server not configured." }, 500);
  const token = new URL(context.request.url).searchParams.get("t") ?? "";
  const { admin, row } = await lookup(context.env, token);
  if (!row) return json({ error: GONE }, 410);
  const { data: p } = await admin.from("profiles").select("first_name").eq("id", row.user_id).maybeSingle();
  return json({ ok: true, firstName: (p?.first_name as string) || "" }, 200);
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  if (!context.env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "Server not configured." }, 500);
  const body = (await context.request.json().catch(() => ({}))) as { token?: unknown; password?: unknown };
  const token = typeof body.token === "string" ? body.token : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < MIN_PASSWORD) {
    return json({ error: `Please use at least ${MIN_PASSWORD} letters or numbers.` }, 400);
  }

  const { admin, row } = await lookup(context.env, token);
  if (!row) return json({ error: GONE }, 410);

  const { error: upErr } = await admin.auth.admin.updateUserById(row.user_id as string, { password });
  if (upErr) return json({ error: `Could not save the password: ${upErr.message}` }, 500);

  // Used once.
  await admin.from("password_resets").update({ consumed_at: new Date().toISOString() }).eq("id", row.id);

  const auth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await auth.auth.signInWithPassword({ email: row.email as string, password });
  if (error || !data.session) {
    // Password is set; they can sign in by hand.
    return json({ ok: true, signedIn: false }, 200);
  }
  const headers = new Headers();
  for (const c of authCookies(data.session.access_token, data.session.refresh_token)) headers.append("Set-Cookie", c);
  return json({ ok: true, signedIn: true }, 200, headers);
}
