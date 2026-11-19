/**
 * Cloudflare Pages Function: GET /api/board/people
 *
 * Everyone on the board a message can go to, or an @ can tag, for the
 * "To" list and the @ list. Just the first name and last initial, the
 * same as beside a post, and whether they are a moderator or admin. If
 * two people would show the same, the full last name is used so you can
 * tell them apart. `me` is the viewer's own name in the same style, so a
 * page can highlight when somebody tags them.
 */

import {
  requireBoardAccess,
  jsonResponse,
  type BoardEnv,
} from "../../../src/lib/board-access.ts";
import { privilegedIds } from "../../../src/lib/board-messages.ts";
import { mentionLabels } from "../../../src/lib/board-mentions.ts";

export async function onRequestGet(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;

  try {
    const labels = await mentionLabels(supabase);
    const staff = await privilegedIds(supabase);

    const people = [...labels.entries()]
      .filter(([id]) => id !== viewer.id)
      .map(([id, name]) => ({ id, name, staff: staff.has(id) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return wrap(
      jsonResponse({ people, me: { id: viewer.id, name: labels.get(viewer.id) ?? viewer.displayName } }, 200),
    );
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error." }, 500),
    );
  }
}
