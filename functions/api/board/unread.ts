/**
 * Cloudflare Pages Function: GET /api/board/unread
 *
 * Every topic with something new in it for this person, from every
 * room they can see, newest activity first. It's the page for "what
 * did I miss", so nobody has to open each room to find out.
 *
 * "New" is the same rule the rest of the board uses: you've never
 * opened it, or somebody posted in it since you last did.
 */

import {
  requireBoardAccess,
  canSeeCategory,
  jsonResponse,
  shortName,
  type BoardEnv,
} from "../../../src/lib/board-access.ts";

const GONE = "A former parishioner";

export async function onRequestGet(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;

  try {
    const { data: categories, error: catError } = await supabase
      .from("board_categories")
      .select("id, slug, name, hidden, audience");
    if (catError) return wrap(jsonResponse({ error: catError.message }, 500));
    const rooms = new Map(
      (categories ?? [])
        .filter((c) => canSeeCategory(viewer, c))
        .map((c) => [c.id as string, c as { id: string; slug: string; name: string }]),
    );

    const { data: threads, error: threadError } = await supabase
      .from("board_threads")
      .select("id, category_id, title, author_id, pinned, locked, created_at, last_post_at, post_count");
    if (threadError) return wrap(jsonResponse({ error: threadError.message }, 500));

    const { data: reads } = await supabase
      .from("board_reads")
      .select("thread_id, last_read_at")
      .eq("user_id", viewer.id);
    const readAt = new Map<string, number>();
    for (const r of reads ?? []) {
      readAt.set(r.thread_id as string, new Date(r.last_read_at as string).getTime());
    }

    const fresh = (threads ?? [])
      .filter((t) => rooms.has(t.category_id as string))
      .filter((t) => {
        const seen = readAt.get(t.id as string);
        return seen === undefined || new Date(t.last_post_at as string).getTime() > seen;
      })
      .sort((a, b) => ((a.last_post_at as string) < (b.last_post_at as string) ? 1 : -1));

    // Who started each, and who wrote the newest post.
    const ids = fresh.map((t) => t.id as string);
    const lastAuthor = new Map<string, string | null>();
    if (ids.length) {
      const { data: posts } = await supabase
        .from("board_posts")
        .select("thread_id, author_id, created_at")
        .in("thread_id", ids)
        .order("created_at", { ascending: true });
      for (const p of posts ?? []) {
        lastAuthor.set(p.thread_id as string, (p.author_id as string | null) ?? null);
      }
    }

    const people = [
      ...new Set(
        [...fresh.map((t) => t.author_id as string | null), ...lastAuthor.values()].filter(Boolean),
      ),
    ] as string[];
    const names = new Map<string, string>();
    if (people.length) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, first_name, last_name")
        .in("id", people);
      for (const p of profiles ?? []) {
        names.set(
          p.id as string,
          shortName(p.first_name as string | null, p.last_name as string | null),
        );
      }
    }
    const nameOf = (id: string | null | undefined) => (id ? (names.get(id) ?? GONE) : GONE);

    return wrap(
      jsonResponse(
        {
          threads: fresh.map((t) => {
            const room = rooms.get(t.category_id as string)!;
            return {
              id: t.id,
              title: t.title,
              room: { slug: room.slug, name: room.name },
              startedBy: nameOf(t.author_id as string | null),
              lastPostBy: nameOf(lastAuthor.get(t.id as string)),
              lastPostAt: t.last_post_at,
              replyCount: Math.max(0, ((t.post_count as number) ?? 0) - 1),
              pinned: t.pinned,
              locked: t.locked,
            };
          }),
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
