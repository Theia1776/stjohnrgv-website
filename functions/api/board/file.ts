/**
 * Cloudflare Pages Function: /api/board/file
 *
 * GET    ?id=<uuid>        the file itself (a download; PDFs and pictures open in the tab)
 * GET    ?limits=1         { maxBytes, isAdmin, used } for the "Attach a file" box
 * POST   multipart: file, keep ("forever" | "30")   add one; returns { id, name, bytes, expires }
 * DELETE ?id=<uuid>        remove one (yours, the post's author, or a moderator)
 *
 * Files are served through here, not from a public address, so only
 * somebody signed in to the board who can see the room can get them.
 * Everything is sent as a download with nosniff, so nothing a member
 * uploads can run in the browser.
 */

import {
  requireBoardAccess,
  canSeeCategory,
  jsonResponse,
  suspensionBlock,
  type BoardEnv,
} from "../../../src/lib/board-access.ts";
import {
  ADMIN_MAX_BYTES,
  EXPIRY_DAYS,
  MEMBER_MAX_BYTES,
  cleanName,
  fileKey,
  isBlockedName,
  isFileId,
  purgeExpiredFiles,
  purgeFiles,
  sizeLabel,
} from "../../../src/lib/board-files.ts";

/** Files picked but not yet posted, per person, at any moment. */
const MAX_PENDING = 10;
const INLINE = /^(application\/pdf|image\/(png|jpeg|gif|webp))$/;

