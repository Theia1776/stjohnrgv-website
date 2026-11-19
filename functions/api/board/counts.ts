/**
 * Cloudflare Pages Function: GET /api/board/counts
 *
 * Just the two numbers the navigation strip on every board page shows:
 * new private messages and new @mentions. Cheap, so it can run on each
 * page without loading the whole board.
 */

import {
  requireBoardAccess,
  jsonResponse,
  type BoardEnv,
} from "../../../src/lib/board-access.ts";
import { loadInbox } from "../../../src/lib/board-messages.ts";

export async function onRequestGet(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;

  let messages = 0;
  let mentions = 0;
  try {
    messages = (await loadInbox(supabase, viewer.id)).unreadCount;
  } catch {
    messages = 0;
  }
  try {
    const { count } = await supabase
      .from("board_mentions")
      .select("post_id", { count: "exact", head: true })
      .eq("user_id", viewer.id)
      .is("seen_at", null);
    mentions = count ?? 0;
  } catch {
    mentions = 0;
  }
  return wrap(jsonResponse({ messages, mentions }, 200));
}
