/**
 * Cloudflare Pages Function: GET /api/board/messages
 *
 * The viewer's inbox: every private conversation they are in, newest
 * first, with which are new, and the list of people they are ignoring.
 * Conversations with someone they ignore aren't in it at all.
 */

import {
  requireBoardAccess,
  jsonResponse,
  type BoardEnv,
} from "../../../src/lib/board-access.ts";
import { loadInbox, namesOf } from "../../../src/lib/board-messages.ts";

export async function onRequestGet(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;

  try {
    const { rows, unreadCount, ignoring } = await loadInbox(supabase, viewer.id);
    const names = await namesOf(supabase, [...ignoring]);

    return wrap(
      jsonResponse(
        {
          conversations: rows,
          unreadCount,
          viewer: { isModerator: viewer.isModerator },
          ignoring: [...ignoring]
            .map((id) => ({ id, name: names.get(id) ?? "A former parishioner" }))
            .sort((a, b) => a.name.localeCompare(b.name)),
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
