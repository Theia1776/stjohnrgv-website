/**
 * Cloudflare Pages Function: GET /api/board/people
 *
 * Everyone on the board a message can go to, for the "To" list. Just
 * the first name and last initial, the same as beside a post, and
 * whether they are a moderator or admin. If two people would show the
 * same, the full last name is used so you can tell them apart.
 */

import {
  requireBoardAccess,
  jsonResponse,
  shortName,
  type BoardEnv,
} from "../../../src/lib/board-access.ts";
import { privilegedIds } from "../../../src/lib/board-messages.ts";

export async function onRequestGet(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;

  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, first_name, last_name")
      .in("role", ["catechumen", "member", "admin"])
      .neq("id", viewer.id);
    if (error) return wrap(jsonResponse({ error: error.message }, 500));

    const staff = await privilegedIds(supabase);
    const short = (data ?? []).map((p) => ({
      id: p.id as string,
      first: ((p.first_name as string | null) ?? "").trim(),
      last: ((p.last_name as string | null) ?? "").trim(),
      name: shortName(p.first_name as string | null, p.last_name as string | null),
    }));

    const counts = new Map<string, number>();
    for (const p of short) counts.set(p.name, (counts.get(p.name) ?? 0) + 1);

    const people = short
      .map((p) => ({
        id: p.id,
        name: (counts.get(p.name) ?? 0) > 1 && p.last ? `${p.first} ${p.last}`.trim() : p.name,
        staff: staff.has(p.id),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return wrap(jsonResponse({ people }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error." }, 500),
    );
  }
}
