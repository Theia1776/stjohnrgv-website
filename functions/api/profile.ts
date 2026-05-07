import { verifySession, withSessionCookies } from "../../src/lib/session.ts";
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
  const session = await verifySession(context.request);
  const wrap = (resp: Response) => withSessionCookies(resp, session.refreshedCookies);

  try {
    if (!session.user) return wrap(jsonResponse({ error: "Unauthorized" }, 401));

    const supabase = getSupabase(context.env);
    const { data, error } = await supabase
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .eq("id", session.user.id)
      .single();

    if (error) return wrap(jsonResponse({ error: error.message }, 404));
    return wrap(Response.json(data));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500),
    );
  }
}

export async function onRequestPatch(context: { request: Request; env: Env }): Promise<Response> {
  const session = await verifySession(context.request);
  const wrap = (resp: Response) => withSessionCookies(resp, session.refreshedCookies);

  try {
    if (!session.user) return wrap(jsonResponse({ error: "Unauthorized" }, 401));

    let body: Record<string, unknown>;
    try {
      body = await context.request.json();
    } catch {
      return wrap(jsonResponse({ error: "Invalid JSON" }, 400));
    }

    const updates: Partial<Record<typeof PATCH_ALLOWED[number], unknown>> = {};
    for (const key of PATCH_ALLOWED) {
      if (key in body) updates[key] = body[key];
    }

    const supabase = getSupabase(context.env);
    const { error } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", session.user.id);

    if (error) return wrap(jsonResponse({ error: error.message }, 500));
    return wrap(new Response(null, { status: 204 }));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500),
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
  const session = await verifySession(context.request);
  const wrap = (resp: Response) => withSessionCookies(resp, session.refreshedCookies);

  try {
    if (!session.user) return wrap(jsonResponse({ error: "Unauthorized" }, 401));
    const user = session.user;

    let formData: FormData;
    try {
      formData = await context.request.formData();
    } catch {
      return wrap(jsonResponse({ error: "Expected multipart/form-data" }, 400));
    }

    const file = formData.get("avatar");
    if (!(file instanceof File)) {
      return wrap(jsonResponse({ error: "No file provided" }, 400));
    }

    const ext = AVATAR_TYPES[file.type];
    if (!ext) {
      return wrap(jsonResponse({ error: "Only JPEG, PNG, or WEBP images are allowed" }, 400));
    }
    if (file.size > AVATAR_MAX_BYTES) {
      return wrap(jsonResponse({ error: "Image must be under 2 MB" }, 400));
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

    if (uploadError) return wrap(jsonResponse({ error: uploadError.message }, 500));

    const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
    // Cache-bust: append a timestamp so the browser doesn't keep showing
    // the previous photo at the same URL after re-upload.
    const avatar_url = `${urlData.publicUrl}?v=${Date.now()}`;

    // Pull the existing row's NOT NULL columns so the upsert path can
    // INSERT cleanly if the row is somehow missing.
    const { data: existing, error: existingError } = await supabase
      .from("profiles")
      .select("email, full_name")
      .eq("id", user.id)
      .maybeSingle();

    if (existingError) {
      return wrap(jsonResponse(
        { error: `Failed to read existing profile: ${existingError.message}` },
        500,
      ));
    }

    const upsertPayload: Record<string, unknown> = { id: user.id, avatar_url };
    if (existing?.email) upsertPayload.email = existing.email;
    if (existing?.full_name) upsertPayload.full_name = existing.full_name;

    const { error: upsertError } = await supabase
      .from("profiles")
      .upsert(upsertPayload, { onConflict: "id" });

    if (upsertError) {
      return wrap(jsonResponse({ error: `Upsert failed: ${upsertError.message}` }, 500));
    }

    // Read back to confirm the URL persisted before claiming success.
    const { data: verified, error: verifyError } = await supabase
      .from("profiles")
      .select("avatar_url")
      .eq("id", user.id)
      .single();

    if (verifyError) {
      return wrap(jsonResponse({ error: `Verify read failed: ${verifyError.message}` }, 500));
    }
    if (verified?.avatar_url !== avatar_url) {
      return wrap(jsonResponse(
        {
          error: "Avatar URL did not persist",
          sent: avatar_url,
          readback: verified?.avatar_url ?? null,
        },
        500,
      ));
    }

    return wrap(jsonResponse({ avatar_url: verified.avatar_url }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500),
    );
  }
}