export async function onRequestGet(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;

  try {
    const url = new URL(context.request.url);

    if (url.searchParams.get("limits")) {
      let used: { files: number; bytes: number } | null = null;
      if (viewer.isAdmin) {
        const { data } = await supabase.from("board_files").select("bytes");
        used = {
          files: data?.length ?? 0,
          bytes: (data ?? []).reduce((n, r) => n + Number(r.bytes ?? 0), 0),
        };
      }
      return wrap(
        jsonResponse(
          {
            maxBytes: viewer.isAdmin ? ADMIN_MAX_BYTES : MEMBER_MAX_BYTES,
            maxLabel: sizeLabel(viewer.isAdmin ? ADMIN_MAX_BYTES : MEMBER_MAX_BYTES),
            isAdmin: viewer.isAdmin,
            used,
          },
          200,
        ),
      );
    }

    const id = url.searchParams.get("id") ?? "";
    if (!isFileId(id)) return wrap(jsonResponse({ error: "Which file?" }, 400));

    const bucket = context.env.LIBRARY_BUCKET;
    if (!bucket) return wrap(jsonResponse({ error: "File storage isn't connected." }, 503));

    const { data: file } = await supabase
      .from("board_files")
      .select(
        "id, post_id, uploader_id, name, content_type, expires_at, " +
          "board_posts ( reported_hidden, board_threads ( board_categories ( hidden, audience ) ) )",
      )
      .eq("id", id)
      .maybeSingle();
    const gone = () => wrap(jsonResponse({ error: "That file is gone." }, 404));
    if (!file) return gone();

    if (file.expires_at && new Date(file.expires_at as string).getTime() < Date.now()) {
      await purgeFiles(supabase, bucket, { fileIds: [id] });
      return gone();
    }

    const room = (
      (file as Record<string, unknown>).board_posts as
        | { board_threads: { board_categories: { hidden: boolean; audience: string } | null } | null }
        | null
    )?.board_threads?.board_categories;
    if (room && !canSeeCategory(viewer, room)) return gone();

    const reported = ((file as Record<string, unknown>).board_posts as { reported_hidden?: boolean } | null)
      ?.reported_hidden;
    if (reported && !viewer.isModerator) return gone();

    if (!file.post_id && file.uploader_id !== viewer.id && !viewer.isAdmin) return gone();

    const object = await bucket.get(fileKey(id));
    if (!object?.body) return gone();

    const type = String(file.content_type ?? "");
    const inline = INLINE.test(type);
    const name = String(file.name);
    return wrap(
      new Response(object.body, {
        status: 200,
        headers: {
          "Content-Type": inline ? type : "application/octet-stream",
          "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; sandbox",
          "Cache-Control": "private, max-age=3600",
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
  const blocked = suspensionBlock(viewer, wrap);
  if (blocked) return blocked;

  try {
    const bucket = context.env.LIBRARY_BUCKET;
    if (!bucket) return wrap(jsonResponse({ error: "File storage isn't connected." }, 503));

    let form: FormData;
    try {
      form = await context.request.formData();
    } catch {
      return wrap(jsonResponse({ error: "That upload didn't arrive intact." }, 400));
    }

    const file = form.get("file");
    if (!(file instanceof File)) return wrap(jsonResponse({ error: "No file came through." }, 400));

    const name = cleanName(file.name);
    if (isBlockedName(name)) {
      return wrap(
        jsonResponse({ error: "That kind of file can't be attached. PDFs, Word and Excel files, pictures and text files are fine." }, 400),
      );
    }

    const limit = viewer.isAdmin ? ADMIN_MAX_BYTES : MEMBER_MAX_BYTES;
    if (file.size > limit) {
      return wrap(
        jsonResponse(
          {
            error: viewer.isAdmin
              ? `That file is ${sizeLabel(file.size)}. The most one file can be is ${sizeLabel(limit)}.`
              : `That file is ${sizeLabel(file.size)}. Files from members can be up to ${sizeLabel(limit)}. An admin can attach bigger ones.`,
          },
          413,
        ),
      );
    }
    if (file.size === 0) return wrap(jsonResponse({ error: "That file is empty." }, 400));

    await purgeExpiredFiles(supabase, bucket);

    const { count } = await supabase
      .from("board_files")
      .select("id", { count: "exact", head: true })
      .eq("uploader_id", viewer.id)
      .is("post_id", null);
    if ((count ?? 0) >= MAX_PENDING) {
      return wrap(jsonResponse({ error: "You have several files waiting already. Post or remove those first." }, 429));
    }

    const keepDays = String(form.get("keep") ?? "") === "30" ? EXPIRY_DAYS : null;
    const bytes = await file.arrayBuffer();

    const { data: row, error: insertError } = await supabase
      .from("board_files")
      .insert({
        uploader_id: viewer.id,
        name,
        content_type: (file.type || "").slice(0, 120) || null,
        bytes: bytes.byteLength,
        keep_days: keepDays,
      })
      .select("id")
      .single();
    if (insertError) return wrap(jsonResponse({ error: insertError.message }, 500));

    const id = row.id as string;
    try {
      await bucket.put(fileKey(id), bytes, { httpMetadata: { contentType: file.type || "application/octet-stream" } });
    } catch (putError) {
      await purgeFiles(supabase, bucket, { fileIds: [id] });
      throw putError;
    }

    return wrap(jsonResponse({ id, name, bytes: bytes.byteLength, expires: keepDays !== null }, 201));
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
    if (!isFileId(id)) return wrap(jsonResponse({ error: "Which file?" }, 400));

    const { data: file } = await supabase
      .from("board_files")
      .select("id, uploader_id, board_posts ( author_id )")
      .eq("id", id)
      .maybeSingle();
    if (!file) return wrap(jsonResponse({ ok: true }, 200));

    const post = (file as Record<string, unknown>).board_posts as { author_id: string | null } | null;
    const allowed = viewer.isModerator || file.uploader_id === viewer.id || post?.author_id === viewer.id;
    if (!allowed) return wrap(jsonResponse({ error: "That isn't your file." }, 403));

    await purgeFiles(supabase, context.env.LIBRARY_BUCKET, { fileIds: [id] });
    return wrap(jsonResponse({ ok: true }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error." }, 500),
    );
  }
}
