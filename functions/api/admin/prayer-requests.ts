/**
 * Cloudflare Pages Function: /api/admin/prayer-requests
 *
 *   GET    — every request, newest first, new ones at the top.
 *   PATCH  — mark one included or archived.
 *   DELETE — remove one for good.
 *
 * Admin only. This is the single place these rows can be read; the
 * table has no select policy at all, so nothing else on the site —
 * signed in or not — can reach them.
 */
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "../../../src/lib/supabase";
import { verifySession, withSessionCookies } from "../../../src/lib/session.ts";

interface Env {
  SUPABASE_SERVICE_ROLE_KEY: string;
}

const FIELDS = "id, kind, name, requested_by, contact, note, status, created_at";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function requireAdmin(context: { request: Request; env: Env }) {
  const session = await verifySession(context.request);
  const wrap = (resp: Response) => withSessionCookies(resp, session.refreshedCookies);

  if (!session.user) return { error: wrap(jsonResponse({ error: "Unauthorized" }, 401)) };
  if (!context.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: wrap(jsonResponse({ error: "Server not configured." }, 500)) };
  }
  const supabase = createClient(SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .single();
  if (profile?.role !== "admin") return { error: wrap(jsonResponse({ error: "Forbidden" }, 403)) };
  return { supabase, wrap };
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const gate = await requireAdmin(context);
  if (gate.error) return gate.error;

  const { data, error } = await gate
    .supabase!.from("prayer_requests")
    .select(FIELDS)
    // New ones first, then newest within each state: the ones needing
    // a decision are the job.
    .order("status", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) {
    const missing = /prayer_requests/.test(error.message) &&
      /does not exist|schema cache/i.test(error.message);
    return gate.wrap!(jsonResponse({ error: error.message, pending: missing }, 500));
  }

  const rows = data ?? [];
  return gate.wrap!(
    jsonResponse(
      {
        requests: rows,
        living: rows.filter((r) => r.kind === "living" && r.status === "new").length,
        departed: rows.filter((r) => r.kind === "departed" && r.status === "new").length,
      },
      200,
    ),
  );
}

export async function onRequestPatch(context: { request: Request; env: Env }): Promise<Response> {
  const gate = await requireAdmin(context);
  if (gate.error) return gate.error;

  let body: Record<string, unknown>;
  try {
    body = await context.request.json();
  } catch {
    return gate.wrap!(jsonResponse({ error: "Invalid request." }, 400));
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  const status = String(body.status ?? "");
  if (!id) return gate.wrap!(jsonResponse({ error: "Missing id." }, 400));
  if (!["new", "included", "archived"].includes(status)) {
    return gate.wrap!(jsonResponse({ error: "Unknown status." }, 400));
  }

  const { data, error } = await gate
    .supabase!.from("prayer_requests")
    .update({ status })
    .eq("id", id)
    .select(FIELDS)
    .single();

  if (error) return gate.wrap!(jsonResponse({ error: error.message }, 500));
  return gate.wrap!(jsonResponse({ request: data }, 200));
}

/**
 * Remove a request for good.
 *
 * A prayer list is not an archive. Once a name has been prayed for and
 * printed there is no reason to keep holding a record of who was ill
 * and what their family told the priest about it — the least sensitive
 * state for that row is not existing. So this is a real delete, not a
 * flag, and the page asks before calling it.
 */
export async function onRequestDelete(context: { request: Request; env: Env }): Promise<Response> {
  const gate = await requireAdmin(context);
  if (gate.error) return gate.error;

  const id = new URL(context.request.url).searchParams.get("id")?.trim() ?? "";
  if (!id) return gate.wrap!(jsonResponse({ error: "Missing id." }, 400));

  // Read it back first so the page can name what it removed rather
  // than reporting a bare success.
  const { data: existing } = await gate
    .supabase!.from("prayer_requests")
    .select("name, kind")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return gate.wrap!(jsonResponse({ error: "No such request." }, 404));

  const { error } = await gate.supabase!.from("prayer_requests").delete().eq("id", id);
  if (error) return gate.wrap!(jsonResponse({ error: error.message }, 500));

  return gate.wrap!(jsonResponse({ ok: true, name: existing.name, kind: existing.kind }, 200));
}
