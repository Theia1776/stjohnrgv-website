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

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const user = await verifySession(context.request);
  if (!user) return new Response("Unauthorized", { status: 401 });

  const supabase = getSupabase(context.env);
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", user.id)
    .single();

  if (error) return new Response(error.message, { status: 404 });
  return Response.json(data);
}

export async function onRequestPatch(context: { request: Request; env: Env }): Promise<Response> {
  const user = await verifySession(context.request);
  if (!user) return new Response("Unauthorized", { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await context.request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
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

  const supabase = getSupabase(context.env);
  const { error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", user.id);

  if (error) return new Response(error.message, { status: 500 });
  return new Response(null, { status: 204 });
}
