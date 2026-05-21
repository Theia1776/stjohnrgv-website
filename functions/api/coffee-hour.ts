/**
 * Cloudflare Pages Function: /api/coffee-hour
 *
 * Backs the parishioner-only coffee hour signup page.
 *
 *   GET    → list every signup whose sunday_date is today or later
 *            (capped at the next 8 Sundays so the payload stays small)
 *   POST   → create a signup for the calling user
 *            body: { sunday_date, display_name, item }
 *   PATCH  → edit the caller's own signup
 *            body: { id, display_name?, item? }
 *   DELETE → remove the caller's own signup
 *            body: { id }
 *
 * Every method requires a valid session. UPDATE/DELETE additionally
 * require that the row's user_id matches the caller — checked in code
 * because the table has no per-row write policy (writes go through the
 * service-role key).
 */

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "../../src/lib/supabase";
import { verifySession, withSessionCookies } from "../../src/lib/session.ts";

interface Env {
  SUPABASE_SERVICE_ROLE_KEY: string;
}

const TABLE = "coffee_hour_signups";
const MAX_SUNDAYS_AHEAD = 8;
const MAX_NAME_LEN = 100;
const MAX_ITEM_LEN = 200;

function getSupabase(env: Env) {
  return createClient(SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Today in UTC as YYYY-MM-DD. Used as the lower bound for the list query. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** YYYY-MM-DD string → Date at 00:00 UTC, or null if malformed. */
function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  // Round-trip check rules out things like 2026-02-30.
  if (d.toISOString().slice(0, 10) !== value) return null;
  return d;
}

/** True when `date` is a Sunday in UTC. */
function isSunday(date: Date): boolean {
  return date.getUTCDay() === 0;
}

/** ISO date of the Sunday that is `weeks` weeks past the next/this Sunday. */
function sundayHorizonIso(weeksAhead: number): string {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const daysToNextSunday = (7 - today.getUTCDay()) % 7; // 0 if today is Sunday
  const horizon = new Date(today);
  horizon.setUTCDate(today.getUTCDate() + daysToNextSunday + weeksAhead * 7);
  return horizon.toISOString().slice(0, 10);
}

function trimToLen(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

// ============================================================================
// GET — list upcoming signups
// ============================================================================

export async function onRequestGet(
  context: { request: Request; env: Env },
): Promise<Response> {
  const session = await verifySession(context.request);
  const wrap = (resp: Response) => withSessionCookies(resp, session.refreshedCookies);

  try {
    if (!session.user) return wrap(jsonResponse({ error: "Unauthorized" }, 401));
    if (!context.env.SUPABASE_SERVICE_ROLE_KEY) {
      return wrap(jsonResponse({ error: "Server not configured." }, 500));
    }

    const supabase = getSupabase(context.env);
    const { data, error } = await supabase
      .from(TABLE)
      .select("id, user_id, sunday_date, display_name, item, created_at, updated_at")
      .gte("sunday_date", todayIso())
      .lte("sunday_date", sundayHorizonIso(MAX_SUNDAYS_AHEAD - 1))
      .order("sunday_date", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) return wrap(jsonResponse({ error: error.message }, 500));

    return wrap(jsonResponse({ signups: data ?? [], current_user_id: session.user.id }, 200));
  } catch (err) {
    console.error("coffee-hour GET failed:", err);
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500),
    );
  }
}

// ============================================================================
// POST — create
// ============================================================================

export async function onRequestPost(
  context: { request: Request; env: Env },
): Promise<Response> {
  const session = await verifySession(context.request);
  const wrap = (resp: Response) => withSessionCookies(resp, session.refreshedCookies);

  try {
    if (!session.user) return wrap(jsonResponse({ error: "Unauthorized" }, 401));
    if (!context.env.SUPABASE_SERVICE_ROLE_KEY) {
      return wrap(jsonResponse({ error: "Server not configured." }, 500));
    }

    let body: Record<string, unknown>;
    try {
      body = await context.request.json();
    } catch {
      return wrap(jsonResponse({ error: "Invalid JSON" }, 400));
    }

    const sundayDate = parseIsoDate(body.sunday_date);
    if (!sundayDate) {
      return wrap(jsonResponse({ error: "sunday_date must be a YYYY-MM-DD date" }, 400));
    }
    if (!isSunday(sundayDate)) {
      return wrap(jsonResponse({ error: "sunday_date must be a Sunday" }, 400));
    }
    if (sundayDate.toISOString().slice(0, 10) < todayIso()) {
      return wrap(jsonResponse({ error: "sunday_date must be today or later" }, 400));
    }

    const displayName = trimToLen(body.display_name, MAX_NAME_LEN);
    if (!displayName) return wrap(jsonResponse({ error: "display_name is required" }, 400));

    const item = trimToLen(body.item, MAX_ITEM_LEN);
    if (!item) return wrap(jsonResponse({ error: "item is required" }, 400));

    const supabase = getSupabase(context.env);
    const { data, error } = await supabase
      .from(TABLE)
      .insert({
        user_id: session.user.id,
        sunday_date: sundayDate.toISOString().slice(0, 10),
        display_name: displayName,
        item,
      })
      .select("id, user_id, sunday_date, display_name, item, created_at, updated_at")
      .single();

    if (error) return wrap(jsonResponse({ error: error.message }, 500));
    return wrap(jsonResponse({ signup: data }, 200));
  } catch (err) {
    console.error("coffee-hour POST failed:", err);
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500),
    );
  }
}

