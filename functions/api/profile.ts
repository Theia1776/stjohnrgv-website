import { verifySession } from "../../src/lib/session.ts";
import { createClient } from "@supabase/supabase-js";

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

function getSupabase(env: Env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
}

const PROFILE_COLUMNS =
  "first_name, last_name, email, phone, avatar_url, " +
  "emergency_name, emergency_relationship, emergency_phone, " +
  "emergency_name_2, emergency_relationship_2, emergency_phone_2, " +
  "opt_in_communications";

function debugInfo(request: Request, env: Env, user: { id: string } | null) {
  const cookieHeader = request.headers.get("cookie") || "";
  const cookieNames = cookieHeader
    .split(";")
    .map((c) => c.trim().split("=")[0])
    .filter(Boolean);
  return {
    method: request.method,
    url: request.url,
    contentType: request.headers.get("content-type"),
    hasCookieHeader: Boolean(cookieHeader),
    cookieNames,
    hasSupabaseUrl: Boolean(env.SUPABASE_URL),
    hasServiceRoleKey: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
    sessionVerified: Boolean(user),
    userId: user?.id ?? null,
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const user = await verifySession(context.request);
  const debug = debugInfo(context.request, context.env, user);
  console.log("[profile GET]", JSON.stringify(debug));

  if (!user) return jsonResponse({ error: "Unauthorized", debug }, 401);

  const supabase = getSupabase(context.env);
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", user.id)
    .single();

  if (error) {
    console.log("[profile GET error]", JSON.stringify(error));
    return jsonResponse(
      {
        error: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        debug,
      },
      404,
    );
  }
  return Response.json(data);
}

export async function onRequestPatch(context: { request: Request; env: Env }): Promise<Response> {
  const user = await verifySession(context.request);
  const debug = debugInfo(context.request, context.env, user);
  console.log("[profile PATCH]", JSON.stringify(debug));

  if (!user) return jsonResponse({ error: "Unauthorized", debug }, 401);

  let body: Record<string, unknown>;
  try {
    body = await context.request.json();
  } catch (err) {
    return jsonResponse(
      { error: "Invalid JSON", parseError: err instanceof Error ? err.message : String(err), debug },
      400,
    );
  }

  const allowed = [
    "first_name", "last_name", "phone", "avatar_url",
    "emergency_name", "emergency_relationship", "emergency_phone",
    "emergency_name_2", "emergency_relationship_2", "emergency_phone_2",
    "opt_in_communications",
  ] as const;

  const updates: Partial<Record<typeof allowed[number], unknown>> = {};
  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }

  console.log("[profile PATCH updates]", JSON.stringify({ keys: Object.keys(updates) }));

  const supabase = getSupabase(context.env);
  const { error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", user.id);

  if (error) {
    console.log("[profile PATCH db error]", JSON.stringify(error));
    return jsonResponse(
      {
        error: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        attemptedKeys: Object.keys(updates),
        debug,
      },
      500,
    );
  }
  return new Response(null, { status: 204 });
}
