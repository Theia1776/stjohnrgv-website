/**
 * Cloudflare Pages Function: GET /api/board/profile?id=
 *
 * A member's board profile: name, what they are, when they joined, how
 * much they've written, and their latest posts in rooms the viewer can
 * see. Only what already shows beside their posts, plus the posts
 * themselves.
 */

import {
  requireBoardAccess,
  canSeeCategory,
  jsonResponse,
  shortName,
  type BoardEnv,
} from "../../../src/lib/board-access.ts";
import { UUID, privilegedIds } from "../../../src/lib/board-messages.ts";

type Room = { name: string; hidden: boolean; audience: string };

export async function onRequestGet(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;

  try {
    const id = new URL(context.request.url).searchParams.get("id") ?? "";
    if (!UUID.test(id)) return wrap(jsonResponse({ error: "Who?" }, 400));

    const { data: p } = await supabase
      .from("profiles")
      .select("id, first_name, last_name, role, avatar_url, created_at")
      .eq("id", id)
      .maybeSingle();
    if (!p || !["catechumen", "member", "admin"].includes(p.role as string)) {
      return wrap(jsonResponse({ error: "That person isn't on the board." }, 404));
    }

    const { data: mod } = await supabase
      .from("board_moderators")
      .select("user_id")
      .eq("user_id", id)
      .maybeSingle();
    const rank =
      p.role === "admin" ? "Parish Admin" : mod ? "Moderator" : p.role === "member" ? "Member" : "Catechumen";

    const { data: sig } = await supabase
      .from("board_signatures")
      .select("body")
      .eq("user_id", id)
      .maybeSingle();

    const { data: posts } = await supabase
      .from("board_posts")
      .select("id, body, created_at, thread_id, reported_hidden, board_threads ( id, title, board_categories ( name, hidden, audience ) )")
      .eq("author_id", id)
      .order("created_at", { ascending: false })
      .limit(120);

    type Row = {
      id: string; body: string; created_at: string; reported_hidden?: boolean;
      board_threads: { id: string; title: string; board_categories: Room | null } | null;
    };
    const visible = ((posts ?? []) as unknown as Row[]).filter(
      (r) => (!r.reported_hidden || viewer.isModerator) && r.board_threads && (!r.board_threads.board_categories || canSeeCategory(viewer, r.board_threads.board_categories)),
    );

    const { count } = await supabase
      .from("board_posts")
      .select("id", { count: "exact", head: true })
      .eq("author_id", id);

    // Moderators can suspend and lift from here.
    let suspended = false;
    let canSuspend = false;
    if (viewer.isModerator && id !== viewer.id) {
      canSuspend = !(await privilegedIds(supabase)).has(id);
      const { data: susp } = await supabase
        .from("board_suspensions")
        .select("until")
        .eq("user_id", id)
        .maybeSingle();
      suspended = !!susp && (!susp.until || new Date(susp.until as string).getTime() > Date.now());
    }

    return wrap(
      jsonResponse(
        {
          profile: {
            id,
            name: shortName(p.first_name as string | null, p.last_name as string | null),
            rank,
            joined: p.created_at,
            avatarUrl: (p.avatar_url as string | null) ?? null,
            posts: count ?? 0,
            signature: (sig?.body as string | undefined) ?? "",
            isMe: id === viewer.id,
            suspended,
            canSuspend,
          },
          recent: visible.slice(0, 25).map((r) => ({
            postId: r.id,
            threadId: r.board_threads!.id,
            title: r.board_threads!.title,
            room: r.board_threads!.board_categories?.name ?? "",
            snippet: r.body.slice(0, 200),
            at: r.created_at,
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
