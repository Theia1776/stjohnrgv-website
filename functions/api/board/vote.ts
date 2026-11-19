/**
 * Cloudflare Pages Function: POST /api/board/vote
 *
 * { pollId, optionIds }   cast, or change, your vote in a poll.
 *
 * Replaces whatever you chose before. One choice unless the poll allows
 * several. Closed topics don't take votes. The page shows counts only,
 * never who chose what.
 */

import {
  requireBoardAccess,
  canSeeCategory,
  jsonResponse,
  suspensionBlock,
  type BoardEnv,
} from "../../../src/lib/board-access.ts";

export async function onRequestPost(
  context: { request: Request; env: BoardEnv },
): Promise<Response> {
  const gate = await requireBoardAccess(context);
  if (gate.error) return gate.error;
  const { supabase, viewer, wrap } = gate as Required<typeof gate>;
  const blocked = suspensionBlock(viewer, wrap);
  if (blocked) return blocked;

  try {
    const body = (await context.request.json().catch(() => ({}))) as {
      pollId?: unknown;
      optionIds?: unknown;
    };
    const pollId = typeof body.pollId === "string" ? body.pollId : "";
    const picked = Array.isArray(body.optionIds)
      ? [...new Set(body.optionIds.filter((x): x is string => typeof x === "string"))]
      : [];
    if (!pollId) return wrap(jsonResponse({ error: "Which poll?" }, 400));
    if (!picked.length) return wrap(jsonResponse({ error: "Pick an answer first." }, 400));

    const { data: poll } = await supabase
      .from("board_polls")
      .select("id, multiple, board_threads ( locked, board_categories ( hidden, audience ) )")
      .eq("id", pollId)
      .maybeSingle();
    const thread = poll
      ? ((poll as Record<string, unknown>).board_threads as
          | { locked: boolean; board_categories: { hidden: boolean; audience: string } | null }
          | null)
      : null;
    if (!poll || !thread || (thread.board_categories && !canSeeCategory(viewer, thread.board_categories))) {
      return wrap(jsonResponse({ error: "That poll is gone." }, 404));
    }
    if (thread.locked) return wrap(jsonResponse({ error: "This poll is closed." }, 403));
    if (!poll.multiple && picked.length > 1) {
      return wrap(jsonResponse({ error: "Pick just one." }, 400));
    }

    const { data: options } = await supabase
      .from("board_poll_options")
      .select("id")
      .eq("poll_id", pollId);
    const valid = new Set((options ?? []).map((o) => o.id as string));
    if (!picked.every((id) => valid.has(id))) {
      return wrap(jsonResponse({ error: "That isn't one of the choices." }, 400));
    }

    await supabase.from("board_poll_votes").delete().eq("poll_id", pollId).eq("user_id", viewer.id);
    const { error } = await supabase
      .from("board_poll_votes")
      .insert(picked.map((option_id) => ({ option_id, poll_id: pollId, user_id: viewer.id })));
    if (error) return wrap(jsonResponse({ error: error.message }, 500));
    return wrap(jsonResponse({ ok: true }, 200));
  } catch (err) {
    return wrap(
      jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error." }, 500),
    );
  }
}
