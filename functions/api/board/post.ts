/**
 * Cloudflare Pages Function: /api/board/post
 *
 * PATCH  { id, body }   edit a post  (yours, or anyone's if admin)
 * DELETE ?id=<uuid>     remove a post (same rule)
 *
 * The opening post of a thread can't be deleted on its own — it's the
 * thing everybody else is replying to. Removing it means removing the
 * thread, which is /api/board/thread's job.
 */

import {
  requireBoardAccess,
  canSeeCategory,
  jsonResponse,
  type BoardEnv,
  suspensionBlock,
} from "../../../src/lib/board-access.ts";
import { logAction } from "../../../src/lib/board-modlog.ts";
import { recordMentions } from "../../../src/lib/board-mentions.ts";
import { attachPhotos, purgePhotos } from "../../../src/lib/board-photos.ts";

const MAX_BODY = 10000;

/** The post, its thread, and whether it's the one that started it. */
async function loadPost(
  supabase: NonNullable<Awaited<ReturnType<typeof requireBoardAccess>>["supabase"]>,
  id: string,
) {
  const { data: post, error } = await supabase
    .from("board_posts")
    .select(
      "id, thread_id, author_id, created_at, " +
        "board_threads ( locked, board_categories ( hidden, audience ) )",
    )
    .eq("id", id)
    .maybeSingle();
  if (error || !post) return { post: null, isOpener: false, locked: false, category: null };

  const { data: first } = await supabase
    .from("board_posts")
    .select("id")
    .eq("thread_id", post.thread_id as string)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const thread = (post as Record<string, unknown>).board_threads as
    | { locked: boolean; board_categories: { hidden: boolean; audience: string } | null }
    | null;
  return {
    post,
    isOpener: first?.id === post.id,
    locked: !!thread?.locked,
    category: thread?.board_categories ?? null,
  };
}

export async function onRequestPatch(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;
  const blocked = suspensionBlock(viewer, wrap);
  if (blocked) return blocked;

  try {
    let body: { id?: unknown; body?: unknown; photoIds?: unknown };
    try {
      body = await context.request.json();
    } catch {
      return wrap(jsonResponse({ error: "Invalid JSON body." }, 400));
    }

    const id = typeof body.id === "string" ? body.id.trim() : "";
    const text = typeof body.body === "string" ? body.body.trim() : "";
    if (!id) return wrap(jsonResponse({ error: "Which post?" }, 400));
    if (!text) return wrap(jsonResponse({ error: "A post can't be left empty." }, 400));
    if (text.length > MAX_BODY) {
      return wrap(jsonResponse({ error: `Posts top out at ${MAX_BODY} characters.` }, 400));
    }

    const { post, locked, category } = await loadPost(supabase, id);
    if (!post || (category && !canSeeCategory(viewer, category))) {
      return wrap(jsonResponse({ error: "That post is gone." }, 404));
    }
    if (post.author_id !== viewer.id && !viewer.isModerator) {
      return wrap(jsonResponse({ error: "That isn't your post." }, 403));
    }
    if (locked && !viewer.isModerator) {
      return wrap(jsonResponse({ error: "This thread is closed." }, 403));
    }

    // Keep what it said before, for the moderators' edit history.
    const { data: before } = await supabase
      .from("board_posts")
      .select("body, reported_hidden")
      .eq("id", id)
      .maybeSingle();
    if (before?.reported_hidden && !viewer.isModerator) {
      return wrap(jsonResponse({ error: "This post is under review, so it can't be edited right now." }, 403));
    }
    if (before && before.body !== text) {
      await supabase
        .from("board_post_edits")
        .insert({ post_id: id, body: before.body, edited_by: viewer.id });
    }

    const { error: updateError } = await supabase
      .from("board_posts")
      .update({ body: text, edited_at: new Date().toISOString() })
      .eq("id", id);
    if (updateError) return wrap(jsonResponse({ error: updateError.message }, 500));

    // Photos added while editing. Only the post's own author can hang
    // their own pictures on it; an admin editing words adds none.
    await attachPhotos(supabase, viewer.id, id, body.photoIds);
    await recordMentions(supabase, id, (post.author_id as string | null) ?? viewer.id, text);

    return wrap(jsonResponse({ ok: true }, 200));
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
    const id = new URL(context.request.url).searchParams.get("id")?.trim() ?? "";
    if (!id) return wrap(jsonResponse({ error: "Which post?" }, 400));

    const { post, isOpener, locked, category } = await loadPost(supabase, id);
    if (post && category && !canSeeCategory(viewer, category)) {
      return wrap(jsonResponse({ error: "That post is gone." }, 404));
    }
    if (!post) return wrap(jsonResponse({ ok: true }, 200));
    if (post.author_id !== viewer.id && !viewer.isModerator) {
      return wrap(jsonResponse({ error: "That isn't your post." }, 403));
    }
    if (locked && !viewer.isModerator) {
      return wrap(jsonResponse({ error: "This thread is closed." }, 403));
    }
    if (isOpener) {
      return wrap(
        jsonResponse(
          {
            error:
              "That's the post the thread is built on. Delete the whole thread " +
              "instead, or edit this post if you'd rather reword it.",
          },
          400,
        ),
      );
    }

    await purgePhotos(supabase, context.env.LIBRARY_BUCKET, { postIds: [id] });

    const { error: deleteError } = await supabase.from("board_posts").delete().eq("id", id);
    if (deleteError) return wrap(jsonResponse({ error: deleteError.message }, 500));
    if (post.author_id !== viewer.id) {
      await logAction(supabase, viewer.id, "Deleted someone's post", `post ${id}`, post.author_id as string | null);
    }

    return wrap(jsonResponse({ ok: true }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error." }, 500),
    );
  }
}
