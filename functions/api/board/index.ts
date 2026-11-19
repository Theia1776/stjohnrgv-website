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
  canSeeCategory,
  jsonResponse,
  shortName,
  type BoardEnv,
} from "../../../src/lib/board-access.ts";
import { loadInbox } from "../../../src/lib/board-messages.ts";
import { celebrationsAhead, type Celebration } from "../../../src/lib/board-celebrations.ts";

interface CategoryRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  position: number;
  hidden: boolean;
  audience: string;
}

interface ThreadRow {
  id: string;
  category_id: string;
  last_post_at: string;
  post_count: number;
  title: string;
  announce?: boolean;
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
      .select("id, slug, name, description, position, hidden, audience")
      .order("position", { ascending: true })
      .order("name", { ascending: true });
    if (catError) return wrap(jsonResponse({ error: catError.message }, 500));

    // A hidden category is off the board for everybody but an admin,
    // who sees it marked so it can be brought back.
    const visible = (categories ?? []).filter((c: CategoryRow) => canSeeCategory(viewer, c));
    const visibleIds = new Set(visible.map((c: CategoryRow) => c.id));

    const { data: allThreads, error: threadError } = await supabase
      .from("board_threads")
      .select("id, category_id, last_post_at, post_count, title, announce");
    if (threadError) return wrap(jsonResponse({ error: threadError.message }, 500));
    // Counts and "unread" only ever cover rooms this person can see.
    const threads = (allThreads ?? []).filter((t) => visibleIds.has(t.category_id as string));

    // Who wrote the newest post in each category, for the Last Post
    // column. One pass over the posts, newest last, so the final write
    // per category wins.
    const { data: recent } = await supabase
      .from("board_posts")
      .select("thread_id, author_id, created_at")
      .order("created_at", { ascending: true });

    const categoryOfThread = new Map<string, string>();
    for (const t of (threads ?? []) as ThreadRow[]) {
      categoryOfThread.set(t.id, t.category_id);
    }
    const lastPostAuthorId = new Map<string, string | null>();
    let totalPosts = 0;
    for (const post of recent ?? []) {
      const categoryId = categoryOfThread.get(post.thread_id as string);
      if (!categoryId) continue; // a room this person can't see
      totalPosts += 1;
      lastPostAuthorId.set(categoryId, (post.author_id as string | null) ?? null);
    }

    const authorIds = [...new Set([...lastPostAuthorId.values()].filter(Boolean))] as string[];
    const authorNames = new Map<string, string>();
    if (authorIds.length) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, first_name, last_name")
        .in("id", authorIds);
      for (const p of profiles ?? []) {
        authorNames.set(
          p.id as string,
          shortName(p.first_name as string | null, p.last_name as string | null),
        );
      }
    }

    // "We have N members, the newest is X." Members here means people
    // who can actually use the board, so inquirers aren't counted —
    // saying otherwise would overstate the room.
    const { data: boardMembers } = await supabase
      .from("profiles")
      .select("first_name, last_name, created_at")
      .in("role", ["catechumen", "member", "admin"])
      .order("created_at", { ascending: false });
    const memberCount = (boardMembers ?? []).length;
    const newest = (boardMembers ?? [])[0];
    const newestMember = newest
      ? shortName(newest.first_name as string | null, newest.last_name as string | null)
      : null;

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
      const lastId = lastPostAuthorId.get(c.id) ?? null;
      return {
        slug: c.slug,
        name: c.name,
        description: c.description,
        hidden: c.hidden,
        audience: c.audience,
        position: c.position,
        threadCount: list.length,
        postCount: list.reduce((sum, t) => sum + (t.post_count ?? 0), 0),
        unreadThreads: unread,
        lastPostAt,
        lastPostBy: lastPostAt ? (lastId ? (authorNames.get(lastId) ?? "A former parishioner") : "A former parishioner") : null,
      };
    });

    // Name days, baptism days and birthdays, today and this week.
    let celebrations: Celebration[] = [];
    try {
      celebrations = await celebrationsAhead(supabase, 7);
    } catch {
      celebrations = [];
    }

    // Posts that tag this person and haven't been looked at.
    let unreadMentions = 0;
    try {
      const { count } = await supabase
        .from("board_mentions")
        .select("post_id", { count: "exact", head: true })
        .eq("user_id", viewer.id)
        .is("seen_at", null);
      unreadMentions = count ?? 0;
    } catch {
      unreadMentions = 0;
    }

    // New private messages, for the Messages link. If it can't be worked
    // out the board still loads; it just shows none.
    let unreadMessages = 0;
    try {
      unreadMessages = (await loadInbox(supabase, viewer.id)).unreadCount;
    } catch {
      unreadMessages = 0;
    }

    // Topics a moderator has put on the front page.
    const roomName = new Map(visible.map((c: CategoryRow) => [c.id, c.name]));
    const announcements = (threads ?? [])
      .filter((t) => (t as ThreadRow).announce)
      .sort((a, b) => ((a as ThreadRow).last_post_at < (b as ThreadRow).last_post_at ? 1 : -1))
      .slice(0, 5)
      .map((t) => ({
        id: (t as ThreadRow).id,
        title: (t as ThreadRow).title,
        room: roomName.get((t as ThreadRow).category_id) ?? "",
      }));

    return wrap(
      jsonResponse(
        {
          categories: payload,
          announcements,
          celebrations,
          unreadTotal,
          unreadMessages,
          unreadMentions,
          // The line along the bottom of every board ever made.
          stats: {
            topics: (threads ?? []).length,
            posts: totalPosts,
            members: memberCount ?? 0,
            newestMember: newestMember,
          },
          viewer: {
            displayName: viewer.displayName,
            isAdmin: viewer.isAdmin,
            isModerator: viewer.isModerator,
            rank: viewer.role === "admin" ? "Parish Admin"
                : viewer.isModerator ? "Moderator"
                : viewer.role === "member" ? "Member"
                : viewer.role === "catechumen" ? "Catechumen" : "Inquirer",
            unreadTotal,
            suspension: viewer.suspension,
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
