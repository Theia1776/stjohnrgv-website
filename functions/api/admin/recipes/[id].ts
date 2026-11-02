/**
 * Cloudflare Pages Function: /api/admin/recipes/:id
 *
 *   PATCH  — post it, un-post it, or correct it.
 *   DELETE — remove it.
 *
 * Correcting matters as much as posting: a recipe arrives as someone
 * typed it at their kitchen table, and fixing a quantity or moving a
 * dish out of the fasting book shouldn't mean sending it back.
 *
 * Admin-only.
 */
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "../../../../src/lib/supabase";
import { verifySession, withSessionCookies } from "../../../../src/lib/session.ts";
import { allCategoryValues } from "../../../../src/lib/recipe-categories";

interface Env {
  SUPABASE_SERVICE_ROLE_KEY: string;
}

const MAX_INGREDIENTS = 60;
const MAX_DIRECTIONS = 40;
const MAX_FIELD = 400;
const MAX_STEP = 2000;

const RECIPE_FIELDS =
  "id, slug, title, fasting, category, hands_on, total_time, serves, preheat, intro, " +
  "ingredients, directions, notes, submitted_by_name, published, created_at, updated_at";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function cleanList(value: unknown, max: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, max)
    .map((v) => v.slice(0, maxLength));
}

function cleanField(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, MAX_FIELD) : "";
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

interface PagesContext {
  request: Request;
  env: Env;
  params: { id: string };
}

export async function onRequestPatch(context: PagesContext): Promise<Response> {
  const gate = await requireAdmin(context);
  if (gate.error) return gate.error;
  const { supabase, wrap } = gate;

  try {
    const id = (context.params.id ?? "").trim();
    if (!id) return wrap!(jsonResponse({ error: "Missing recipe id." }, 400));

    let body: Record<string, unknown>;
    try {
      body = await context.request.json();
    } catch {
      return wrap!(jsonResponse({ error: "Invalid JSON body." }, 400));
    }

    const updates: Record<string, unknown> = {};
    if (typeof body.published === "boolean") updates.published = body.published;
    if (typeof body.fasting === "boolean") updates.fasting = body.fasting;
    // Clearing it is allowed — an empty string means "no category yet",
    // which is where a recipe sits before anyone has filed it.
    if ("category" in body) {
      const value = String(body.category ?? "");
      if (value && !allCategoryValues().includes(value)) {
        return wrap!(jsonResponse({ error: `"${value}" isn't one of the categories.` }, 400));
      }
      updates.category = value || null;
    }

    if (typeof body.title === "string") {
      const title = cleanField(body.title);
      if (!title) return wrap!(jsonResponse({ error: "Title cannot be empty." }, 400));
      updates.title = title;
    }
    for (const field of ["hands_on", "total_time", "serves", "preheat"] as const) {
      if (field in body) updates[field] = cleanField(body[field]) || null;
    }
    for (const field of ["intro", "notes"] as const) {
      if (field in body) {
        updates[field] =
          typeof body[field] === "string" ? (body[field] as string).trim().slice(0, 1200) || null : null;
      }
    }
    if ("ingredients" in body) {
      const list = cleanList(body.ingredients, MAX_INGREDIENTS, MAX_FIELD);
      if (list.length === 0) {
        return wrap!(jsonResponse({ error: "A recipe needs at least one ingredient." }, 400));
      }
      updates.ingredients = list;
    }
    if ("directions" in body) {
      const list = cleanList(body.directions, MAX_DIRECTIONS, MAX_STEP);
      if (list.length === 0) {
        return wrap!(jsonResponse({ error: "A recipe needs at least one step." }, 400));
      }
      updates.directions = list;
    }

    if (Object.keys(updates).length === 0) {
      return wrap!(jsonResponse({ error: "No editable fields supplied." }, 400));
    }

    const { data, error } = await supabase!
      .from("recipes")
      .update(updates)
      .eq("id", id)
      .select(RECIPE_FIELDS)
      .single();
    if (error) return wrap!(jsonResponse({ error: error.message }, 500));
    if (!data) return wrap!(jsonResponse({ error: "Recipe not found." }, 404));

    return wrap!(jsonResponse({ recipe: data }, 200));
  } catch (err) {
    return wrap!(jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500));
  }
}

export async function onRequestDelete(context: PagesContext): Promise<Response> {
  const gate = await requireAdmin(context);
  if (gate.error) return gate.error;
  const { supabase, wrap } = gate;

  try {
    const id = (context.params.id ?? "").trim();
    if (!id) return wrap!(jsonResponse({ error: "Missing recipe id." }, 400));

    const { error } = await supabase!.from("recipes").delete().eq("id", id);
    if (error) return wrap!(jsonResponse({ error: error.message }, 500));
    return wrap!(jsonResponse({ ok: true }, 200));
  } catch (err) {
    return wrap!(jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500));
  }
}
