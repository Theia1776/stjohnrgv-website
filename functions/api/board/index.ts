/**
 * Cloudflare Pages Function: GET /api/board
 *
 * The board's front page: every category, in order, with how many
 * threads sit in it, when it last had a post, and how many of its
 * threads are new to the person asking.
 *
 * The counting is done here in JS rather than in SQL. A parish board
 * holds tens of threads, not millions, so pulling the thread list and
 * this person's read marks and working it out in memory costs nothing
 * and saves a view or a stored procedure that would have to be kept in
 * step with the rest of the board by hand.
 */

import {
  requireBoardAccess,
  jsonResponse,
  type BoardEnv,
} from "../../../src/lib/board-access.ts";

interface CategoryRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  position: number;
  hidden: boolean;
}

interface ThreadRow {
  id: string;
  category_id: string;
  last_post_at: string;
  post_count: number;
}

export async function onRequestGet(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;

  try {
    const { data: categories, error: catError } = await supabase
      .from("board_categories")
      .select("id, slug, name, description, position, hidden")
      .order("position", { ascending: true })
      .order("name", { ascending: true });
    if (catError) return wrap(jsonResponse({ error: catError.message }, 500));

    // A hidden category is off the board for everybody but an admin,
    // who sees it marked so it can be brought back.
    const visible = (categories ?? []).filter(
      (c: CategoryRow) => !c.hidden || viewer.isAdmin,
    );

    const { data: threads, error: threadError } = await supabase
      .from("board_threads")
      .select("id, category_id, last_post_at, post_count");
    if (threadError) return wrap(jsonResponse({ error: threadError.message }, 500));

    const { data: reads, error: readError } = await supabase
      .from("board_reads")
      .select("thread_id, last_read_at")
      .eq("user_id", viewer.id);
    if (readError) return wrap(jsonResponse({ error: readError.message }, 500));

    const readAt = new Map<string, number>();
    for (const r of reads ?? []) {
      readAt.set(r.thread_id as string, new Date(r.last_read_at as string).getTime());
    }

    // A thread is new to you if you've never opened it, or if somebody
    // posted in it since you last did.
    const isUnread = (t: ThreadRow) => {
      const seen = readAt.get(t.id);
      if (seen === undefined) return true;
      return new Date(t.last_post_at).getTime() > seen;
    };

    const byCategory = new Map<string, ThreadRow[]>();
    for (const t of (threads ?? []) as ThreadRow[]) {
      const list = byCategory.get(t.category_id);
      if (list) list.push(t);
      else byCategory.set(t.category_id, [t]);
    }

    let unreadTotal = 0;
    const payload = visible.map((c: CategoryRow) => {
      const list = byCategory.get(c.id) ?? [];
      const unread = list.filter(isUnread).length;
      unreadTotal += unread;
      const lastPostAt = list.reduce<string | null>(
        (latest, t) => (!latest || t.last_post_at > latest ? t.last_post_at : latest),
        null,
      );
      return {
        slug: c.slug,
        name: c.name,
        description: c.description,
        hidden: c.hidden,
        threadCount: list.length,
        postCount: list.reduce((sum, t) => sum + (t.post_count ?? 0), 0),
        unreadThreads: unread,
        lastPostAt,
      };
    });

    return wrap(
      jsonResponse(
        {
          categories: payload,
          unreadTotal,
          viewer: {
            displayName: viewer.displayName,
            isAdmin: viewer.isAdmin,
          },
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
