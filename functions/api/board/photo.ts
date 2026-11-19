/**
 * Cloudflare Pages Function: /api/board/photo
 *
 * GET    ?id=<uuid>&size=thumb|full   the picture itself
 * POST   multipart: full, thumb, width, height   add one; returns { id }
 * DELETE ?id=<uuid>                   remove one (yours, or any if admin)
 *
 * The files are served through here, not from a public address, so a
 * photo can only be seen by someone signed in to the board. They never
 * change once uploaded, so the browser is told to keep them.
 *
 * The browser shrinks every photo before sending it (see
 * src/lib/board-photo-picker.ts). This route doesn't trust that: it
 * refuses anything that isn't a JPEG or is bigger than the limits in
 * src/lib/board-photos.ts.
 */

import {
  requireBoardAccess,
  jsonResponse,
  type BoardEnv,
} from "../../../src/lib/board-access.ts";
import {
  MAX_FULL_BYTES,
  MAX_THUMB_BYTES,
  isPhotoId,
  looksLikeJpeg,
  photoKey,
  purgePhotos,
} from "../../../src/lib/board-photos.ts";

/** Photos picked but not yet posted, per person, at any moment. */
const MAX_PENDING = 12;
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

export async function onRequestGet(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;

  try {
    const url = new URL(context.request.url);
    const id = url.searchParams.get("id") ?? "";
    const size = url.searchParams.get("size") === "full" ? "full" : "thumb";
    if (!isPhotoId(id)) return wrap(jsonResponse({ error: "Which photo?" }, 400));

    const bucket = context.env.LIBRARY_BUCKET;
    if (!bucket) return wrap(jsonResponse({ error: "Photo storage isn't connected." }, 503));

    const { data: photo } = await supabase
      .from("board_photos")
      .select("id, post_id, uploader_id")
      .eq("id", id)
      .maybeSingle();
    if (!photo) return wrap(jsonResponse({ error: "That photo is gone." }, 404));

    // Not on a post yet: only the person adding it (or an admin) sees it.
    if (!photo.post_id && photo.uploader_id !== viewer.id && !viewer.isAdmin) {
      return wrap(jsonResponse({ error: "That photo is gone." }, 404));
    }

    const object = await bucket.get(photoKey(id, size));
    if (!object?.body) return wrap(jsonResponse({ error: "That photo is gone." }, 404));

    return wrap(
      new Response(object.body, {
        status: 200,
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "private, max-age=31536000, immutable",
        },
      }),
    );
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error." }, 500),
    );
  }
}

export async function onRequestPost(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;

  try {
    const bucket = context.env.LIBRARY_BUCKET;
    if (!bucket) return wrap(jsonResponse({ error: "Photo storage isn't connected." }, 503));

    let form: FormData;
    try {
      form = await context.request.formData();
    } catch {
      return wrap(jsonResponse({ error: "That upload didn't arrive intact." }, 400));
    }

    const full = form.get("full");
    const thumb = form.get("thumb");
    if (!(full instanceof File) || !(thumb instanceof File)) {
      return wrap(jsonResponse({ error: "No photo came through." }, 400));
    }

    const fullBytes = await full.arrayBuffer();
    const thumbBytes = await thumb.arrayBuffer();
    if (!looksLikeJpeg(fullBytes) || !looksLikeJpeg(thumbBytes)) {
      return wrap(jsonResponse({ error: "That doesn't look like a photo." }, 400));
    }
    if (fullBytes.byteLength > MAX_FULL_BYTES || thumbBytes.byteLength > MAX_THUMB_BYTES) {
      return wrap(jsonResponse({ error: "That photo is too big even after shrinking." }, 413));
    }

    const width = Math.round(Number(form.get("width")));
    const height = Math.round(Number(form.get("height")));
    if (!(width >= 1 && width <= 4000 && height >= 1 && height <= 4000)) {
      return wrap(jsonResponse({ error: "That photo's size wasn't readable." }, 400));
    }

    // Sweep up photos somebody picked and then never posted.
    const cutoff = new Date(Date.now() - PENDING_TTL_MS).toISOString();
    const { data: stale } = await supabase
      .from("board_photos")
      .select("id")
      .is("post_id", null)
      .lt("created_at", cutoff)
      .limit(100);
    if (stale?.length) {
      await purgePhotos(supabase, bucket, { photoIds: stale.map((r) => r.id as string) });
    }

    const { count } = await supabase
      .from("board_photos")
      .select("id", { count: "exact", head: true })
      .eq("uploader_id", viewer.id)
      .is("post_id", null);
    if ((count ?? 0) >= MAX_PENDING) {
      return wrap(
        jsonResponse(
          { error: "You've got several photos waiting already. Post or remove those first." },
          429,
        ),
      );
    }

    const { data: row, error: insertError } = await supabase
      .from("board_photos")
      .insert({
        uploader_id: viewer.id,
        width,
        height,
        bytes: fullBytes.byteLength + thumbBytes.byteLength,
      })
      .select("id")
      .single();
    if (insertError) return wrap(jsonResponse({ error: insertError.message }, 500));

    const id = row.id as string;
    try {
      await bucket.put(photoKey(id, "full"), fullBytes, {
        httpMetadata: { contentType: "image/jpeg" },
      });
      await bucket.put(photoKey(id, "thumb"), thumbBytes, {
        httpMetadata: { contentType: "image/jpeg" },
      });
    } catch (putError) {
      // Don't leave a row pointing at nothing.
      await purgePhotos(supabase, bucket, { photoIds: [id] });
      throw putError;
    }

    return wrap(jsonResponse({ id }, 201));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error." }, 500),
    );
  }
}

export async function onRequestDelete(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;

  try {
    const id = new URL(context.request.url).searchParams.get("id") ?? "";
    if (!isPhotoId(id)) return wrap(jsonResponse({ error: "Which photo?" }, 400));

    const { data: photo } = await supabase
      .from("board_photos")
      .select("id, uploader_id, board_posts ( author_id )")
      .eq("id", id)
      .maybeSingle();
    if (!photo) return wrap(jsonResponse({ ok: true }, 200));

    // Whoever added it, whoever wrote the post it's on, or an admin.
    const post = (photo as Record<string, unknown>).board_posts as
      | { author_id: string | null }
      | null;
    const allowed =
      viewer.isAdmin || photo.uploader_id === viewer.id || post?.author_id === viewer.id;
    if (!allowed) return wrap(jsonResponse({ error: "That isn't your photo." }, 403));

    await purgePhotos(supabase, context.env.LIBRARY_BUCKET, { photoIds: [id] });
    return wrap(jsonResponse({ ok: true }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error." }, 500),
    );
  }
}
