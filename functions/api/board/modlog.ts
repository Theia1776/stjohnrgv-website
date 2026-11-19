/**
 * Cloudflare Pages Function: GET /api/board/modlog   (admins only)
 *
 * The last hundred things moderators and admins did to the board:
 * who, what, to whom, when.
 */

import {
  requireBoardAccess,
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
  if (!viewer.isAdmin) return wrap(jsonResponse({ error: "Forbidden" }, 403));

  try {
    const { data, error } = await supabase
      .from("board_mod_log")
      .select("actor_id, action, target_id, detail, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) return wrap(jsonResponse({ error: error.message }, 500));

    const ids = [
      ...new Set((data ?? []).flatMap((r) => [r.actor_id, r.target_id]).filter(Boolean)),
    ] as string[];
    const names = await namesOf(supabase, ids);
    const nameOf = (id: string | null) => (id ? (names.get(id) ?? GONE) : "");

    return wrap(
      jsonResponse(
        {
          log: (data ?? []).map((r) => ({
            who: nameOf(r.actor_id as string | null) || GONE,
            action: r.action,
            to: nameOf(r.target_id as string | null),
            detail: r.detail ?? "",
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
