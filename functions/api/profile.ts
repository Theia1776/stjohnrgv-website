import { verifySession } from "../../src/lib/session.ts";
import { SUPABASE_URL } from "../../src/lib/supabase";
import { createClient } from "@supabase/supabase-js";

interface Env {
  SUPABASE_SERVICE_ROLE_KEY: string;
}

function getSupabase(env: Env) {
  return createClient(SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
}

const PROFILE_COLUMNS =
  "first_name, last_name, email, phone, avatar_url, " +
  "address_line1, address_line2, city, state, zip, " +
  "emergency_name, emergency_relationship, emergency_phone, " +
  "emergency_name_2, emergency_relationship_2, emergency_phone_2, " +
  "opt_in_communications, " +
  "opt_in_directory, directory_show_phone, directory_show_email, directory_show_address";

const PATCH_ALLOWED = [
  "first_name", "last_name", "phone", "avatar_url",
  "address_line1", "address_line2", "city", "state", "zip",
  "emergency_name", "emergency_relationship", "emergency_phone",
  "emergency_name_2", "emergency_relationship_2", "emergency_phone_2",
  "opt_in_communications",
  "opt_in_directory", "directory_show_phone", "directory_show_email", "directory_show_address",
] as const;

const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  try {
    const user = await verifySession(context.request);
    if (!user) return jsonResponse({ error: "Unauthorized" }, 401);

    const supabase = getSupabase(context.env);
    const { data, error } = await supabase
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .eq("id", user.id)
      .single();

    if (error) return jsonResponse({ error: error.message }, 404);
    return Response.json(data);
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Internal error" },
      500,
    );
  }
}

export async function onRequestPatch(context: { request: Request; env: Env }): Promise<Response> {
  try {
    const user = await verifySession(context.request);
    if (!user) return jsonResponse({ error: "Unauthorized" }, 401);

    let body: Record<string, unknown>;
    try {
      body = await context.request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400);
    }

    const updates: Partial<Record<typeof PATCH_ALLOWED[number], unknown>> = {};
    for (const key of PATCH_ALLOWED) {
      if (key in body) updates[key] = body[key];
    }

    const supabase = getSupabase(context.env);
    const { error } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", user.id);

    if (error) return jsonResponse({ error: error.message }, 500);
    return new Response(null, { status: 204 });
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Internal error" },
      500,
    );
  }
}

/**
 * Avatar upload. Body is multipart/form-data with one file field
 * named "avatar". Stored at avatars/{user_id}/avatar.{ext} in the
 * public `avatars` bucket; the resulting public URL is written back
 * to profiles.avatar_url so subsequent loads pick it up.
 */
export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  try {
    const user = await verifySession(context.request);
    if (!user) return jsonResponse({ error: "Unauthorized" }, 401);

    let formData: FormData;
    try {
      formData = await context.request.formData();
    } catch {
      return jsonResponse({ error: "Expected multipart/form-data" }, 400);
    }

    const file = formData.get("avatar");
    if (!(file instanceof File)) {
      return jsonResponse({ error: "No file provided" }, 400);
    }

    const ext = AVATAR_TYPES[file.type];
    if (!ext) {
      return jsonResponse({ error: "Only JPEG, PNG, or WEBP images are allowed" }, 400);
    }
    if (file.size > AVATAR_MAX_BYTES) {
      return jsonResponse({ error: "Image must be under 2 MB" }, 400);
    }

    const supabase = getSupabase(context.env);
    const path = `${user.id}/avatar.${ext}`;
    const buffer = await file.arrayBuffer();

    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(path, buffer, {
        contentType: file.type,
        upsert: true,
      });

    if (uploadError) return jsonResponse({ error: uploadError.message }, 500);

    const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
    // Cache-bust: append a timestamp so the browser doesn't keep showing
    // the previous photo at the same URL after re-upload.
    const avatar_url = `${urlData.publicUrl}?v=${Date.now()}`;

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ avatar_url })
      .eq("id", user.id);

    if (updateError) return jsonResponse({ error: updateError.message }, 500);

    return jsonResponse({ avatar_url }, 200);
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Internal error" },
      500,
    );
  }
}
