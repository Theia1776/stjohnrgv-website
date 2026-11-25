/**
 * Cloudflare Pages Function: GET /api/board/post-history?id=   (admins only)
 *
 * What a post said before it was edited, newest change first. Kept so
 * an angry post can't be quietly rewritten after someone has answered it.
 */

import {
  requireBoardAccess,
  canSeeCategory,
  jsonResponse,
  type BoardEnv,
} from "../../../src/lib/board-access.ts";
import { GONE, UUID, namesOf } from "../../../src/lib/board-messages.ts";

export async function onRequestGet(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;
  // Admins only. Appointed moderators don't see what a post said before.
  if (!viewer.isAdmin) return wrap(jsonResponse({ error: "Forbidden" }, 403));

  try {
    const id = new URL(context.request.url).searchParams.get("id") ?? "";
    if (!UUID.test(id)) return wrap(jsonResponse({ error: "Which post?" }, 400));

    const { data: post } = await supabase
      .from("board_posts")
      .select("id, body, board_threads ( board_categories ( hidden, audience ) )")
      .eq("id", id)
      .maybeSingle();
    const room = post
      ? ((post as Record<string, unknown>).board_threads as
          | { board_categories: { hidden: boolean; audience: string } | null }
          | null)?.board_categories
      : null;
    if (!post || (room && !canSeeCategory(viewer, room))) {
      return wrap(jsonResponse({ error: "That post is gone." }, 404));
    }

    const { data: edits } = await supabase
      .from("board_post_edits")
      .select("body, edited_by, replaced_at")
      .eq("post_id", id)
      .order("replaced_at", { ascending: false });
    const names = await namesOf(
      supabase,
      [...new Set((edits ?? []).map((e) => e.edited_by as string | null).filter(Boolean))] as string[],
    );

    return wrap(
      jsonResponse(
        {
          current: post.body,
          earlier: (edits ?? []).map((e) => ({
            body: e.body,
            by: e.edited_by ? (names.get(e.edited_by as string) ?? GONE) : GONE,
            replacedAt: e.replaced_at,
          })),
        },
        200,
      ),
    );
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error." }, 500),
    );
  }
}