// ============================================================================
// PATCH — edit own
// ============================================================================

export async function onRequestPatch(
  context: { request: Request; env: Env },
): Promise<Response> {
  const session = await verifySession(context.request);
  const wrap = (resp: Response) => withSessionCookies(resp, session.refreshedCookies);

  try {
    if (!session.user) return wrap(jsonResponse({ error: "Unauthorized" }, 401));
    if (!context.env.SUPABASE_SERVICE_ROLE_KEY) {
      return wrap(jsonResponse({ error: "Server not configured." }, 500));
    }

    let body: Record<string, unknown>;
    try {
      body = await context.request.json();
    } catch {
      return wrap(jsonResponse({ error: "Invalid JSON" }, 400));
    }

    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return wrap(jsonResponse({ error: "id is required" }, 400));

    const updates: Record<string, unknown> = {};
    if (body.display_name !== undefined) {
      const v = trimToLen(body.display_name, MAX_NAME_LEN);
      if (!v) return wrap(jsonResponse({ error: "display_name cannot be empty" }, 400));
      updates.display_name = v;
    }
    if (body.item !== undefined) {
      const v = trimToLen(body.item, MAX_ITEM_LEN);
      if (!v) return wrap(jsonResponse({ error: "item cannot be empty" }, 400));
      updates.item = v;
    }
    if (Object.keys(updates).length === 0) {
      return wrap(jsonResponse({ error: "Nothing to update" }, 400));
    }
    updates.updated_at = new Date().toISOString();

    const supabase = getSupabase(context.env);

    // Ownership check.
    const { data: existing, error: fetchErr } = await supabase
      .from(TABLE)
      .select("user_id")
      .eq("id", id)
      .single();

    if (fetchErr || !existing) {
      return wrap(jsonResponse({ error: "Signup not found" }, 404));
    }
    if (existing.user_id !== session.user.id) {
      return wrap(jsonResponse({ error: "You can only edit your own signups" }, 403));
    }

    const { data, error } = await supabase
      .from(TABLE)
      .update(updates)
      .eq("id", id)
      .select("id, user_id, sunday_date, display_name, item, created_at, updated_at")
      .single();

    if (error) return wrap(jsonResponse({ error: error.message }, 500));
    return wrap(jsonResponse({ signup: data }, 200));
  } catch (err) {
    console.error("coffee-hour PATCH failed:", err);
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500),
    );
  }
}

// ============================================================================
// DELETE — remove own
// ============================================================================

export async function onRequestDelete(
  context: { request: Request; env: Env },
): Promise<Response> {
  const session = await verifySession(context.request);
  const wrap = (resp: Response) => withSessionCookies(resp, session.refreshedCookies);

  try {
    if (!session.user) return wrap(jsonResponse({ error: "Unauthorized" }, 401));
    if (!context.env.SUPABASE_SERVICE_ROLE_KEY) {
      return wrap(jsonResponse({ error: "Server not configured." }, 500));
    }

    let body: Record<string, unknown>;
    try {
      body = await context.request.json();
    } catch {
      return wrap(jsonResponse({ error: "Invalid JSON" }, 400));
    }

    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return wrap(jsonResponse({ error: "id is required" }, 400));

    const supabase = getSupabase(context.env);

    const { data: existing, error: fetchErr } = await supabase
      .from(TABLE)
      .select("user_id")
      .eq("id", id)
      .single();

    if (fetchErr || !existing) {
      return wrap(jsonResponse({ error: "Signup not found" }, 404));
    }
    if (existing.user_id !== session.user.id) {
      return wrap(jsonResponse({ error: "You can only remove your own signups" }, 403));
    }

    const { error } = await supabase.from(TABLE).delete().eq("id", id);
    if (error) return wrap(jsonResponse({ error: error.message }, 500));

    return wrap(jsonResponse({ ok: true }, 200));
  } catch (err) {
    console.error("coffee-hour DELETE failed:", err);
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500),
    );
  }
}
