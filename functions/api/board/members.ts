/**
 * Cloudflare Pages Function: GET /api/board/members   (admins only)
 *
 * Everybody who can use the board: full name, what they are, when they
 * joined, how much they've written, and whether they're suspended. No
 * email or phone: this is a roll of the board, not the account list.
 */

import {
  requireBoardAccess,
  jsonResponse,
  type BoardEnv,
} from "../../../src/lib/board-access.ts";

export async function onRequestGet(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;
  if (!viewer.isAdmin) return wrap(jsonResponse({ error: "Forbidden" }, 403));

  try {
    const { data: people, error } = await supabase
      .from("profiles")
      .select("id, first_name, last_name, role, created_at")
      .in("role", ["catechumen", "member", "admin"]);
    if (error) return wrap(jsonResponse({ error: error.message }, 500));

    const { data: mods } = await supabase.from("board_moderators").select("user_id");
    const moderators = new Set((mods ?? []).map((m) => m.user_id as string));

    const { data: posts } = await supabase.from("board_posts").select("author_id");
    const tally = new Map<string, number>();
    for (const p of posts ?? []) {
      if (p.author_id) tally.set(p.author_id as string, (tally.get(p.author_id as string) ?? 0) + 1);
    }

    const { data: susp } = await supabase.from("board_suspensions").select("user_id, until");
    const suspended = new Set(
      (susp ?? [])
        .filter((r) => !r.until || new Date(r.until as string).getTime() > Date.now())
        .map((r) => r.user_id as string),
    );

    const members = (people ?? [])
      .map((p) => {
        const id = p.id as string;
        const name = `${(p.first_name as string | null) ?? ""} ${(p.last_name as string | null) ?? ""}`.trim() || "(no name)";
        return {
          id,
          name,
          rank:
            p.role === "admin" ? "Parish Admin" : moderators.has(id) ? "Moderator" : p.role === "member" ? "Member" : "Catechumen",
          joined: p.created_at,
          posts: tally.get(id) ?? 0,
          suspended: suspended.has(id),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return wrap(jsonResponse({ members }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error." }, 500),
    );
  }
}
