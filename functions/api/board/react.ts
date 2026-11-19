/**
 * Cloudflare Pages Function: POST /api/board/react
 *
 * Body: { post, emoji }
 *
 * Toggles one reaction. Clicking a face you've already given takes it
 * back; a person may give several different faces to the same post but
 * never the same one twice (the primary key sees to that).
 *
 * The palette is fixed here rather than left open. An open emoji field
 * on a parish board invites exactly the kind of thing a parish board
 * shouldn't have to moderate, and six faces cover what people mean.
 */

import {
  requireBoardAccess,
  jsonResponse,
  type BoardEnv,
} from "../../../src/lib/board-access.ts";

/** What you can answer a post with. Keep it small and kind. */
export const REACTIONS = ["🙏", "☦️", "❤️", "👍", "😂", "🕯️"];

export async function onRequestPost(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;

  try {
    let body: { post?: unknown; emoji?: unknown };
    try {
      body = await context.request.json();
    } catch {
      return wrap(jsonResponse({ error: "Invalid JSON body." }, 400));
    }

    const postId = typeof body.post === "string" ? body.post.trim() : "";
    const emoji = typeof body.emoji === "string" ? body.emoji.trim() : "";
    if (!postId) return wrap(jsonResponse({ error: "Which post?" }, 400));
    if (!REACTIONS.includes(emoji)) {
      return wrap(jsonResponse({ error: "That isn't one of the reactions." }, 400));
    }

    // The post has to exist, and its thread has to be one this person
    // can see — a hidden category shouldn't be reachable this way.
    const { data: post } = await supabase
      .from("board_posts")
      .select("id, board_threads ( locked, board_categories ( hidden ) )")
      .eq("id", postId)
      .maybeSingle();
    if (!post) return wrap(jsonResponse({ error: "That post is gone." }, 404));

    const thread = (post as Record<string, unknown>).board_threads as
      | { locked: boolean; board_categories: { hidden: boolean } | null }
      | null;
    if (thread?.board_categories?.hidden && !viewer.isAdmin) {
      return wrap(jsonResponse({ error: "That post is gone." }, 404));
    }
    if (thread?.locked && !viewer.isAdmin) {
      return wrap(jsonResponse({ error: "This thread is closed." }, 403));
    }

    const { data: existing } = await supabase
      .from("board_reactions")
      .select("post_id")
      .eq("post_id", postId)
      .eq("user_id", viewer.id)
      .eq("emoji", emoji)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from("board_reactions")
        .delete()
        .eq("post_id", postId)
        .eq("user_id", viewer.id)
        .eq("emoji", emoji);
      if (error) return wrap(jsonResponse({ error: error.message }, 500));
      return wrap(jsonResponse({ reacted: false }, 200));
    }

    const { error } = await supabase
      .from("board_reactions")
      .insert({ post_id: postId, user_id: viewer.id, emoji });
    if (error) return wrap(jsonResponse({ error: error.message }, 500));

    return wrap(jsonResponse({ reacted: true }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error." }, 500),
    );
  }
}
