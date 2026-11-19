/**
 * Cloudflare Pages Function: GET /api/board/search?q=
 *
 * Finds topics whose title has the words, and posts whose text has
 * them, in every room this person can see. Newest first, up to sixty.
 * A room someone can't see never turns up here: the same room check
 * the rest of the board uses runs on every result.
 */

import {
  requireBoardAccess,
  canSeeCategory,
  jsonResponse,
  type BoardEnv,
} from "../../../src/lib/board-access.ts";
import { GONE, namesOf } from "../../../src/lib/board-messages.ts";

const MIN = 2;
const MAX = 80;
const LIMIT = 60;

type Room = { name: string; slug: string; hidden: boolean; audience: string };

/** Make a string safe to put between % signs in an ilike pattern. */
function likeSafe(q: string): string {
  return q.replace(/[\\%_]/g, (m) => "\\" + m);
}

function around(text: string, q: string): string {
  const at = text.toLowerCase().indexOf(q.toLowerCase());
  if (at === -1) return text.slice(0, 160);
  const start = Math.max(0, at - 70);
  const end = Math.min(text.length, at + q.length + 90);
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}

export async function onRequestGet(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;

  try {
    const q = (new URL(context.request.url).searchParams.get("q") ?? "").trim().slice(0, MAX);
    if (q.length < MIN) {
      return wrap(jsonResponse({ error: `Type at least ${MIN} letters.` }, 400));
    }
    const pattern = `%${likeSafe(q)}%`;

    const { data: posts, error } = await supabase
      .from("board_posts")
      .select(
        "id, body, created_at, author_id, thread_id, board_threads ( id, title, board_categories ( name, slug, hidden, audience ) )",
      )
      .ilike("body", pattern)
      .order("created_at", { ascending: false })
      .limit(LIMIT * 2);
    if (error) return wrap(jsonResponse({ error: error.message }, 500));

    const { data: titled } = await supabase
      .from("board_threads")
      .select("id, title, created_at, author_id, board_categories ( name, slug, hidden, audience )")
      .ilike("title", pattern)
      .order("created_at", { ascending: false })
      .limit(LIMIT);

    type Hit = {
      postId: string | null;
      threadId: string;
      title: string;
      room: string;
      authorId: string | null;
      snippet: string;
      at: string;
    };
    const hits: Hit[] = [];
    const threadsSeen = new Set<string>();

    for (const t of (titled ?? []) as unknown as Array<{
      id: string; title: string; created_at: string; author_id: string | null; board_categories: Room | null;
    }>) {
      if (t.board_categories && !canSeeCategory(viewer, t.board_categories)) continue;
      threadsSeen.add(t.id);
      hits.push({
        postId: null,
        threadId: t.id,
        title: t.title,
        room: t.board_categories?.name ?? "",
        authorId: t.author_id,
        snippet: "",
        at: t.created_at,
      });
    }
    for (const p of (posts ?? []) as unknown as Array<{
      id: string; body: string; created_at: string; author_id: string | null; thread_id: string;
      board_threads: { id: string; title: string; board_categories: Room | null } | null;
    }>) {
      const t = p.board_threads;
      if (!t || (t.board_categories && !canSeeCategory(viewer, t.board_categories))) continue;
      hits.push({
        postId: p.id,
        threadId: t.id,
        title: t.title,
        room: t.board_categories?.name ?? "",
        authorId: p.author_id,
        snippet: around(p.body, q),
        at: p.created_at,
      });
    }

    hits.sort((a, b) => (a.at < b.at ? 1 : -1));
    const shown = hits.slice(0, LIMIT);
    const names = await namesOf(
      supabase,
      [...new Set(shown.map((h) => h.authorId).filter(Boolean))] as string[],
    );

    return wrap(
      jsonResponse(
        {
          q,
          results: shown.map((h) => ({
            postId: h.postId,
            threadId: h.threadId,
            title: h.title,
            room: h.room,
            by: h.authorId ? (names.get(h.authorId) ?? GONE) : GONE,
            snippet: h.snippet,
            at: h.at,
          })),
          more: hits.length > LIMIT,
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
