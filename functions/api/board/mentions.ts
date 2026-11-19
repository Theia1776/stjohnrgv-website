/**
 * Cloudflare Pages Function: /api/board/mentions
 *
 * GET    the posts that tag you, newest first, with which are new
 * POST   mark them all as seen
 */

import {
  requireBoardAccess,
  canSeeCategory,
  jsonResponse,
  type BoardEnv,
} from "../../../src/lib/board-access.ts";
import { GONE, namesOf } from "../../../src/lib/board-messages.ts";

export async function onRequestGet(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;

  try {
    const { data, error } = await supabase
      .from("board_mentions")
      .select(
        "post_id, by_id, created_at, seen_at, board_posts ( id, body, reported_hidden, thread_id, board_threads ( id, title, board_categories ( name, slug, hidden, audience ) ) )",
      )
      .eq("user_id", viewer.id)
      .order("created_at", { ascending: false })
      .limit(60);
    if (error) return wrap(jsonResponse({ error: error.message }, 500));

    type Joined = {
      post_id: string;
      by_id: string | null;
      created_at: string;
      seen_at: string | null;
      board_posts: {
        reported_hidden?: boolean;
        body: string;
        board_threads: {
          id: string;
          title: string;
          board_categories: { name: string; slug: string; hidden: boolean; audience: string } | null;
        } | null;
      } | null;
    };
    const rows = ((data ?? []) as unknown as Joined[]).filter((r) => {
      const t = r.board_posts?.board_threads;
      if (r.board_posts?.reported_hidden && !viewer.isModerator) return false;
      return !!t && (!t.board_categories || canSeeCategory(viewer, t.board_categories));
    });
    const names = await namesOf(
      supabase,
      [...new Set(rows.map((r) => r.by_id).filter(Boolean))] as string[],
    );

    return wrap(
      jsonResponse(
        {
          mentions: rows.map((r) => ({
            postId: r.post_id,
            threadId: r.board_posts!.board_threads!.id,
            title: r.board_posts!.board_threads!.title,
            room: r.board_posts!.board_threads!.board_categories?.name ?? "",
            by: r.by_id ? (names.get(r.by_id) ?? GONE) : GONE,
            snippet: r.board_posts!.body.slice(0, 200),
            at: r.created_at,
            fresh: !r.seen_at,
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

export async function onRequestPost(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;

  try {
    const { error } = await supabase
      .from("board_mentions")
      .update({ seen_at: new Date().toISOString() })
      .eq("user_id", viewer.id)
      .is("seen_at", null);
    if (error) return wrap(jsonResponse({ error: error.message }, 500));
    return wrap(jsonResponse({ ok: true }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error." }, 500),
    );
  }
}
