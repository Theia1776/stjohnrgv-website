/**
 * Cloudflare Pages Function: POST /api/board/post-restore   (moderators and admins)
 *
 * { postId }   a moderator has looked at a reported post and lifts the
 *              report: it comes back on the board for everyone, and the
 *              reports on it are cleared so it can be reported again.
 */

import {
  requireBoardAccess,
  canSeeCategory,
  jsonResponse,
  type BoardEnv,
} from "../../../src/lib/board-access.ts";

export async function onRequestPost(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;
  if (!viewer.isModerator) return wrap(jsonResponse({ error: "Forbidden" }, 403));

  try {
    const body = (await context.request.json().catch(() => ({}))) as { postId?: unknown };
    const postId = typeof body.postId === "string" ? body.postId : "";
    if (!postId) return wrap(jsonResponse({ error: "Which post?" }, 400));

    const { data: post } = await supabase
      .from("board_posts")
      .select("id, board_threads ( board_categories ( hidden, audience ) )")
      .eq("id", postId)
      .maybeSingle();
    const room = post
      ? ((post as Record<string, unknown>).board_threads as
          | { board_categories: { hidden: boolean; audience: string } | null }
          | null)?.board_categories
      : null;
    if (!post || (room && !canSeeCategory(viewer, room))) {
      return wrap(jsonResponse({ error: "That post is gone." }, 404));
    }

    const { error } = await supabase.from("board_posts").update({ reported_hidden: false }).eq("id", postId);
    if (error) return wrap(jsonResponse({ error: error.message }, 500));
    await supabase.from("board_post_reports").delete().eq("post_id", postId);
    return wrap(jsonResponse({ ok: true }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error." }, 500),
    );
  }
}
